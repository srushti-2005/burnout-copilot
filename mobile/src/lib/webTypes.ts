export type ActivityType = "work" | "hobby" | "entertainment" | "break" | "other";

export interface ActivitySummaryPayload {
  checkin_count: number;
  pct_by_activity_type: Partial<Record<ActivityType, number>>;
  avg_engagement_score: number | null;
}
export interface DeviationInfo {
  status: "above_normal" | "below_normal" | "normal";
  difference_pct: number | null;
}
export type TrendDirection = "increasing" | "decreasing" | "stable" | "insufficient_data";
export interface TrendInfo { direction: TrendDirection; change_pct: number | null }
export interface TrendPoint { timestamp: string; CLI: number }

export interface TwinPayload {
  profile: { age: number | null };
  baseline: { is_established: boolean; session_count: number };
  deviations: Record<string, DeviationInfo>;
  current_state?: { cli: number; risk_level: string; recorded_at: string | null } | null;
  historical_state?: { session_count: number; average_cli: number | null; peak_cli: number | null } | null;
  trends?: Record<string, TrendInfo>;
}
export interface Driver {
  label: string;
  caption?: string;
  direction?: "up" | "down";
  value?: number | string | null;
  note?: string;
}
export interface Suggestion { title: string; body: string }
export interface DashboardPayload {
  cli: number;
  forecast: { date: string; CLI: number }[];
  cli_category?: string;
  stress_level?: number | string | null;
  energy_level?: number | string | null;
  recovery_state?: string | null;
  headline?: { title: string; body: string } | null;
  suggestions?: Suggestion[];
  drivers?: Driver[];
  trend?: TrendPoint[];
  session_count?: number;
  avg_duration?: number;
  focus_pct?: number;
  rest_pct?: number;
  late_night_count?: number;
}
export interface InterventionPayload {
  title: string;
  what: string;
  why: string;
  action_label?: string;
  ui_action?: { kind: string; duration_min?: number };
}