import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Keyboard,
  Moon,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { Driver, Suggestion } from "@/lib/dashboard.types";

interface Props {
  headline: { title: string; body: string } | undefined;
  suggestions: Suggestion[];
  drivers: Driver[];
  onViewAll?: () => void;
}

const ICONS = [Zap, Keyboard, Moon, Clock];
const TONES = ["bg-clay-purple", "bg-clay-coral", "bg-clay-teal", "bg-clay-yellow"];

export function InsightsPanel({
  headline,
  suggestions,
  drivers,
  onViewAll,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const first = headline ?? {
    title: suggestions[0]?.title ?? "—",
    body: suggestions[0]?.body ?? "",
  };

  const handleViewAll = () => {
    setShowAll((value) => !value);
    onViewAll?.();
  };

  return (
    <div className="clay-card flex flex-1 flex-col p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-1 size-5 text-clay-purple" />
          <div>
            <h2 className="text-xl">AI Insights for You</h2>
            <p className="text-sm text-muted-foreground">
              Personalised insights based on your behavior
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleViewAll}
          className="rounded-2xl border border-border px-4 py-2 text-sm font-bold transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted active:scale-[0.98]"
        >
          {showAll ? "Show Less" : "View All Insights"}
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-gradient-to-r from-clay-purple/20 via-clay-pink/20 to-clay-coral/20 p-5">
        <div className="font-display text-lg font-extrabold">{first.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{first.body}</p>
      </div>

      {showAll && suggestions.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {suggestions.map((suggestion, index) => (
            <article
              key={`${suggestion.title}-${index}`}
              className="rounded-2xl border border-border bg-card/70 p-4 ui-pop-card"
            >
              <div className="text-sm font-bold">{suggestion.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{suggestion.body}</p>
            </article>
          ))}
        </div>
      )}

      <h3 className="mt-6 text-lg">Key Drivers</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        {drivers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drivers available yet.</p>
        ) : (
          drivers.slice(0, 3).map((d, i) => {
            const Icon = ICONS[i % ICONS.length]!;
            return (
              <div
                key={d.label}
                className="rounded-2xl border border-border p-4 transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full ${TONES[i % TONES.length]}`}
                  >
                    <Icon className="size-4 text-card" />
                  </span>
                  <div>
                    <div className="text-sm font-bold">{d.label}</div>
                    <div className="text-xs text-muted-foreground">{d.caption}</div>
                  </div>
                </div>
                <div
                  className={`mt-3 flex items-center gap-1 font-display text-2xl font-extrabold ${
                    d.direction === "up" ? "text-clay-coral" : "text-risk-low"
                  }`}
                >
                  {d.direction === "up" ? (
                    <ArrowUp className="size-5" />
                  ) : d.direction === "down" ? (
                    <ArrowDown className="size-5" />
                  ) : null}
                  {d.value}
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{d.note}</p>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}