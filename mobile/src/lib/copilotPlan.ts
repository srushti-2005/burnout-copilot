// ui/src/lib/copilotPlan.ts  (FULL REPLACEMENT)
// Single source of truth for personalised advice: age band, exhaustion type,
// reset ideas, forecast days and the "avoid / do" plan. Used by every card and the chat.
import type {
    ActivitySummaryPayload,
    ActivityType,
    DashboardPayload,
    DeviationInfo,
    InterventionPayload,
    TwinPayload,
} from "@/lib/webTypes";

export type ViewId = "home" | "digital-twin" | "recommendations" | "analytics" | "ai-insights" | "reports";
export type PlanAction = { kind: "focus"; minutes: number } | { kind: "view"; view: ViewId };
export type Tone = "alert" | "watch" | "good";

export interface PlanItem {
  id: string;
  tone: Tone;
  title: string;
  avoid?: string;
  doThis: string;
  why: string;
  action?: { label: string; act: PlanAction };
}

export const FEATURE_LABELS: Record<string, string> = {
  typing_mean: "Typing speed",
  typing_variance: "Typing irregularity",
  task_switching: "Task switching",
  work_duration: "Session length",
  late_night: "Late-night work",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  work: "Work",
  hobby: "Hobby",
  entertainment: "Entertainment",
  break: "Break",
  other: "Other",
};

export function runPlanAction(
  act: PlanAction,
  h: { onStartFocus: (m: number) => void; onNavigate: (v: ViewId) => void },
) {
  if (act.kind === "focus") h.onStartFocus(act.minutes);
  else h.onNavigate(act.view);
}

// ───────────────────────── Age personalisation ─────────────────────────
export interface AgeBand {
  id: "unknown" | "under25" | "25to44" | "45to59" | "60plus";
  label: string;
  breakEvery: number; // minutes of screen work between breaks
  focusMin: number;
  napMin: number;
  note: string;
}

export function ageBand(age: number | null): AgeBand {
  if (age === null) return { id: "unknown", label: "Age not set", breakEvery: 50, focusMin: 25, napMin: 20, note: "Set your age in your profile and I'll tune breaks and resets to it." };
  if (age < 25) return { id: "under25", label: `Age ${age}`, breakEvery: 50, focusMin: 25, napMin: 20, note: "Short, active breaks tend to work well at your age. Protecting sleep matters most, because late nights hit hardest." };
  if (age < 45) return { id: "25to44", label: `Age ${age}`, breakEvery: 50, focusMin: 25, napMin: 20, note: "Long unbroken stretches are the main risk at this stage. Short walks and a firm stop time help most." };
  if (age < 60) return { id: "45to59", label: `Age ${age}`, breakEvery: 45, focusMin: 25, napMin: 15, note: "Eyes and posture tire faster with long screen time, so I add eye rests and stretches." };
  return { id: "60plus", label: `Age ${age}`, breakEvery: 40, focusMin: 20, napMin: 20, note: "Gentle, regular breaks and enough rest between sessions work best, so I keep focus blocks shorter." };
}

// ───────────────────────── Exhaustion type ─────────────────────────
export type ExhaustionType = "scattered" | "drained" | "overextended" | "flat" | "balanced" | "learning";

export interface ExhaustionProfile {
  type: ExhaustionType;
  label: string;
  summary: string;
  driver: string | null; // feature key
}

const TYPE_TEXT: Record<Exclude<ExhaustionType, "learning">, { label: string; summary: string }> = {
  scattered: { label: "Scattered attention", summary: "Your attention is being split across too many things. Doing one thing at a time will help you most." },
  drained: { label: "Mentally drained", summary: "Your typing rhythm shows fatigue. Rest and recovery will do more than pushing harder." },
  overextended: { label: "Overextended", summary: "You're working longer or later than your normal, which eats into recovery time." },
  flat: { label: "Flat and understimulated", summary: "Much of your time is low-engagement work. Something absorbing will recharge you more than a plain break." },
  balanced: { label: "In balance", summary: "You're close to your own normal. Keep the rhythm and add small resets through the day." },
};

export function activityMix(a: ActivitySummaryPayload | null) {
  if (!a || a.checkin_count === 0) return [];
  const entries = (Object.entries(a.pct_by_activity_type) as [ActivityType, number | undefined][])
    .map(([type, v]) => ({ type, v: v ?? 0 }))
    .filter((e) => e.v > 0);
  const total = entries.reduce((s, e) => s + e.v, 0);
  const k = total > 0 && total <= 1.5 ? 100 : 1;
  return entries
    .map((e) => ({ type: e.type, label: ACTIVITY_LABELS[e.type], pct: Math.round(e.v * k) }))
    .sort((x, y) => y.pct - x.pct);
}

