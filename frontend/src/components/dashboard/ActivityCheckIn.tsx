import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { Briefcase, Coffee, Gamepad2, Palette, X } from "lucide-react";

import { callApi } from "@/lib/dashboard.functions";
import type {
  ActivityCheckInPayload,
  ActivityCheckInResult,
  ActivityType,
} from "@/lib/dashboard.types";

interface Props {
  token: string;
  /** Whether the popup should be showing right now. Parent owns the timer
   *  that decides when a new segment has elapsed -- this component only
   *  renders and submits. */
  visible: boolean;
  /** How many minutes since the last check-in (or session start), shown
   *  to the user and sent as duration_min. */
  elapsedMinutes: number;
  /** Ties the check-in to a specific session row if one exists. */
  sessionId?: string | null;
  onSessionExpired?: () => void;
  onClose: () => void;
  onSubmitted?: (result: ActivityCheckInResult) => void;
}

type Step = "type" | "engagement" | "done";
type Verb = "GET" | "POST";

const ACTIVITY_OPTIONS: { value: ActivityType; label: string; icon: typeof Briefcase }[] = [
  { value: "work", label: "Work", icon: Briefcase },
  { value: "hobby", label: "Hobby / Personal", icon: Palette },
  { value: "entertainment", label: "Entertainment", icon: Gamepad2 },
  { value: "break", label: "Break", icon: Coffee },
];

export function ActivityCheckIn({
  token,
  visible,
  elapsedMinutes,
  sessionId = null,
  onSessionExpired,
  onClose,
  onSubmitted,
}: Props) {
  const callServer = useServerFn(callApi);

  const [step, setStep] = useState<Step>("type");
  const [activityType, setActivityType] = useState<ActivityType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async <T,>(method: Verb, path: string, body?: unknown): Promise<T> => {
      const input: { token: string; method: Verb; path: string; body?: unknown } = {
        token,
        method,
        path,
      };
      if (body !== undefined) input.body = body;

      const res = await callServer({ data: input });

      if (res.status === 401) {
        onSessionExpired?.();
        throw new Error("Your session expired. Please sign in again.");
      }

      let parsed: unknown = null;
      try {
        parsed = res.body ? JSON.parse(res.body) : null;
      } catch {
        parsed = null;
      }

      if (res.status < 200 || res.status >= 300) {
        const detail = (parsed as { detail?: unknown } | null)?.detail;
        throw new Error(
          typeof detail === "string" ? detail : `Request failed (${res.status || "network"})`,
        );
      }
      return parsed as T;
    },
    [callServer, token, onSessionExpired],
  );

  const resetLocal = () => {
    setStep("type");
    setActivityType(null);
    setError(null);
  };

  const submit = async (type: ActivityType, engagementScore: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const payload: ActivityCheckInPayload = {
        session_id: sessionId,
        activity_type: type,
        engagement_score: engagementScore,
        duration_min: elapsedMinutes,
      };
      const result = await call<ActivityCheckInResult>("POST", "/activity/checkin", payload);
      onSubmitted?.(result);
      setStep("done");
      window.setTimeout(() => {
        onClose();
        resetLocal();
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save check-in");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    onClose();
    resetLocal();
  };

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center">
      <div className="fixed inset-0 bg-black/20" onClick={skip} />
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Dismiss check-in"
          onClick={skip}
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" />
        </button>

        {step === "type" && (
          <>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-clay-purple">
              Quick check-in
            </p>
            <h3 className="mt-1 text-lg font-extrabold">
              What were the last {Math.round(elapsedMinutes)} min?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This helps tell focused work apart from time that actually recharges you.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {ACTIVITY_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActivityType(value);
                    if (value === "break") {
                      void submit(value, null);
                    } else {
                      setStep("engagement");
                    }
                  }}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-border p-3 text-sm font-bold transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Icon className="size-4 text-clay-purple" />
                  {label}
                </button>
              ))}
            </div>
            {error && <p className="mt-3 text-sm text-clay-coral">{error}</p>}
          </>
        )}

        {step === "engagement" && activityType && (
          <>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-clay-purple">
              One more thing
            </p>
            <h3 className="mt-1 text-lg font-extrabold">How engaging was it?</h3>
            <p className="mt-1 text-sm text-muted-foreground">1 = draining, 5 = energizing</p>

            <div className="mt-4 flex justify-between gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() => void submit(activityType, n)}
                  className="size-11 rounded-xl border border-border font-bold transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(activityType, null)}
              className="mt-3 w-full rounded-xl border border-border py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Skip this part
            </button>
            {error && <p className="mt-3 text-sm text-clay-coral">{error}</p>}
          </>
        )}

        {step === "done" && (
          <div className="py-4 text-center">
            <p className="text-lg font-extrabold">Got it 👍</p>
            <p className="mt-1 text-sm text-muted-foreground">Saved to your activity log.</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
