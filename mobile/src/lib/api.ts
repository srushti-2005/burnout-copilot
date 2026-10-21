import { getToken, refreshToken } from './auth';
import { API_URL } from './config';

export { API_URL };

// GET responses are reused for this long, so switching between pages does not
// hit the (slow, free-tier) backend again every time.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function clearApiCache() {
  cache.clear();
  inflight.clear();
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET') return request<T>(path, init);

  // Keyed by token so a different user never sees someone else's cached data.
  const token = (await getToken()) ?? '';
  const key = `${token.slice(-24)}|${path}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = request<T>(path, init)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let token = await getToken();

  // Up to 2 attempts to handle Render spin-ups (cold starts take ~25s)
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
      const msg: string = e?.message ?? '';
      const retryable =
        e?.name === 'AbortError' ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('Network request failed');
      if (attempt < 2 && retryable) {
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