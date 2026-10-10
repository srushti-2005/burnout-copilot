import { useEffect, useMemo, useState } from "react";
import { Check, Play, Sparkles, Timer } from "lucide-react";

import type { DashboardPayload, TwinPayload } from "@/lib/dashboard.types";
import { exhaustionProfile } from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";
import { CATEGORIES, buildCtx, rankRecommendations, type Category, type Scored } from "@/lib/recoCatalog";
import { doneToday, setDone } from "@/lib/recoStore";
import { RecommendationArt } from "./RecommendationArt";

interface CardProps {
  entry: Scored;
  done: boolean;
  onToggle: (on: boolean) => void;
}

function RecoCard({ entry, done, onToggle }: CardProps) {
  const { item, suggested } = entry;
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      setLeft(null);
      onToggle(true); // finishing the timer ticks the card
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const mm = left === null ? "" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <article className={`clay-card flex gap-3 p-5 transition-opacity duration-500 ${done ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={`Mark "${item.title}" as done`}
            onClick={() => onToggle(!done)}
            className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-300 ${
              done ? "border-clay-purple bg-clay-purple text-card" : "border-border hover:border-clay-purple"
            }`}
          >
            {done && <Check className="size-3.5" aria-hidden="true" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h4 className={`text-base font-extrabold ${done ? "line-through" : ""}`}>{item.title}</h4>
              {item.minutes !== undefined && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Timer className="size-3" aria-hidden="true" />
                  {item.minutes} min
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-sm">{item.how}</p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-clay-purple/15 px-3 py-0.5 text-xs font-bold text-clay-purple">{item.category}</span>
          <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-bold">{item.impact} impact</span>
          {suggested && (
            <span className="rounded-full bg-clay-teal/15 px-3 py-0.5 text-xs font-bold text-clay-teal">Suggested for you</span>
          )}
        </div>

        {item.minutes !== undefined && (
          <div className="mt-1 flex items-center gap-2">
            {left === null ? (
              <button
                type="button"
                onClick={() => setLeft(item.minutes! * 60)}
                className="flex items-center gap-1.5 rounded-xl bg-clay-purple px-4 py-2 text-xs font-bold text-card transition-all duration-300 hover:-translate-y-0.5 active:scale-95"
              >
                <Play className="size-3" aria-hidden="true" /> Start timer
              </button>
            ) : (
              <>
                <span className="font-display text-lg font-extrabold text-clay-purple" aria-live="polite">{mm}</span>
                <button type="button" onClick={() => setLeft(null)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted">
                  Stop
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 self-center">
        <RecommendationArt title={item.title} id={item.id} />
      </div>
    </article>
  );
}

interface Props {
  token: string;
  dashboard: DashboardPayload;
  twin: TwinPayload | null;
}

export function RecommendationsHub({ token, dashboard, twin }: Props) {
  const { activity } = useCopilotData(token);
  const prof = exhaustionProfile(dashboard, twin, activity.data ?? null);
  const [filter, setFilter] = useState<"All" | Category>("All");
  const [hideDone, setHideDone] = useState(false);
  const [done, setDoneIds] = useState<string[]>([]);

  useEffect(() => {
    setDoneIds(doneToday());
  }, []);

  const ranked = useMemo(
    () => rankRecommendations(buildCtx(dashboard, twin, String(prof.type))),
    [dashboard, twin, prof.type],
  );

  const toggle = (id: string, on: boolean) => setDoneIds(setDone(id, on));

  const visible = ranked.filter(
    (e) => (filter === "All" || e.item.category === filter) && !(hideDone && done.includes(e.item.id)),
  );
  const total = ranked.length;
  const doneCount = ranked.filter((e) => done.includes(e.item.id)).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <section className="flex flex-col gap-5" aria-label="Recommendations">
      <div className="clay-card flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold">
            Today's progress: {doneCount} of {total} done
          </p>
          <span className="text-sm font-bold text-clay-purple">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-clay-purple transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-3xl border border-clay-purple/20 bg-clay-purple/10 p-5">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-clay-purple" aria-hidden="true" />
        <div>
          <p className="font-bold">AI enhancement</p>
          <p className="text-sm text-muted-foreground">AI-generated recommendations tailored to what's driving your score.</p>
          <p className="mt-1 text-xs font-bold text-clay-purple">Integration coming soon</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter recommendations">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={filter === c}
              onClick={() => setFilter(c)}
              className={`rounded-full border px-5 py-2 text-sm font-bold transition-colors duration-300 ${
                filter === c ? "border-clay-purple bg-clay-purple text-card" : "border-border hover:bg-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide completed
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="clay-card p-6 text-sm text-muted-foreground">
          {hideDone ? "Everything here is done. Nice work." : "Nothing in this category yet."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((e) => (
            <RecoCard key={e.item.id} entry={e} done={done.includes(e.item.id)} onToggle={(on) => toggle(e.item.id, on)} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        General wellbeing suggestions, not medical advice. "Suggested for you" appears when your own data shows that signal above your usual.
      </p>
    </section>
  );
}