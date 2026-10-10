// ui/src/components/dashboard/FeatureCards.tsx  (NEW FILE)
// One distinct, personalised card per tab:
//   Digital Twin   -> ExhaustionFingerprint
//   Recommendations-> ResetMenu
//   Analytics      -> ForecastGuard
//   AI Insights    -> FairLoadCard
import { useEffect, useState } from "react";
import { Fingerprint, Play, Scale, Timer } from "lucide-react";

import type { DashboardPayload, TwinPayload } from "@/lib/dashboard.types";
import {
  FEATURE_LABELS, activityMix, ageBand, exhaustionProfile, rankedDeviations, resetsFor,
  type ResetIdea, type ViewId,
} from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";
import { RecommendationArt } from "./RecommendationArt";

const BAR: Record<string, string> = {
  work: "bg-clay-purple", hobby: "bg-clay-teal", entertainment: "bg-clay-pink", break: "bg-clay-yellow", other: "bg-muted-foreground",
};

function Header({ icon, tone, eyebrow, title, sub }: { icon: React.ReactNode; tone: string; eyebrow: string; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`grid size-10 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        <h3 className="font-display text-xl font-extrabold">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

// ───────────── Digital Twin tab ─────────────
interface TwinProps { token: string; dashboard: DashboardPayload; twin: TwinPayload | null; onNavigate: (v: ViewId) => void }

export function ExhaustionFingerprint({ token, dashboard, twin, onNavigate }: TwinProps) {
  const { activity } = useCopilotData(token);
  const prof = exhaustionProfile(dashboard, twin, activity.data ?? null);
  const age = twin?.profile.age ?? null;
  const top = resetsFor(prof.type, age)[0];
  const devs = rankedDeviations(twin).filter(([, d]) => d.status !== "normal").slice(0, 3);

  return (
    <section className="clay-card flex flex-col gap-3 p-5" aria-label="Your exhaustion fingerprint">
      <Header
        icon={<Fingerprint className="size-4 text-clay-purple" />} tone="bg-clay-purple/10"
        eyebrow="Your exhaustion fingerprint" title={prof.label} sub={prof.summary}
      />
      {devs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {devs.map(([f, d]) => {
            const pct = d.difference_pct;
            const above = d.status === "above_normal";
            const txt = pct === null || Math.abs(pct) > 200 ? (above ? "far above usual" : "far below usual") : `${pct > 0 ? "+" : ""}${pct}%`;
            return (
              <span key={f} className={`rounded-full border px-3 py-1 text-xs font-semibold ${above ? "border-clay-coral/40 bg-clay-coral/10" : "border-clay-teal/40 bg-clay-teal/10"}`}>
                {FEATURE_LABELS[f]} {txt}
              </span>
            );
          })}
        </div>
      )}
      {top && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Best reset:</span>
          <span className="font-bold">{top.title} ({top.minutes} min)</span>
          <button type="button" onClick={() => onNavigate("recommendations")}
            className="rounded-xl bg-clay-purple px-3 py-1 text-xs font-bold text-card active:scale-95">
            Open
          </button>
        </p>
      )}
    </section>
  );
}

// ───────────── Recommendations tab ─────────────
function ResetCard({ idea }: { idea: ResetIdea }) {
  const [left, setLeft] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) { setLeft(null); setDone(true); return; }
    const t = setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const mm = left === null ? "" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <article className="flex gap-3 rounded-2xl border border-border p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold">{idea.title}</h4>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Timer className="size-3" />{idea.minutes} min</span>
      </div>
      <p className="text-sm">{idea.how}</p>
      <p className="text-xs text-muted-foreground">{idea.why}</p>
      <div className="mt-1 flex items-center gap-2">
        {left === null ? (
          <button type="button" onClick={() => { setDone(false); setLeft(idea.minutes * 60); }}
            className="flex items-center gap-1.5 rounded-xl bg-clay-purple px-3 py-1.5 text-xs font-bold text-card active:scale-95">
            <Play className="size-3" /> Start timer
          </button>
        ) : (
          <>
            <span className="font-display text-lg font-extrabold text-clay-purple" aria-live="polite">{mm}</span>
            <button type="button" onClick={() => setLeft(null)}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted">Stop</button>
          </>
        )}
        {done && <span className="text-xs font-bold text-clay-teal">Done. Nice reset.</span>}
      </div>
      </div>
      <div className="shrink-0 self-center"><RecommendationArt title={idea.title} id={idea.id} /></div>
    </article>
  );
}

export function ResetMenu({ token, dashboard, twin }: { token: string; dashboard: DashboardPayload; twin: TwinPayload | null }) {
  const { activity } = useCopilotData(token);
  const prof = exhaustionProfile(dashboard, twin, activity.data ?? null);
  const age = twin?.profile.age ?? null;
  const band = ageBand(age);
  const ideas = resetsFor(prof.type, age, 6);

  return (
    <section className="clay-card flex flex-col gap-4 p-6" aria-label="Reset menu">
      <Header
        icon={<Timer className="size-4 text-clay-teal" />} tone="bg-clay-teal/10"
        eyebrow="Reset menu" title="Breaks picked for how you're tired"
        sub={`Your type: ${prof.label} · ${band.label}. A puzzle, a brainstorm, a nap or a walk: whichever fits you right now.`}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ideas.map((i) => <ResetCard key={i.id} idea={i} />)}
      </div>
      <p className="text-xs text-muted-foreground">General wellbeing suggestions, not medical advice.</p>
    </section>
  );
}

// ───────────── AI Insights tab ─────────────
export function FairLoadCard({ token }: { token: string }) {
  const { activity } = useCopilotData(token);
  const a = activity.data ?? null;
  const mix = activityMix(a);

  return (
    <section className="clay-card flex flex-col gap-4 p-6" aria-label="Fair load">
      <Header
        icon={<Scale className="size-4 text-clay-purple" />} tone="bg-clay-purple/10"
        eyebrow="Fair load" title="Not all screen time is equal"
        sub="Draining work counts fully toward burnout. Time you enjoy counts far less, as little as 5%."
      />
      {mix.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No check-ins yet. Answer the next popup ("what were you doing?") and this card will show how your week splits between draining and enjoyable time.
        </p>
      ) : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={mix.map((m) => `${m.label} ${m.pct}%`).join(", ")}>
            {mix.map((m) => <div key={m.type} className={BAR[m.type] ?? "bg-muted-foreground"} style={{ width: `${m.pct}%` }} />)}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {mix.map((m) => (
              <span key={m.type} className="flex items-center gap-2">
                <span className={`inline-block size-3 rounded-full ${BAR[m.type] ?? "bg-muted-foreground"}`} aria-hidden="true" />
                <span className="font-bold">{m.label}</span> {m.pct}%
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {a?.checkin_count ?? 0} check-ins
            {a?.avg_engagement_score != null ? ` · average engagement ${a.avg_engagement_score.toFixed(1)}/5` : ""}. Higher engagement means your work is costing you less.
          </p>
        </>
      )}
    </section>
  );
}