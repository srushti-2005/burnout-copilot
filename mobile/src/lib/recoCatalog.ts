// Recommendation catalogue + personalisation. Pure logic, no React.
import type { DashboardPayload, TwinPayload } from "@/lib/webTypes";

export type Category = "Rest" | "Movement" | "Digital" | "Mind" | "Sleep";
export type Impact = "Low" | "Medium" | "High";
export type Risk = "low" | "medium" | "high";

export interface RecoItem {
  id: string;
  title: string;
  how: string;
  why: string;
  category: Category;
  impact: Impact;
  /** Omit for items that are a habit rather than a timed activity. */
  minutes?: number;
}

export interface Ctx {
  type: string;
  hour: number;
  highLoad: boolean;
  late: boolean;
  longSessions: boolean;
  switching: boolean;
  irregular: boolean;
  /** Current Cognitive Load Index. */
  cli?: number;
  /** Current risk level, derived from the CLI category. */
  risk?: Risk;
}

export interface Scored {
  item: RecoItem;
  score: number;
  suggested: boolean;
  reason: string | null;
}

export const CATEGORIES: ("All" | Category)[] = ["All", "Rest", "Movement", "Digital", "Mind", "Sleep"];

export const CATALOG: RecoItem[] = [
  { id: "box-breathing", title: "Box breathing", category: "Mind", impact: "Medium", minutes: 3,
    how: "Breathe in for 4 seconds, hold 4, out 4, hold 4. Repeat.",
    why: "Slow breathing calms your stress response within minutes." },
  { id: "phone-free-walk", title: "Phone-free walk", category: "Movement", impact: "High", minutes: 10,
    how: "Walk outside or down a corridor and leave your phone behind.",
    why: "Movement and a change of scene ease tension and reset your focus." },
  { id: "eye-rest-20-20-20", title: "20-20-20 eye rest", category: "Digital", impact: "Low", minutes: 1,
    how: "Every 20 minutes, look 20 feet away for 20 seconds.",
    why: "Gives your eye muscles a break from close-up screen focus." },
  { id: "wrap-up-recovery", title: "Wrap up by 9 PM", category: "Sleep", impact: "High",
    how: "Protect tonight's recovery window: stop work and screens early.",
    why: "Winding down early gives your mind time to recover before sleep." },
  { id: "mute-notifications", title: "Mute non-urgent notifications", category: "Digital", impact: "Medium", minutes: 2,
    how: "Turn on Do Not Disturb for your focus block.",
    why: "Fewer interruptions means fewer costly task switches." },
  { id: "power-nap", title: "Power nap", category: "Rest", impact: "Medium", minutes: 20,
    how: "Set an alarm, lie back with your eyes closed. Even if you don't sleep, resting counts.",
    why: "A short nap restores alertness. Skip it late in the day so night sleep isn't affected." },
  { id: "desk-stretch", title: "Desk stretch", category: "Movement", impact: "Low", minutes: 5,
    how: "Roll your shoulders and stretch your neck, wrists and back.",
    why: "Releases the tension that builds up while you sit and type." },
  { id: "gratitude-note", title: "Gratitude note", category: "Mind", impact: "Low", minutes: 3,
    how: "Write down three things that went well today.",
    why: "Noticing what went right lifts mood and eases overthinking." },
  { id: "water-snack", title: "Water and a light snack", category: "Rest", impact: "Low", minutes: 5,
    how: "Drink a glass of water and eat something light.",
    why: "Dehydration and low energy make tiredness feel worse." },
  { id: "music-break", title: "Music break", category: "Mind", impact: "Low", minutes: 5,
    how: "Play one favourite song and just listen, doing nothing else.",
    why: "A small pleasure lifts your mood without demanding effort." },
  { id: "puzzle-break", title: "Quick puzzle", category: "Mind", impact: "Low", minutes: 5,
    how: "Do a small puzzle or word game, then go back to work.",
    why: "A gentle puzzle holds scattered attention in one place." },
  { id: "brainstorm-break", title: "Free brainstorm", category: "Mind", impact: "Medium", minutes: 10,
    how: "Jot down ideas on paper for 10 minutes. No judging, no screens.",
    why: "Open, low-pressure thinking refreshes a flat or stuck mind." },
];

function riskOf(dashboard: DashboardPayload): Risk {
  const cat = (dashboard.cli_category || "").toLowerCase();
  if (cat === "high") return "high";
  if (cat === "medium" || cat === "moderate") return "medium";
  if (cat === "low") return "low";
  // No category from the backend: fall back to the raw CLI.
  // 0.15 is the same "elevated" threshold buildCtx already used.
  if (dashboard.cli > 0.3) return "high";
  if (dashboard.cli > 0.15) return "medium";
  return "low";
}

export function buildCtx(dashboard: DashboardPayload, twin: TwinPayload | null, type: string, now: Date = new Date()): Ctx {
  const above = (f: string) => twin?.deviations[f]?.status === "above_normal";
  const cat = (dashboard.cli_category || "").toLowerCase();
  return {
    type,
    hour: now.getHours(),
    highLoad: cat === "high" || cat === "medium" || cat === "moderate" || dashboard.cli > 0.15,
    late: (dashboard.late_night_count ?? 0) > 0 || above('late_night'),
longSessions: above('work_duration') || (dashboard.avg_duration ?? 0) >= 6,
switching: above('task_switching') || twin?.trends?.['task_switching']?.direction === 'increasing',
    irregular: above("typing_variance"),
    cli: dashboard.cli,
    risk: riskOf(dashboard),
  };
}

