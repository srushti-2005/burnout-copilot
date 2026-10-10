import type { TrendPoint } from './webTypes';

/** Accepts 0–1 or 0–100 numbers (or numeric strings). Anything else → null (UI shows "—"). */
export function asPct(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n >= 0 && n <= 1 ? n * 100 : n);
}

/** "high" / "Moderate" / "MEDIUM" → "High" | "Medium" | "Low" */
export function normCategory(s?: string | null): 'Low' | 'Medium' | 'High' | undefined {
  if (!s) return undefined;
  const k = s.toLowerCase();
  if (k === 'high') return 'High';
  if (k === 'medium' || k === 'moderate') return 'Medium';
  if (k === 'low') return 'Low';
  return undefined;
}

export const ACTIVITY_COLORS: Record<string, string> = {
  work: '#8b83f0',
  hobby: '#3ecfb2',
  entertainment: '#f08bc4',
  break: '#f5c451',
  other: '#9a96ad',
};

export const TREND_LABEL: Record<string, string> = {
  increasing: 'Rising',
  decreasing: 'Falling',
  stable: 'Steady',
  insufficient_data: 'Not enough data',
};

export function peakInRange(trend: TrendPoint[], days: number): number | null {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  let m: number | null = null;
  for (const p of trend) {
    const t = new Date(p.timestamp);
    if (!Number.isNaN(t.getTime()) && t >= from && Number.isFinite(p.CLI)) m = Math.max(m ?? 0, p.CLI);
  }
  return m === null ? null : Math.round(Math.min(1, m) * 100);
}