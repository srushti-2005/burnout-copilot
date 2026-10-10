import type { DashboardPayload } from "./dashboard.types";

/**
 * Zeroed payload used when the Python service is unreachable or a user has no
 * sessions yet. It invents nothing: every metric renders as zero/empty.
 */
export function emptyDashboard(error?: string): DashboardPayload {
  return {
    ok: false,
    ...(error ? { error } : {}),
    user: { uid: "", email: "", display_name: "" },
    cli: 0,
    cli_category: "",
    rest_pct: 0,
    focus_pct: 0,
    balance_pct: 0,
    late_night_count: 0,
    session_count: 0,
    avg_duration: 0,
    latest: null,
    trend: [],
    forecast: [],
    suggestions: [],
    drivers: [],
    compare: [],
  };
}
