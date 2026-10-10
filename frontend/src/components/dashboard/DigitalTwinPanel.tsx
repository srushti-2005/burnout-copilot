import {
  Activity,
  Gauge,
  History,
  Info,
  Minus,
  TrendingDown,
  TrendingUp,
  UserRound,
} from "lucide-react";

import type { DeviationInfo, TrendInfo, TwinPayload } from "@/lib/dashboard.types";

const FEATURE_LABELS: Record<string, string> = {
  typing_mean: "Typing speed",
  typing_variance: "Typing irregularity",
  task_switching: "Task switching",
  work_duration: "Session length",
  late_night: "Late-night work",
};

const FEATURE_ORDER = Object.keys(FEATURE_LABELS);
const EXTREME_PCT = 200;

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key;
}

function formatVal(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : String(Math.round(v * 100) / 100);
}

function statusTone(status: DeviationInfo["status"]) {
  if (status === "above_normal") return "border-clay-coral/40 bg-clay-coral/10 text-clay-coral";
  if (status === "below_normal") return "border-clay-teal/40 bg-clay-teal/10 text-clay-teal";
  return "border-border text-muted-foreground";
}

function formatDeviation(dev: DeviationInfo): string {
  if (dev.difference_pct === null) {
    return dev.status === "above_normal" ? "Above usual" : "At your usual";
  }
  const pct = dev.difference_pct;
  if (Math.abs(pct) > EXTREME_PCT) {
    return pct > 0 ? "Far above usual" : "Far below usual";
  }
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

interface TrendChipProps {
  label: string;
  trend: TrendInfo | undefined;
}

function TrendChip({ label, trend }: TrendChipProps) {
  if (!trend || trend.direction === "insufficient_data") {
    return (
      <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">Not enough data yet</span>
      </div>
    );
  }

  const Icon =
    trend.direction === "increasing" ? TrendingUp : trend.direction === "decreasing" ? TrendingDown : Minus;
  const tone =
    trend.direction === "increasing"
      ? "text-clay-coral"
      : trend.direction === "decreasing"
        ? "text-clay-teal"
        : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
      <span className="font-semibold">{label}</span>
      <span className={`flex items-center gap-1 font-bold ${tone}`}>
        <Icon className="size-3.5" />
        {trend.change_pct === null ? "—" : `${trend.change_pct > 0 ? "+" : ""}${trend.change_pct}%`}
      </span>
    </div>
  );
}

interface Props {
  twin: TwinPayload | null;
  loading?: boolean;
}

export function DigitalTwinPanel({ twin, loading = false }: Props) {
  if (!twin) {
    return (
      <div className="clay-card p-6 text-sm text-muted-foreground">
        {loading
          ? "Building your digital twin…"
          : "Your digital twin will appear here once you have at least one tracked session."}
      </div>
    );
  }

  const { profile, baseline, current_state, deviations } = twin;
  const deviationEntries = FEATURE_ORDER.filter((f) => deviations[f]);
  const hasExtreme = deviationEntries.some(
    (f) => Math.abs(deviations[f]?.difference_pct ?? 0) > EXTREME_PCT,
  );

  const currentCli = current_state ? Number(current_state["cli"] ?? 0) : 0;
  const currentRisk = current_state ? String(current_state["risk_level"] ?? "—") : "—";
  const currentRecordedAt = current_state ? current_state["recorded_at"] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="clay-card flex flex-col gap-4 p-5 lg:col-span-1">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-clay-purple/10">
            <UserRound className="size-4 text-clay-purple" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Profile</p>
            <p className="font-display text-xl font-extrabold">
              {profile.age !== null ? `${profile.age} yrs` : "Age not set"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Personal baseline
          </p>
          {baseline.is_established ? (
            <p className="mt-1 text-sm">
              Established from <span className="font-bold">{baseline.session_count}</span> sessions.
            </p>
          ) : (
            <p className="mt-1 text-sm">
              Calibrating — <span className="font-bold">{baseline.session_count}/5</span> sessions
              tracked so far.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Current state
          </p>
          {current_state ? (
            <>
              <p className="mt-1 font-display text-2xl font-extrabold">
                {Math.round(currentCli * 100)}%
                <span className="ml-2 text-sm font-bold text-muted-foreground">{currentRisk}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                as of {currentRecordedAt ? new Date(String(currentRecordedAt)).toLocaleString() : "—"}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No sessions recorded yet.</p>
          )}
        </div>
      </div>

      <div className="clay-card flex flex-col gap-3 p-5 lg:col-span-1">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-clay-teal/10">
            <Gauge className="size-4 text-clay-teal" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Deviation from baseline
            </p>
            <p className="font-display text-xl font-extrabold">
              {deviationEntries.length ? `${deviationEntries.length} tracked` : "Not enough data"}
            </p>
          </div>
        </div>

        {deviationEntries.length ? (
          <>
            <div className="flex flex-col gap-2">
              {deviationEntries.map((f) => {
                const dev = deviations[f];
                if (!dev) return null;
                return (
                  <div
                    key={f}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${statusTone(dev.status)}`}
                  >
                    <span className="font-semibold text-foreground">{featureLabel(f)}</span>
                    <span className="font-bold">{formatDeviation(dev)}</span>
                  </div>
                );
              })}
            </div>
            {hasExtreme && (
              <div className="mt-1 flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Large swings like these are common while your baseline is still small — they
                  settle down as more sessions are tracked.
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Deviations appear once your baseline is established (5+ sessions).
          </p>
        )}
      </div>
    </div>
  );
}

/** Trend card, shown on the Reports page. */
export function TwinTrendCard({ twin }: { twin: TwinPayload | null }) {
  if (!twin) {
    return (
      <div className="clay-card p-6 text-sm text-muted-foreground">
        Trends appear here once you have tracked sessions.
      </div>
    );
  }
  const { historical_state, trends } = twin;
  return (
    <div className="clay-card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-clay-pink/10">
          <Activity className="size-4 text-clay-pink" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Trend, last 4 sessions
          </p>
          <p className="font-display text-xl font-extrabold">
            {historical_state.session_count} total sessions
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <TrendChip label="Burnout risk" trend={trends["cli"]} />
        {FEATURE_ORDER.map((f) => (
          <TrendChip key={f} label={featureLabel(f)} trend={trends[f]} />
        ))}
      </div>

      <div className="mt-1 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
        <History className="size-3.5" />
        Average CLI {formatVal(historical_state.average_cli)} · Peak{" "}
        {formatVal(historical_state.peak_cli)}
      </div>
    </div>
  );
}
