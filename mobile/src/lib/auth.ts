import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';
import { supabase } from './supabase';

const KEY = 'burnout_auth_v1';

export type AuthUser = { uid: string; email: string; display_name?: string | null };
export type AuthState = { token: string; refreshToken?: string | null; user: AuthUser } | null;

let state: AuthState = null;
let loaded = false;
const listeners = new Set<(s: AuthState) => void>();

async function load() {
  if (loaded) return state;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : null;
    if (state?.token && state?.refreshToken) {
      await supabase.auth
        .setSession({
          access_token: state.token,
          refresh_token: state.refreshToken,
        })
        .catch(() => {});
    }
  } catch {
    state = null;
  }
  loaded = true;
  return state;
}

function notify() {
  listeners.forEach((l) => l(state));
}

export function onAuthChange(cb: (s: AuthState) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function getAuthState(): Promise<AuthState> {
  return load();
}

export async function getToken(): Promise<string | null> {
  const s = await load();
  return s?.token ?? null;
}

async function persist(next: AuthState) {
  state = next;
  loaded = true;
  if (next) await AsyncStorage.setItem(KEY, JSON.stringify(next));
  else await AsyncStorage.removeItem(KEY);
  notify();
}

async function post(path: string, body: object) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  return { ok: res.ok, out };
}

export async function signIn(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const { ok, out } = await post('/auth/login', {
    email,
    password,
    include_refresh_token: true,
  });
  if (!ok || !out?.success || !out?.access_token) {
    return { ok: false, error: out?.error ?? 'Invalid email or password.' };
  }
  const nextState: AuthState = {
    token: out.access_token,
    refreshToken: out.refresh_token ?? null,
    user: { uid: out.uid, email: out.email, display_name: out.display_name },
  };
  await persist(nextState);

  // Synchronize Supabase JS client session so table operations are fully authenticated
  if (out.access_token && out.refresh_token) {
    await supabase.auth
      .setSession({
        access_token: out.access_token,
        refresh_token: out.refresh_token,
      })
      .catch(() => {});
  }

  return { ok: true };
}

export async function signUp(
  email: string,
  password: string,
  name: string,
  age: number
): Promise<{ ok: boolean; error?: string; needsConfirmation?: boolean }> {
  const { ok, out } = await post('/auth/signup', {
    email,
    password,
    name,
    age,
    include_refresh_token: true,
  });

  if (!ok || !out?.success) {
    const raw: string =
      out?.error ?? out?.detail?.[0]?.msg ?? 'Could not create account.';
    return { ok: false, error: raw };
  }
  if (out.access_token) {
    const nextState: AuthState = {
      token: out.access_token,
      refreshToken: out.refresh_token ?? null,
      user: { uid: out.uid, email: out.email, display_name: out.display_name },
    };
    await persist(nextState);

    if (out.access_token && out.refresh_token) {
      await supabase.auth
        .setSession({
          access_token: out.access_token,
          refresh_token: out.refresh_token,
        })
        .catch(() => {});
    }
    return { ok: true };
  }
  return {
    ok: false,
    needsConfirmation: true,
    error: 'Check your email to confirm your account, then log in.',
  };
}

export async function refreshToken(): Promise<string | null> {
  const s = await load();
  const rf = s?.refreshToken;
  if (!rf) return null;
  const { ok, out } = await post('/auth/refresh', { refresh_token: rf });
  if (ok && out?.success && out?.access_token) {
    await persist({
      token: out.access_token,
      refreshToken: out.refresh_token || rf,
      user: s.user,
    });
    if (out.refresh_token) {
      await supabase.auth
        .setSession({
          access_token: out.access_token,
          refresh_token: out.refresh_token,
        })
        .catch(() => {});
    }
    return out.access_token;
  }
  return null;
}

export async function resetPassword(
  email: string
): Promise<{ ok: boolean; error?: string }> {
  const { ok, out } = await post('/auth/reset', { email });
  return ok && out?.success
    ? { ok: true }
    : { ok: false, error: out?.error ?? 'Could not send reset email.' };
}

export async function signOut() {
  await supabase.auth.signOut().catch(() => {});
  await persist(null);
}