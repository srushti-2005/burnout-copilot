import { useMemo, useState } from "react";
import { BedDouble, Clock, Gauge, Monitor } from "lucide-react";

import type { DashboardPayload } from "@/lib/dashboard.types";
import { activityMix } from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";
import { rangeStats } from "@/lib/reports";

const RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
] as const;

function Tile({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="clay-card flex flex-col gap-2 p-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="text-clay-purple">{icon}</span>
        {label}
      </p>
      <p className="font-display text-3xl font-extrabold">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** Title, 7D / 30D / 90D tabs and the four summary tiles. Every figure comes from tracked sessions. */
export function AnalyticsTop({ dashboard }: { dashboard: DashboardPayload }) {
  const [days, setDays] = useState<number>(30);
  const stats = useMemo(() => rangeStats(dashboard.trend, days), [dashboard.trend, days]);
  const rangeLabel = `last ${days} days`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">Trends</p>
          <h2 className="mt-1 text-3xl font-extrabold">Analytics</h2>
          <p className="mt-1 text-sm text-muted-foreground">How your load and energy change over time.</p>
        </div>
        <div role="tablist" aria-label="Time range" className="flex rounded-full border border-border p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={days === r.days}
              onClick={() => setDays(r.days)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors duration-300 ${
                days === r.days ? "bg-clay-purple text-card" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<Gauge className="size-4" />}
          label="Avg risk"
          value={stats.avgRiskPct === null ? "—" : `${stats.avgRiskPct}%`}
          note={stats.sessions ? `${stats.sessions} session${stats.sessions === 1 ? "" : "s"}, ${rangeLabel}` : `No sessions in the ${rangeLabel}`}
        />
        <Tile icon={<BedDouble className="size-4" />} label="Avg sleep" value="—" note="Not tracked yet" />
        <Tile
          icon={<Monitor className="size-4" />}
          label="Avg session"
          value={dashboard.session_count ? `${dashboard.avg_duration.toFixed(1)} h` : "—"}
          note={dashboard.session_count ? "All tracked sessions" : "No sessions yet"}
        />
        <Tile
          icon={<Clock className="size-4" />}
          label="Calmest hour"
          value={stats.calmestHour === null ? "—" : `${String(stats.calmestHour).padStart(2, "0")}:00`}
          note={stats.calmestHour === null ? "Needs 3+ sessions in range" : "Lowest average load"}
        />
      </div>
    </div>
  );
}

const SEGMENT: Record<string, string> = {
  work: "var(--clay-purple, #6c63ff)",
  hobby: "var(--clay-teal, #2bb3a3)",
  entertainment: "var(--clay-pink, #e66fa6)",
  break: "var(--clay-yellow, #e0a82e)",
  other: "var(--muted-foreground, #8b87a3)",
};

/** Donut of how the user's logged check-ins split between activity types (real /activity/summary data). */
export function TimeBreakdownCard({ token }: { token: string }) {
  const { activity } = useCopilotData(token);
  const mix = activityMix(activity.data ?? null);
  const total = mix.reduce((s, m) => s + m.pct, 0);

  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <section className="clay-card flex flex-1 flex-col gap-4 p-6" aria-label="Screen time breakdown">
      <h3 className="text-lg font-bold">Screen time breakdown</h3>
      {mix.length === 0 || total <= 0 ? (
        <p className="text-sm text-muted-foreground">
          No check-ins yet. Answer the "what were you doing?" popup and your split will appear here. A split by app
          (work, social, video) is not tracked yet.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <svg viewBox="0 0 100 100" className="size-40" role="img" aria-label={mix.map((m) => `${m.label} ${m.pct}%`).join(", ")}>
            <g transform="rotate(-90 50 50)">
              <circle cx="50" cy="50" r={R} fill="none" stroke="var(--muted, #eee)" strokeWidth="14" />
              {mix.map((m) => {
                const len = (m.pct / total) * C;
                const el = (
                  <circle
                    key={m.type}
                    cx="50"
                    cy="50"
                    r={R}
                    fill="none"
                    stroke={SEGMENT[m.type] ?? SEGMENT["other"]}
                    strokeWidth="14"
                    strokeDasharray={`${len} ${C - len}`}
                    strokeDashoffset={-acc}
                  />
                );
                acc += len;
                return el;
              })}
            </g>
          </svg>
          <ul className="flex flex-col gap-2 text-sm">
            {mix.map((m) => (
              <li key={m.type} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: SEGMENT[m.type] ?? SEGMENT["other"] }} aria-hidden="true" />
                <span className="font-semibold capitalize">{m.label}</span>
                <span className="text-muted-foreground">{m.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mix.length > 0 && (
        <p className="text-xs text-muted-foreground">
          From your activity check-ins, not from app tracking.
        </p>
      )}
    </section>
  );
}
