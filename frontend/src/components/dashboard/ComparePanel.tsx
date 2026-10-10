import { Clock, Keyboard, Moon, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import type { CompareMetric } from "@/lib/dashboard.types";

interface Props {
  name: string;
  metrics: CompareMetric[];
}

const ICONS = [Zap, Clock, Keyboard, Moon];
const CHIPS = ["bg-clay-purple", "bg-clay-yellow", "bg-clay-teal", "bg-clay-pink"];
const TINTS = ["bg-clay-purple/10", "bg-clay-coral/10", "bg-clay-teal/10", "bg-clay-green/10"];

export function ComparePanel({ name, metrics }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visibleMetrics = showAll ? metrics : metrics.slice(0, 4);

  return (
    <div className="clay-card flex flex-1 flex-col p-6 ui-pop-on-reveal">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-1 size-5 text-clay-purple" />
          <div>
            <h2 className="text-xl">How {name || "You"} Compares</h2>
            <p className="text-sm text-muted-foreground">
              See how you compare with the average employee
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className={`rounded-xl border border-border px-3 py-1.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted active:scale-[0.98] ${
            showAll ? "bg-muted" : ""
          }`}
          title={showAll ? "Show this week's comparison" : "Show all available comparison data"}
        >
          {showAll ? "All Available" : "This Week"}
        </button>
      </div>

      <div className="mt-5 grid flex-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleMetrics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comparison data yet.</p>
        ) : (
          visibleMetrics.map((m, i) => {
            const Icon = ICONS[i % ICONS.length]!;
            return (
              <div
                key={m.label}
                className={`flex flex-col items-center rounded-2xl p-4 text-center transition-transform duration-200 hover:-translate-y-1 ${TINTS[i % TINTS.length]}`}
              >
                <span
                  className={`grid size-11 place-items-center rounded-full ${CHIPS[i % CHIPS.length]}`}
                >
                  <Icon className="size-5 text-card" />
                </span>
                <div className="mt-3 text-sm font-bold">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.caption}</div>
                <div className="font-display mt-2 text-3xl font-extrabold">{m.value}</div>
                <div
                  className={`mt-2 text-xs font-bold ${
                    m.direction === "up"
                      ? "text-clay-coral"
                      : m.direction === "down"
                        ? "text-risk-low"
                        : "text-clay-teal"
                  }`}
                >
                  {m.delta}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}