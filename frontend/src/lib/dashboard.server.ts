import type { ApiCallResult, AuthResult, DashboardPayload } from "./dashboard.types";
import { emptyDashboard } from "./dashboard.fallback";

function base(): string {
  const url = process.env["PYTHON_API_URL"];
  if (!url) throw new Error("PYTHON_API_URL is not configured");
  return url.replace(/\/+$/, "");
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  const key = process.env["PYTHON_API_KEY"];
  if (key) h["x-api-key"] = key;
  return h;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from the service (${res.status})`);
  }
  return json as T;
}

export async function apiLogin(email: string, password: string): Promise<AuthResult> {
  try {
    return await post<AuthResult>("/auth/login", { email, password });
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function apiSignup(
  email: string,
  password: string,
  name: string,
  age: number,
): Promise<AuthResult> {
  try {
    return await post<AuthResult>("/auth/signup", { email, password, name, age });
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function apiReset(email: string): Promise<AuthResult> {
  try {
    return await post<AuthResult>("/auth/reset", { email });
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Dashboard is identity-scoped by the verified Supabase token only — there
 * is no uid query param, so nobody can read another user's dashboard by
 * guessing an id. Mirrors how /twin and /focus/* already work.
 */
export async function apiDashboard(token: string): Promise<DashboardPayload> {
  try {
    const res = await fetch(`${base()}/dashboard`, {
      headers: headers({ Authorization: `Bearer ${token}` }),
    });
    if (res.status === 401) {
      return emptyDashboard("Your session expired. Please sign in again.");
    }
    if (!res.ok) return emptyDashboard(`Service returned ${res.status}`);
    const data = (await res.json()) as DashboardPayload;
    return { ...emptyDashboard(), ...data, ok: true };
  } catch (e) {
    return emptyDashboard((e as Error).message);
  }
}

/**
 * Generic authenticated proxy. The path is allow-listed at the server-fn
 * boundary in dashboard.functions.ts (callApi's regex), so this
 * general-purpose fetch can never be pointed at anything else.
 *
 * The RequestInit object is built WITHOUT a `body` key at all, then `body`
 * is assigned afterwards only when defined. Building it inline as
 * `{ ..., body: body !== undefined ? x : undefined }` fails to typecheck
 * under this project's `exactOptionalPropertyTypes`, because that always
 * gives the property a value (even if that value is `undefined`), and an
 * optional property may never be explicitly set to `undefined` — it must
 * be omitted. This is the same pattern FocusProtection.tsx already uses
 * for its own `input.body`.
 */
export async function apiAuthed(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<ApiCallResult> {
  try {
    const init: RequestInit = {
      method,
      headers: headers({ Authorization: `Bearer ${token}` }),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${base()}${path}`, init);
    const text = await res.text();
    return { status: res.status, body: text };
  } catch (e) {
    return { status: 0, body: JSON.stringify({ detail: (e as Error).message }) };
  }
}