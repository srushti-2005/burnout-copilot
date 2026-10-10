import { Ban, Sparkles } from "lucide-react";

import type { DashboardPayload, TwinPayload } from "@/lib/dashboard.types";
import { exhaustionProfile, rankedDeviations, resetsFor, type ViewId } from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";

interface Props {
  token: string;
  dashboard: DashboardPayload;
  twin: TwinPayload | null;
  onStartFocus: (minutes: number) => void;
  onNavigate: (view: ViewId) => void;
}

/** What to avoid today, keyed to the user's own strongest signal. No raw percentages are shown. */
const AVOID: Record<string, string> = {
  task_switching: "Juggling many tasks at once",
  typing_variance: "Pushing on when your work feels scattered",
  work_duration: "Long stretches without a break",
  late_night: "Working late tonight",
  typing_mean: "Racing at full speed",
};
const AVOID_DEFAULT = "Skipping your breaks";

/** "Your plan for today": one thing to avoid, one thing to do. Short on purpose. */
export function CopilotBriefing({ token, dashboard, twin, onStartFocus, onNavigate }: Props) {
  const { activity } = useCopilotData(token);
  const prof = exhaustionProfile(dashboard, twin, activity.data ?? null);
  const age = twin?.profile.age ?? null;
  const top = resetsFor(prof.type, age)[0];

  const strongest = rankedDeviations(twin).find(([, d]) => d.status === "above_normal");
  const avoid = (strongest && AVOID[strongest[0]]) || AVOID_DEFAULT;

  return (
    <section className="clay-card flex flex-col gap-4 p-6" aria-label="Your plan for today">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">
        <Sparkles className="size-3.5" aria-hidden="true" />
        Your plan for today
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex items-start gap-3 rounded-2xl border border-clay-coral/40 bg-clay-coral/10 p-4">
          <Ban className="mt-0.5 size-4 shrink-0 text-clay-coral" aria-hidden="true" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Avoid</p>
            <p className="mt-0.5 text-sm font-bold">{avoid}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-clay-teal/40 bg-clay-teal/10 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Do this</p>
            <p className="mt-0.5 text-sm font-bold">
              {top ? `${top.title} (${top.minutes} min)` : "Take a short, screen-free break"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("recommendations")}
              className="rounded-xl bg-clay-purple px-3 py-1.5 text-xs font-bold text-card transition-transform active:scale-95"
            >
              Open reset menu
            </button>
            <button
              type="button"
              onClick={() => onStartFocus(25)}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-muted"
            >
              Start focus
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
