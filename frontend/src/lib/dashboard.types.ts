// Shapes returned by the existing Python service. No calculations live here —
// every value below is produced by cli_logic / forecaster / suggestion_engine.
//ui/src/lib/dashboard.types.ts
export interface SessionRow {
  timestamp: string;
  typing_mean: number;
  typing_variance: number;
  task_switching: number;
  work_duration: number;
  late_night: number;
  hour_of_day: number;
}

export interface TrendPoint {
  session_index: number;
  timestamp: string;
  CLI: number;
  CLI_category: string;
}

export interface ForecastPoint {
  date: string;
  CLI: number;
}

export interface Suggestion {
  title: string;
  body: string;
  icon?: string;
  tone?: string;
}

export interface Driver {
  label: string;
  direction: "up" | "down" | "flat";
  value: string;
  caption: string;
  note: string;
}

export interface CompareMetric {
  label: string;
  caption: string;
  value: string;
  delta: string;
  direction: "up" | "down" | "flat";
}

export interface DashboardPayload {
  ok: boolean;
  error?: string;
  user: { uid: string; email: string; display_name: string };
  cli: number;
  cli_category: string;
  rest_pct: number;
  focus_pct: number;
  balance_pct: number;
  late_night_count: number;
  session_count: number;
  avg_duration: number;
  latest: SessionRow | null;
  trend: TrendPoint[];
  forecast: ForecastPoint[];
  suggestions: Suggestion[];
  drivers: Driver[];
  compare: CompareMetric[];
  headline?: { title: string; body: string };
  stress_level?: string;
  energy_level?: string;
  recovery_state?: string;
  last_synced?: string;
  range_label?: string;
}

export interface AuthResult {
  success: boolean;
  uid?: string;
  email?: string;
  display_name?: string;
  access_token?: string;
  error?: string;
}

// ── Digital Twin (GET /twin) ────────────────────────────────────────────────
export interface TrendInfo {
  direction: "increasing" | "stable" | "decreasing" | "insufficient_data";
  change_pct: number | null;
  values: number[];
}

export interface DeviationInfo {
  current: number;
  baseline: number;
  difference: number;
  difference_pct: number | null;
  status: "above_normal" | "below_normal" | "normal";
}

export interface TwinPayload {
  user_id: string;
  generated_at: string;
  profile: { age: number | null };
  baseline: {
    is_established: boolean;
    session_count: number;
    averages: Record<string, number | null>;
  };
  current_state: Record<string, number | string | null> | null;
  deviations: Record<string, DeviationInfo>;
  historical_state: {
    session_count: number;
    cli_history: (number | null)[];
    risk_history_pct: (number | null)[];
    average_cli: number | null;
    peak_cli: number | null;
    recent_sessions: Record<string, number | string | null>[];
  };
  trends: Record<string, TrendInfo>;
}

// ── Authenticated proxy call ────────────────────────────────────────────────
export interface ApiCallResult {
  status: number; // 0 = network failure
  body: string;   // raw response text; the caller parses it
}

export interface InterventionUiAction {
  kind: "focus_protection" | "break" | "recovery";
  duration_min?: number;
}

export interface InterventionPayload {
  id: string | null;
  contributor: string;
  contributor_label: string;
  risk_level: string;
  cli: number | null;
  intervention_type: string;
  title: string;
  what: string;
  why: string;
  action_label: string;
  ui_action: InterventionUiAction;
  status: string;
}

// --- Append everything below to your existing ui/src/lib/dashboard.types.ts ---

export type ActivityType = "work" | "hobby" | "entertainment" | "break" | "other";

export interface ActivityCheckInPayload {
  session_id?: string | null;
  activity_type: ActivityType;
  engagement_score?: number | null;
  duration_min?: number;
  note?: string | null;
}

export interface ActivityCheckInResult {
  id: string;
  user_id: string;
  session_id: string | null;
  activity_type: ActivityType;
  engagement_score: number | null;
  context_multiplier: number;
  segment_start_utc: string;
  segment_end_utc: string;
  note: string | null;
  created_at: string | null;
}

export interface ActivitySummaryPayload {
  user_id: string;
  days: number;
  total_minutes_logged: number;
  pct_by_activity_type: Partial<Record<ActivityType, number>>;
  avg_engagement_score: number | null;
  checkin_count: number;
}