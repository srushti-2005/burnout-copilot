import { useEffect, useState } from "react";
import { BedDouble, Brain, HeartPulse, Info, Monitor, Play, Timer, Zap } from "lucide-react";

import type { DashboardPayload, TwinPayload } from "@/lib/dashboard.types";
import { InterventionsPanel } from "./InterventionsPanel";
import { CopilotBriefing } from "./CopilotBriefing";
import { exhaustionProfile, resetsFor, type ResetIdea, type ViewId } from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";
import { RecommendationArt } from "./RecommendationArt";

interface Props {
  name: string;
  dashboard: DashboardPayload;
  twin: TwinPayload | null;
  token: string;
  onStartFocus: (minutes: number) => void;
  onSessionExpired?: () => void;
  reloadKey: number;
  onNavigate?: (view: ViewId) => void;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function ringColor(category: string): string {
  const c = category.toLowerCase();
  if (c === "high") return "var(--clay-coral)";
  if (c === "medium" || c === "moderate") return "var(--clay-yellow)";
  return "var(--risk-low)";
}

function friendlyLabel(category: string): string {
  const c = category.toLowerCase();
  if (c === "high") return "Elevated";
  if (c === "medium" || c === "moderate") return "Moderate";
  if (c === "low") return "Balanced";
  return category || "—";
}

/** "64%" -> 64. Returns null for anything that is not a percentage, so no bar is drawn. */
function pctOf(s: string): number | null {
  const m = /^\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/.exec(s);
  return m && m[1] ? Math.max(0, Math.min(100, Number(m[1]))) : null;
}

function LoadBar({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const pct = pctOf(value);
  return (
    <div className="rounded-2xl bg-muted/50 p-5">
      <p className="flex items-center gap-3 text-base font-semibold">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-clay-purple/15 text-clay-purple">{icon}</span>
        {label}
      </p>
      <p className="mt-3 text-xl font-extrabold">{value}</p>
      {pct !== null && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-clay-purple transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function StatTile({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="clay-card p-5">
      <p className="flex items-center gap-3 text-base font-semibold">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-clay-purple/15 text-clay-purple">{icon}</span>
        {label}
      </p>
      <p className="mt-3 font-display text-3xl font-extrabold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function QuickResetCard({ idea }: { idea: ResetIdea }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      setLeft(null);
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  const mm = left === null ? "" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <article className="clay-card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between">
        <RecommendationArt title={idea.title} id={idea.id} />
        <span className="text-xs text-muted-foreground">{idea.minutes} min</span>
      </div>
      <div>
        <h4 className="text-lg font-extrabold">{idea.title}</h4>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{idea.how}</p>
      </div>
      {left === null ? (
        <button
          type="button"
          onClick={() => setLeft(idea.minutes * 60)}
          className="mt-1 flex items-center justify-center gap-2 rounded-2xl border border-border py-2.5 text-sm font-bold transition-colors hover:bg-muted"
        >
          <Play className="size-4" /> Start
        </button>
      ) : (
        <div className="mt-1 flex items-center justify-between rounded-2xl border border-clay-purple/40 px-4 py-2.5">
          <span className="font-display text-lg font-extrabold text-clay-purple" aria-live="polite">{mm}</span>
          <button type="button" onClick={() => setLeft(null)} className="text-sm font-bold text-muted-foreground hover:text-foreground">
            Stop
          </button>
        </div>
      )}
    </article>
  );
}

export function HomeOverview({ name, dashboard, twin, token, onStartFocus, onSessionExpired, reloadKey, onNavigate }: Props) {
  const { activity } = useCopilotData(token);
  const percent = Math.round(Math.max(0, Math.min(dashboard.cli, 1)) * 100);
  const category = dashboard.cli_category || "Low";
  const color = ringColor(category);
  const label = friendlyLabel(category);

  const R = 54;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - percent / 100);

  const cliTrend = twin?.trends["cli"];
  const trendCaption =
    !cliTrend || cliTrend.direction === "insufficient_data"
      ? "Still learning your usual pattern."
      : cliTrend.direction === "stable"
        ? "Close to your usual routine."
        : cliTrend.direction === "increasing"
          ? "Trending higher than usual recently."
          : "Trending lower than usual recently.";

  const mentalLoad = dashboard.stress_level || (percent <= 25 ? "Low" : percent <= 70 ? "Moderate" : "High");
  const energy = dashboard.energy_level || `${100 - percent}%`;

  const now = new Date();
  const dateLine = `${now.toLocaleDateString(undefined, { weekday: "long" })} · ${now.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;

  const prof = exhaustionProfile(dashboard, twin, activity.data ?? null);
  const quickResets = resetsFor(prof.type, twin?.profile.age ?? null, 3);
  const insights = dashboard.suggestions.slice(0, 3);
  const hasSessions = dashboard.session_count > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-semibold text-clay-purple">{dateLine}</p>
        <h2 className="font-display mt-1 text-4xl font-extrabold sm:text-5xl">
          {getGreeting()}, {name || "there"}.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">A gentler day starts here.</p>
      </div>

      <div className="clay-card flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        <div className="grid place-items-center">
          <svg viewBox="0 0 130 130" className="size-40" role="img" aria-label={`Burnout risk ${percent} percent, ${label}`}>
            <circle cx="65" cy="65" r={R} fill="none" stroke="var(--muted)" strokeWidth="10" />
            <circle
              cx="65" cy="65" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 65 65)"
              style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)" }}
            />
            <text x="65" y="62" textAnchor="middle" fontSize="28" fontWeight="800" className="fill-foreground font-display">
              {percent}%
            </text>
            <text x="65" y="82" textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="1" fill={color}>
              {label.toUpperCase()}
            </text>
          </svg>
        </div>
        <div className="flex-1">
          <p className="flex items-center gap-2 text-sm font-bold text-clay-purple">
            <HeartPulse className="size-4" aria-hidden="true" />
            Today's burnout risk
          </p>
          <h3 className="mt-1 text-2xl font-extrabold">{dashboard.headline?.title || `Your load looks ${label.toLowerCase()}.`}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{dashboard.headline?.body || trendCaption}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <LoadBar icon={<Brain className="size-6" />} label="Mental load" value={mentalLoad} />
            <LoadBar icon={<Zap className="size-6" />} label="Energy" value={energy} />
          </div>
        </div>
      </div>

      <CopilotBriefing token={token} dashboard={dashboard} twin={twin} onStartFocus={onStartFocus} onNavigate={onNavigate ?? (() => {})} />

      <InterventionsPanel
        token={token}
        onStartFocus={onStartFocus}
        reloadKey={reloadKey}
        variant="compact"
        {...(onSessionExpired ? { onSessionExpired } : {})}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<Monitor className="size-5" />} label="Work time" value={hasSessions ? `${dashboard.avg_duration.toFixed(1)} h` : "—"} note={hasSessions ? "Average session" : "No sessions yet"} />
        <StatTile icon={<Timer className="size-5" />} label="Focus" value={hasSessions ? `${dashboard.focus_pct}%` : "—"} note="Focus score" />
        <StatTile icon={<Brain className="size-5" />} label="Rest" value={hasSessions ? `${dashboard.rest_pct}%` : "—"} note={`${dashboard.late_night_count} late-night session${dashboard.late_night_count === 1 ? "" : "s"}`} />
        <StatTile icon={<BedDouble className="size-5" />} label="Sleep" value="—" note="Not tracked yet" />
      </div>

      {insights.length > 0 && (
        <section className="clay-card flex flex-col gap-3 p-6" aria-label="Insights">
          <h3 className="text-lg font-bold">Insights</h3>
          {insights.map((s, i) => (
            <div key={`${s.title}-${i}`} className="flex items-start gap-3 rounded-2xl bg-muted/50 px-4 py-3">
              <Info className="mt-0.5 size-4 shrink-0 text-clay-purple" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.body}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {quickResets.length > 0 && (
        <section aria-label="Quick reset">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">Quick reset</p>
              <h3 className="mt-1 text-2xl font-extrabold">Choose what feels easy</h3>
            </div>
            <p className="text-sm text-muted-foreground">One small pause is enough.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {quickResets.map((r) => (
              <QuickResetCard key={r.id} idea={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
