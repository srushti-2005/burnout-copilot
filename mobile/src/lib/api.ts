import { getToken, refreshToken } from './auth';
import { API_URL } from './config';

export { API_URL };

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await getToken();

  // Up to 2 attempts to gracefully handle Render spin-ups (cold starts take ~25s)
  let lastError: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);

    try {
      let res = await fetch(`${API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers || {}),
        },
      });

      if (res.status === 401) {
        // Proactively refresh the token silently without kicking the user out
        const nextToken = await refreshToken();
        if (nextToken) {
          token = nextToken;
          res = await fetch(`${API_URL}${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              ...(init.headers || {}),
            },
          });
        }
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${errText}`);
      }
      return (await res.json()) as T;
    } catch (e: any) {
      lastError = e;
      if (attempt < 2 && (e?.name === 'AbortError' || e?.message?.includes('502') || e?.message?.includes('503'))) {
        // Wait 2s and retry once
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (e?.name === 'AbortError') throw new Error('Request timed out: backend is waking up or unreachable');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Network request failed');
}