type Rule = [boolean, number, string];

function sum(rules: Rule[]): { score: number; reason: string | null } {
  let score = 0;
  let best = 0;
  let reason: string | null = null;
  for (const [on, pts, text] of rules) {
    if (!on) continue;
    score += pts;
    if (pts > best) {
      best = pts;
      reason = text;
    }
  }
  return { score, reason };
}

function rulesFor(id: string, c: Ctx): Rule[] {
  const t = c.type;
  switch (id) {
    case "box-breathing":
      return [[c.irregular, 2, "Your typing rhythm is less steady than usual"], [c.highLoad, 2, "Your load is elevated today"], [t === "overextended" || t === "scattered", 1, "Calms an overextended or scattered mind"]];
    case "phone-free-walk":
      return [[c.longSessions, 2, "Your sessions are longer than usual"], [c.highLoad, 1, "Your load is elevated today"], [t === "drained" || t === "flat" || t === "overextended", 1, "Movement helps this kind of tiredness"]];
    case "eye-rest-20-20-20":
      return [[c.longSessions, 2, "Your sessions are longer than usual"], [c.highLoad, 1, "Your load is elevated today"]];
    case "wrap-up-recovery":
      return [[c.late, 3, "You have been working late at night"], [c.hour >= 17, 1, "Evening is a good time to start winding down"]];
    case "mute-notifications":
      return [[c.switching, 3, "You are switching tasks more than usual"], [t === "scattered", 2, "Your attention is scattered"]];
    case "power-nap":
      return [[c.hour >= 16, -5, ""], [t === "drained", 2, "Your type is mentally drained: rest does more than pushing harder"], [t === "flat", 1, "A short rest can lift flat energy"], [c.longSessions, 1, "Your sessions are longer than usual"]];
    case "desk-stretch":
      return [[c.longSessions, 2, "Long sitting builds tension"], [c.highLoad, 1, "Your load is elevated today"]];
    case "gratitude-note":
      return [[t === "drained", 2, "A small positive reset suits mental drain"], [t === "flat", 2, "A small positive reset suits flat energy"]];
    case "water-snack":
      return [[t === "drained", 1, "Low energy makes tiredness feel worse"], [c.longSessions, 1, "Long sessions are easy to power through without eating"]];
    case "music-break":
      return [[t === "flat", 2, "A small pleasure lifts a flat mood"], [t === "drained", 1, "Easy, low-effort recovery"]];
    case "puzzle-break":
      return [[t === "scattered", 2, "A puzzle holds scattered attention"], [c.switching, 1, "You are switching tasks more than usual"]];
    case "brainstorm-break":
      return [[t === "flat", 2, "Open thinking refreshes a flat mind"]];
    default:
      return [];
  }
}

/** Scores every item for this user, best first. Items with score >= 3 are marked "Suggested for you". */
export function rankRecommendations(ctx: Ctx): Scored[] {
  return CATALOG.map((item, i) => {
    const { score, reason } = sum(rulesFor(item.id, ctx));
    return { item, score, suggested: score >= 3, reason: score >= 3 ? reason : null, i };
  })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ item, score, suggested, reason }) => ({ item, score, suggested, reason }));
}

// ── "Right now" selection: current activity + current CLI ───────────────────

/** How many picks to show at each load level. */
export const SHOW_COUNT: Record<Risk, number> = { high: 5, medium: 4, low: 3 };
const MIN_SHOWN = 3;

/** Items that make no sense at this moment are hidden outright. */
function eligibleNow(id: string, c: Ctx): boolean {
  if (id === "wrap-up-recovery") return c.late || c.hour >= 15; // not a morning task
  return true;
}

/** Extra points from how loaded the user is right now. */
function loadBoost(item: RecoItem, risk: Risk): number {
  const heavy = item.impact !== "Low";
  if (risk === "high") {
    return (item.category === "Rest" || item.category === "Movement" ? 2 : 0)
      + (item.impact === "High" ? 1 : 0)
      + (item.category === "Mind" && heavy ? 1 : 0);
  }
  if (risk === "medium") {
    return (item.category === "Digital" || item.category === "Movement" ? 1 : 0) + (heavy ? 1 : 0);
  }
  return item.impact === "Low" ? 1 : 0; // low load: light upkeep only
}

/**
 * The short list for THIS moment. Uses the live CLI/risk, the time of day and the
 * user's current signals. Returns only the top few, not the whole catalogue.
 */
export function selectForNow(ctx: Ctx): Scored[] {
  const risk: Risk = ctx.risk ?? "low";
  const scored = CATALOG.map((item, i) => ({ item, i }))
    .filter(({ item }) => eligibleNow(item.id, ctx))
    .map(({ item, i }) => {
      const base = sum(rulesFor(item.id, ctx));
      const boost = loadBoost(item, risk);
      const score = base.score + boost;
      const suggested = score >= 3;
      const fallback = `Your load is ${risk} right now`;
      return {
        i,
        item,
        score,
        suggested,
        reason: suggested ? (base.reason ?? fallback) : null,
      };
    })
    .filter((x) => x.score >= 0) // drops items rules ruled out (e.g. a nap in the evening)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const positive = scored.filter((x) => x.score > 0);
  const n = SHOW_COUNT[risk];
  const pick = positive.length >= MIN_SHOWN ? positive.slice(0, n) : scored.slice(0, MIN_SHOWN);
  return pick.map(({ item, score, suggested, reason }) => ({ item, score, suggested, reason }));
}