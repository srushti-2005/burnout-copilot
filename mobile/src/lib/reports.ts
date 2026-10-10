import type { TrendPoint } from "./webTypes";


export type WeekStatus = "rising" | "easing" | "steady" | "first" | "none";

export const STATUS_LABEL: Record<WeekStatus, string> = {
  rising: "Rising",
  easing: "Easing",
  steady: "Steady",
  first: "First week",
  none: "No data",
};

export interface WeekSummary {
  id: string;
  label: string;
  start: string; // yyyy-mm-dd (local)
  end: string; // yyyy-mm-dd (local)
  sessions: number;
  avgRiskPct: number | null;
  peakRiskPct: number | null;
  tipsDone: number;
  status: WeekStatus;
  summary: string;
}

/** A change of at least this many percentage points counts as rising / easing. */
const CHANGE_POINTS = 5;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function addDays(d: Date, n: number): Date {
  // Calendar arithmetic (not milliseconds) so daylight-saving shifts never move a day.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

interface Pt {
  t: Date;
  cli: number;
}

function toPoints(trend: TrendPoint[]): Pt[] {
  const out: Pt[] = [];
  for (const p of trend) {
    const t = new Date(p.timestamp);
    if (!Number.isNaN(t.getTime())) out.push({ t, cli: clamp01(p.CLI) });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

interface RawWeek {
  start: Date;
  end: Date;
  sessions: number;
  avg: number | null;
  peak: number | null;
  tips: number;
}

function summarise(w: WeekSummary, prevAvg: number | null): string {
  if (w.sessions === 0 || w.avgRiskPct === null) return "No sessions were recorded this week.";
  const n = w.sessions;
  let s = `Your average burnout risk was ${w.avgRiskPct}% across ${n} session${n === 1 ? "" : "s"}`;
  s += w.peakRiskPct !== null && w.peakRiskPct > w.avgRiskPct ? `, peaking at ${w.peakRiskPct}%. ` : ". ";
  if (prevAvg === null) {
    s += "There is no earlier week to compare with yet.";
  } else {
    const diff = w.avgRiskPct - prevAvg;
    if (diff >= CHANGE_POINTS) s += `That is ${diff} points higher than the week before.`;
    else if (diff <= -CHANGE_POINTS) s += `That is ${Math.abs(diff)} points lower than the week before.`;
    else s += "That is close to the week before.";
  }
  return s;
}

/**
 * Rolling 7-day weeks ending today, newest first. Built only from real tracked sessions
 * (the dashboard trend) and the recommendations the user ticked off.
 */
export function buildWeeks(
  trend: TrendPoint[],
  doneByDay: Record<string, number> = {},
  now: Date = new Date(),
  maxWeeks = 6,
): WeekSummary[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const pts = toPoints(trend);
  const raw: RawWeek[] = [];

  for (let i = 0; i <= maxWeeks; i++) {
    const end = addDays(today, -7 * i);
    const start = addDays(end, -6);
    const endExclusive = addDays(end, 1);
    const inWeek = pts.filter((p) => p.t >= start && p.t < endExclusive).map((p) => p.cli);
    let tips = 0;
    for (let k = 0; k < 7; k++) tips += doneByDay[dayKey(addDays(start, k))] ?? 0;
    raw.push({
      start,
      end,
      sessions: inWeek.length,
      avg: inWeek.length ? Math.round(mean(inWeek) * 100) : null,
      peak: inWeek.length ? Math.round(Math.max(...inWeek) * 100) : null,
      tips,
    });
  }

  const weeks: WeekSummary[] = raw.slice(0, maxWeeks).map((w, i) => {
    const prevAvg = raw[i + 1]?.avg ?? null;
    let status: WeekStatus;
    if (w.avg === null) status = "none";
    else if (prevAvg === null) status = "first";
    else if (w.avg - prevAvg >= CHANGE_POINTS) status = "rising";
    else if (w.avg - prevAvg <= -CHANGE_POINTS) status = "easing";
    else status = "steady";

    const base: WeekSummary = {
      id: dayKey(w.start),
      label: `${shortDate(w.start)} – ${shortDate(w.end)}`,
      start: dayKey(w.start),
      end: dayKey(w.end),
      sessions: w.sessions,
      avgRiskPct: w.avg,
      peakRiskPct: w.peak,
      tipsDone: w.tips,
      status,
      summary: "",
    };
    return { ...base, summary: summarise(base, prevAvg) };
  });

  // Hide empty weeks that are older than the oldest week with data (always keep the current week).
  let lastWithData = 0;
  weeks.forEach((w, i) => {
    if (w.sessions > 0) lastWithData = i;
  });
  return weeks.slice(0, lastWithData + 1);
}

export interface RangeStats {
  sessions: number;
  avgRiskPct: number | null;
  /** Hour of day (0-23) with the lowest average load, or null when there is too little data. */
  calmestHour: number | null;
}

export function rangeStats(trend: TrendPoint[], days: number, now: Date = new Date()): RangeStats {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = addDays(today, -(days - 1));
  const to = addDays(today, 1);
  const pts = toPoints(trend).filter((p) => p.t >= from && p.t < to);
  if (pts.length === 0) return { sessions: 0, avgRiskPct: null, calmestHour: null };

  const avgRiskPct = Math.round(mean(pts.map((p) => p.cli)) * 100);
  let calmestHour: number | null = null;
  if (pts.length >= 3) {
    const byHour = new Map<number, number[]>();
    for (const p of pts) {
      const h = p.t.getHours();
      byHour.set(h, [...(byHour.get(h) ?? []), p.cli]);
    }
    let best = Infinity;
    for (const [h, xs] of byHour) {
      const m = mean(xs);
      if (m < best) {
        best = m;
        calmestHour = h;
      }
    }
  }
  return { sessions: pts.length, avgRiskPct, calmestHour };
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(weeks: WeekSummary[]): string {
  const head = ["Week", "Start", "End", "Sessions", "Avg risk %", "Peak risk %", "Tips done", "Status"];
  const rows = weeks.map((w) =>
    [w.label, w.start, w.end, w.sessions, w.avgRiskPct, w.peakRiskPct, w.tipsDone, STATUS_LABEL[w.status]]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}

export function toJson(weeks: WeekSummary[], now: Date = new Date()): string {
  return JSON.stringify(
    {
      generated_at: now.toISOString(),
      app: "MindEase",
      note: "Sleep and screen time are not tracked yet, so they are not included.",
      weeks: weeks.map((w) => ({ ...w, status: STATUS_LABEL[w.status] })),
    },
    null,
    2,
  );
}

