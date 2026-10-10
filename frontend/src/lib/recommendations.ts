import type { TwinPayload } from "./dashboard.types";

export type RecoCategory = "Rest" | "Movement" | "Digital" | "Mind" | "Sleep";
export type RecoImpact = "Low" | "Medium" | "High";

export interface Reco {
  id: string;
  title: string;
  body: string;
  category: RecoCategory;
  impact: RecoImpact;
  minutes: number | null;
}

export const CATEGORIES: RecoCategory[] = ["Rest", "Movement", "Digital", "Mind", "Sleep"];

/** General wellbeing habits (not medical advice, not derived from the user's data). */
export const RECOS: Reco[] = [
  { id: "box-breathing", title: "Box breathing", body: "4 rounds of 4-4-4-4 breathing before your next meeting.", category: "Mind", impact: "Medium", minutes: 3 },
  { id: "phone-free-walk", title: "Phone-free walk", body: "A 10-minute walk outside, leave your phone at your desk.", category: "Movement", impact: "High", minutes: 10 },
  { id: "eye-rest", title: "20-20-20 eye rest", body: "Every 20 min, look 20 ft away for 20 seconds.", category: "Digital", impact: "Low", minutes: 1 },
  { id: "wrap-up", title: "Wrap up by 9 PM", body: "Protect tonight's recovery window.", category: "Sleep", impact: "High", minutes: null },
  { id: "mute-notifications", title: "Mute non-urgent notifications", body: "Turn on Do Not Disturb for your focus block.", category: "Digital", impact: "Medium", minutes: 2 },
  { id: "power-nap", title: "Power nap", body: "A 20-minute nap after lunch.", category: "Rest", impact: "Medium", minutes: 20 },
  { id: "desk-stretch", title: "Desk stretch", body: "Release neck, shoulders and wrists.", category: "Movement", impact: "Low", minutes: 5 },
  { id: "gratitude-note", title: "Gratitude note", body: "Write down three things that went well today.", category: "Mind", impact: "Low", minutes: 3 },
];

const FEATURE_CATEGORY: Record<string, RecoCategory[]> = {
  late_night: ["Sleep"],
  task_switching: ["Digital"],
  typing_variance: ["Mind"],
  work_duration: ["Rest", "Movement"],
  typing_mean: ["Rest"],
};

/** Categories worth highlighting because the user's own twin shows that signal above their normal. */
export function suggestedCategories(twin: TwinPayload | null): Set<RecoCategory> {
  const out = new Set<RecoCategory>();
  if (!twin) return out;
  for (const [feature, dev] of Object.entries(twin.deviations)) {
    if (dev.status !== "above_normal") continue;
    for (const c of FEATURE_CATEGORY[feature] ?? []) out.add(c);
  }
  return out;
}

export const DONE_PREFIX = "me_reco_done:";
const pad = (n: number) => String(n).padStart(2, "0");

export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const VALID_IDS = new Set(RECOS.map((r) => r.id));

export function loadDone(day: string): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_PREFIX + day);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string" && VALID_IDS.has(x)) : []);
  } catch {
    return new Set();
  }
}

export function saveDone(day: string, ids: Set<string>): void {
  try {
    localStorage.setItem(DONE_PREFIX + day, JSON.stringify([...ids]));
  } catch {
    /* storage blocked: ticks still work for this visit */
  }
}

/** { "2026-10-07": 3, ... } for every day the user ticked something. Used by the weekly report. */
export function doneCountsByDay(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DONE_PREFIX)) continue;
      const day = key.slice(DONE_PREFIX.length);
      out[day] = loadDone(day).size;
    }
  } catch {
    /* ignore */
  }
  return out;
}
