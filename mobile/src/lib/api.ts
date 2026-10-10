import { getToken, signOut } from './auth';
import { API_URL } from './config';

export { API_URL };

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });

    if (res.status === 401) {
      await signOut(); // clears the stored token — the auth gate below reacts to this and redirects
      throw new Error('Your session expired. Please log in again.');
    }
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Request timed out: backend unreachable');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}