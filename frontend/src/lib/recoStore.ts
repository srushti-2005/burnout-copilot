// Tiny browser-only store for ticked recommendations (per day). Safe if storage is unavailable.
const KEY = "me_reco_done_v2";

type Store = Record<string, string[]>;

export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(s: Store): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: ticks just won't persist */
  }
}

export function doneToday(): string[] {
  return read()[dayKey()] ?? [];
}

export function setDone(id: string, on: boolean): string[] {
  const s = read();
  const k = dayKey();
  const cur = new Set(s[k] ?? []);
  if (on) cur.add(id);
  else cur.delete(id);
  const next = [...cur];
  s[k] = next;
  write(s);
  return next;
}

/** { "2026-10-08": 3, ... } used by the Reports "Tips done" tile. */
export function doneCountsByDay(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(read())) out[k] = Array.isArray(v) ? v.length : 0;
  return out;
}