export function rankedDeviations(twin: TwinPayload | null): [string, DeviationInfo][] {
  if (!twin) return [];
  return Object.entries(twin.deviations)
    .filter(([f]) => f in FEATURE_LABELS)
    .sort(([, a], [, b]) => Math.abs(b.difference_pct ?? 100) - Math.abs(a.difference_pct ?? 100));
}

export function exhaustionProfile(
  _dash: DashboardPayload,
  twin: TwinPayload | null,
  activity: ActivitySummaryPayload | null,
): ExhaustionProfile {
  if (!twin?.baseline.is_established) {
    const left = Math.max(0, 5 - (twin?.baseline.session_count ?? 0));
    return {
      type: "learning",
      label: "Still learning you",
      summary: `${left} more tracked session${left === 1 ? "" : "s"} and I can tell what kind of exhaustion you tend to have.`,
      driver: null,
    };
  }
  for (const [f, dev] of rankedDeviations(twin)) {
    const above = dev.status === "above_normal";
    if (f === "task_switching" && above) return { type: "scattered", ...TYPE_TEXT.scattered, driver: f };
    if ((f === "late_night" || f === "work_duration") && above) return { type: "overextended", ...TYPE_TEXT.overextended, driver: f };
    if ((f === "typing_variance" && above) || (f === "typing_mean" && dev.status === "below_normal"))
      return { type: "drained", ...TYPE_TEXT.drained, driver: f };
  }
  const work = activityMix(activity).find((m) => m.type === "work")?.pct ?? 0;
  if (work >= 60 && (activity?.avg_engagement_score ?? 3) < 3) return { type: "flat", ...TYPE_TEXT.flat, driver: null };
  return { type: "balanced", ...TYPE_TEXT.balanced, driver: null };
}

// ───────────────────────── Reset ideas ─────────────────────────
export interface ResetIdea {
  id: string;
  title: string;
  minutes: number;
  how: string;
  why: string;
}

function catalog(b: AgeBand): Record<string, ResetIdea> {
  return {
    puzzle: { id: "puzzle", title: "Solve a puzzle", minutes: 10, how: "Do a sudoku, crossword or jigsaw. No phone, no notifications.", why: "One small, absorbing goal lets a split attention settle." },
    brainstorm: { id: "brainstorm", title: "Brainstorm freely", minutes: 10, how: "Write 10 ideas about anything that isn't work (a trip, a gift, a silly invention). Don't judge them.", why: "Playful thinking recharges the part of your mind that routine work leaves flat." },
    nap: { id: "nap", title: "Take a power nap", minutes: b.napMin, how: "Set an alarm, lie back with your eyes closed. Even if you don't sleep, resting counts.", why: "A short nap restores alertness without the grogginess of a long one. Skip it late in the day so night sleep isn't affected." },
    walk: { id: "walk", title: "Walk without your phone", minutes: 10, how: "Walk outside or down a corridor and leave your phone behind.", why: "Movement and a change of scene ease tension and reset your focus." },
    breathe: { id: "breathe", title: "Box breathing", minutes: 3, how: "Breathe in for 4 seconds, hold 4, out 4, hold 4. Repeat.", why: "Slow breathing calms your stress response within minutes." },
    eyes: { id: "eyes", title: "Rest your eyes (20-20-20)", minutes: 2, how: "Look at something 20 feet away for 20 seconds, every 20 minutes.", why: "A widely recommended way to ease screen eye strain." },
    stretch: { id: "stretch", title: "Desk stretch", minutes: 5, how: "Roll your shoulders and stretch your neck, wrists and back.", why: "Releases the tension that builds up while you sit and type." },
    water: { id: "water", title: "Water and a light snack", minutes: 5, how: "Drink a glass of water and eat something light.", why: "Dehydration and low energy make tiredness feel worse." },
    music: { id: "music", title: "Music break", minutes: 5, how: "Play one favourite song and just listen, doing nothing else.", why: "A small pleasure lifts your mood without demanding effort." },
    game: { id: "game", title: "Play a quick game", minutes: 10, how: "Try a word game or a quick round of chess, and stop when the timer ends.", why: "Light play is a real break for a flat mind, as long as it has a finish line." },
    call: { id: "call", title: "Chat with someone", minutes: 10, how: "Talk to a friend or colleague about anything except work.", why: "Social contact is one of the best mood resets." },
    winddown: { id: "winddown", title: "Screen-off wind-down", minutes: 20, how: "Screens off, lights low. Read or stretch gently.", why: "Working late steals recovery, and a wind-down protects tomorrow's energy." },
    doodle: { id: "doodle", title: "Doodle or sketch", minutes: 5, how: "Draw anything on paper, with no goal.", why: "Low-pressure creative play gives a scattered mind something calm to hold." },
  };
}

