import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'me_reco_done_v2';
type Store = Record<string, string[]>;

export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}
async function write(s: Store) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ticks just won't persist */ }
}

export async function doneToday(): Promise<string[]> {
  return (await read())[dayKey()] ?? [];
}

export async function setDone(id: string, on: boolean): Promise<string[]> {
  const s = await read();
  const k = dayKey();
  const cur = new Set(s[k] ?? []);
  if (on) cur.add(id); else cur.delete(id);
  const next = [...cur];
  s[k] = next;
  await write(s);
  return next;
}

/** { "2026-10-08": 3 }, used by the Reports "Tips done" tile. Same yyyy-mm-dd key as reports.ts. */
export async function doneCountsByDay(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(await read())) out[k] = Array.isArray(v) ? v.length : 0;
  return out;
}