import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Sparkles } from "lucide-react";

import type { TwinPayload } from "@/lib/dashboard.types";
import {
  CATEGORIES,
  RECOS,
  loadDone,
  saveDone,
  suggestedCategories,
  todayKey,
  type RecoCategory,
} from "@/lib/recommendations";

type Filter = "All" | RecoCategory;

interface Props {
  twin: TwinPayload | null;
}

/** Checklist of general wellbeing habits. Ticks are stored per day in this browser only. */
export function RecommendationsChecklist({ twin }: Props) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<Filter>("All");
  const [hideDone, setHideDone] = useState(false);

  useEffect(() => {
    setDone(loadDone(todayKey()));
  }, []);

  const suggested = useMemo(() => suggestedCategories(twin), [twin]);

  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    saveDone(todayKey(), next);
  };

  const total = RECOS.length;
  const pct = Math.round((done.size / total) * 100);
  const visible = RECOS.filter((r) => (filter === "All" || r.category === filter) && !(hideDone && done.has(r.id)));

  return (
    <section className="flex flex-col gap-4" aria-label="Recommendations checklist">
      <div className="clay-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold">Today's progress</span>
          <span className="font-bold">{done.size} of {total}</span>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done.size}
          aria-label="Today's progress"
        >
          <div className="h-full rounded-full bg-clay-purple transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-3xl border border-clay-purple/25 bg-clay-purple/10 p-5">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-clay-purple" aria-hidden="true" />
        <div>
          <p className="font-bold">AI enhancement</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI-generated recommendations tailored to what's driving your score.
          </p>
          <p className="mt-2 text-xs font-semibold text-clay-purple">Integration coming soon</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {(["All", ...CATEGORIES] as Filter[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors duration-300 ${
                filter === c
                  ? "border-clay-purple bg-clay-purple text-card"
                  : "border-border text-muted-foreground hover:bg-muted"
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
        <p className="rounded-2xl border border-border p-5 text-sm text-muted-foreground">
          Nothing left here. Nice work.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((r) => {
            const isDone = done.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                role="checkbox"
                aria-checked={isDone}
                onClick={() => toggle(r.id)}
                className={`clay-card flex items-start gap-3 p-4 text-left transition-opacity duration-300 ${isDone ? "opacity-60" : ""}`}
              >
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 ${
                    isDone ? "border-clay-purple bg-clay-purple text-card" : "border-border"
                  }`}
                  aria-hidden="true"
                >
                  {isDone && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-bold ${isDone ? "line-through" : ""}`}>{r.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{r.body}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-clay-purple/15 px-2.5 py-0.5 text-clay-purple">{r.category}</span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5">{r.impact} impact</span>
                    {r.minutes !== null && (
                      <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5">
                        <Clock className="size-3" aria-hidden="true" />
                        {r.minutes} min
                      </span>
                    )}
                    {suggested.has(r.category) && (
                      <span className="rounded-full bg-clay-teal/15 px-2.5 py-0.5 text-clay-teal">Suggested for you</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        General wellbeing suggestions, not medical advice. "Suggested for you" appears when your own data shows that
        signal above your usual.
      </p>
    </section>
  );
}