const FIT: Record<ExhaustionType, string[]> = {
  scattered: ["puzzle", "breathe", "doodle", "walk", "eyes", "music"],
  drained: ["nap", "walk", "water", "stretch", "breathe", "music"],
  overextended: ["winddown", "breathe", "stretch", "nap", "walk", "eyes"],
  flat: ["brainstorm", "game", "call", "music", "walk", "doodle"],
  balanced: ["brainstorm", "walk", "eyes", "stretch", "puzzle", "music"],
  learning: ["walk", "eyes", "breathe", "stretch", "puzzle", "brainstorm"],
};

export function resetsFor(
  type: ExhaustionType,
  age: number | null,
  n = 6,
  hour: number = new Date().getHours(),
): ResetIdea[] {
  const cat = catalog(ageBand(age));
  let ids = [...FIT[type]];
  if (hour >= 16) ids = ids.filter((i) => i !== "nap"); // late naps can hurt night sleep
  if (hour < 18) ids = ids.filter((i) => i !== "winddown");
  if (age !== null && age >= 45) {
    ids = ids.filter((i) => i !== "eyes");
    ids.splice(1, 0, "eyes");
  }
  return ids
    .slice(0, n)
    .map((i) => cat[i])
    .filter((x): x is ResetIdea => Boolean(x));
}

// ───────────────────────── Forecast ─────────────────────────
export interface ForecastDay {
  date: string;
  day: string;
  pct: number;
  level: "heavier" | "steady" | "lighter";
}

export function dayName(iso: string, style: "long" | "short" = "long"): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: style });
}

export function forecastDays(dash: DashboardPayload): ForecastDay[] {
  return (dash.forecast ?? []).map((p) => ({
    date: p.date,
    day: dayName(p.date, "short"),
    pct: Math.round(p.CLI * 100),
    level: p.CLI > dash.cli + 0.03 ? "heavier" : p.CLI < dash.cli - 0.03 ? "lighter" : "steady",
  }));
}

// ───────────────────────── Plan ─────────────────────────
function fromDeviation(f: string, dev: DeviationInfo, b: AgeBand): PlanItem | null {
  const pct = dev.difference_pct;
  const tone: Tone = pct === null || Math.abs(pct) > 50 ? "alert" : "watch";
  const above = dev.status === "above_normal";
  switch (f) {
    case "task_switching":
      if (!above) return null;
      return {
        id: f, tone, title: "You're switching tasks more than usual",
        avoid: "Opening a new task before you finish the current one",
        doThis: `Work on one task for ${b.focusMin} minutes, nothing else open`,
        why: "Constant switching is the fastest way your cognitive load climbs.",
        action: { label: `Start ${b.focusMin}-min focus`, act: { kind: "focus", minutes: b.focusMin } },
      };
    case "late_night":
      if (!above) return null;
      return {
        id: f, tone, title: "You're working later than your normal",
        avoid: "Starting new work after your usual finishing time tonight",
        doThis: "Pick a hard stop time and take a screen-free wind-down",
        why: "Late-night work cuts recovery, which raises tomorrow's starting load.",
        action: { label: "Open reset menu", act: { kind: "view", view: "recommendations" } },
      };
    case "work_duration":
      if (!above) return null;
      return {
        id: f, tone, title: "Your sessions are longer than usual",
        avoid: "Long stretches without a break",
        doThis: `Take a 5-minute break away from the screen every ${b.breakEvery} minutes`,
        why: "Long unbroken sessions build fatigue faster than your body reports it.",
        action: { label: "Start 15-min recovery", act: { kind: "focus", minutes: 15 } },
      };
    case "typing_variance":
      if (!above) return null;
      return {
        id: f, tone, title: "Your typing rhythm is less steady",
        avoid: "Pushing through complex work right now",
        doThis: "Switch to a lighter task or step away for a few minutes",
        why: "An uneven typing rhythm is an early sign of mental fatigue.",
        action: { label: "Open reset menu", act: { kind: "view", view: "recommendations" } },
      };
    case "typing_mean":
      if (dev.status !== "below_normal") return null;
      return {
        id: f, tone, title: "You're typing slower than your normal",
        avoid: "Deadline-critical work while you feel this slow",
        doThis: "Take a short break, hydrate, then re-check",
        why: "A drop in typing speed often shows up before you feel tired.",
        action: { label: "Open reset menu", act: { kind: "view", view: "recommendations" } },
      };
    default:
      return null;
  }
}

const ORDER: Record<Tone, number> = { alert: 0, watch: 1, good: 2 };

export function buildPlan(
  dash: DashboardPayload,
  twin: TwinPayload | null,
  activity: ActivitySummaryPayload | null,
  intervention: InterventionPayload | null,
): PlanItem[] {
  const items: PlanItem[] = [];
  const age = twin?.profile.age ?? null;
  const band = ageBand(age);

  if (intervention?.title) {
    const ui = intervention.ui_action;
    items.push({
      id: "intervention", tone: "alert", title: intervention.title,
      doThis: intervention.what, why: intervention.why,
      action:
        ui?.kind === "focus_protection"
          ? { label: intervention.action_label || "Start focus", act: { kind: "focus", minutes: ui.duration_min ?? band.focusMin } }
          : { label: intervention.action_label || "Open recommendation", act: { kind: "view", view: "recommendations" } },
    });
  }

  if (twin?.baseline.is_established) {
    rankedDeviations(twin).forEach(([f, dev]) => {
      const it = fromDeviation(f, dev, band);
      if (it) items.push(it);
    });
  } else if (twin) {
    items.push({
      id: "calibrating", tone: "watch",
      title: `Learning your normal (${twin.baseline.session_count}/5 sessions)`,
      doThis: "Keep the tracker running through a normal day or two",
      why: "Advice becomes personal once your own baseline is established.",
    });
  }

  const fc = forecastDays(dash);
  if (fc.length) {
    const peak = fc.reduce((a, b) => (b.pct > a.pct ? b : a));
    const rising = peak.level === "heavier";
    items.push({
      id: "forecast", tone: rising ? "watch" : "good",
      title: rising ? `Your load may reach ${peak.pct}% by ${dayName(peak.date)}` : "Your 7-day outlook looks steady",
      ...(rising ? { avoid: "Adding extra demanding work on that day" } : {}),
      doThis: rising ? "Plan lighter work and a proper break before then" : "Keep your current routine",
      why: "This is a forecast from your recent sessions, so you can act before it happens.",
      action: { label: "See forecast", act: { kind: "view", view: "analytics" } },
    });
  }

  const mix = activityMix(activity);
  const pct = (t: ActivityType) => mix.find((m) => m.type === t)?.pct ?? 0;
  if (!activity || activity.checkin_count === 0) {
    items.push({
      id: "activity-none", tone: "watch", title: "Tell me what you're doing",
      doThis: "Answer the next check-in popup in a few seconds",
      why: "Time you enjoy counts less toward burnout than draining work, so your score stays fair.",
    });
  } else if (pct("work") >= 70 && (activity.avg_engagement_score ?? 3) < 3) {
    items.push({
      id: "activity-drain", tone: "alert", title: `${pct("work")}% of your logged time is low-engagement work`,
      avoid: "Long blocks of draining work with no change of activity",
      doThis: "Schedule a hobby or a real break block today",
      why: "Low-engagement work counts fully toward your load; enjoyable time counts far less.",
    });
  } else if (pct("hobby") + pct("break") < 10) {
    items.push({
      id: "activity-recovery", tone: "watch", title: "You've logged almost no recovery time",
      doThis: "Put a 15-minute break or hobby block in your day",
      why: "Recovery time is what lets your load come back down.",
    });
  }

  if (!items.some((i) => i.tone !== "good")) {
    items.unshift({
      id: "healthy", tone: "good", title: "You're in a healthy rhythm",
      doThis: `Keep going and take a 5-minute break every ${band.breakEvery} minutes`,
      why: "Nothing is drifting from your normal right now.",
    });
  }

  const prof = exhaustionProfile(dash, twin, activity);
  const top = resetsFor(prof.type, age)[0];
  if (top) {
    items.push({
      id: "reset", tone: "good", title: `Reset idea for you: ${top.title} (${top.minutes} min)`,
      doThis: top.how, why: top.why,
      action: { label: "Open reset menu", act: { kind: "view", view: "recommendations" } },
    });
  }
  return items.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
