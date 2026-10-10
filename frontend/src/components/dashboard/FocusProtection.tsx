import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { PictureInPicture2, Shield, Timer, X } from "lucide-react";

import { callApi } from "@/lib/dashboard.functions";

interface Snapshot {
  risk: number | null;
  cli: number | null;
  task_switching: number | null;
}

interface FocusResult {
  session_id: string;
  status: "active" | "completed" | "cancelled";
  planned_duration_min: number;
  before: Snapshot;
  after: Snapshot | null;
  comparison: {
    risk_change: number | null;
    task_switching_change: number | null;
    improved: boolean;
  } | null;
  rating: number | null;
  distraction_count: number;
}

interface ActiveResponse {
  session: { id: string; planned_duration_min: number } | null;
  remaining_seconds: number;
}

interface StartResponse {
  session: { id: string; planned_duration_min: number };
  remaining_seconds: number;
}

interface Props {
  token: string;
  recommended?: boolean;
  onSessionExpired?: () => void;
  initialMinutes?: number;
  /** Whether the idle/finished card should be shown at all. The running
   *  mini-widget ignores this and always shows -- it's meant to be visible
   *  the whole session regardless of whether the header dropdown is open. */
  panelOpen: boolean;
  onRequestClose: () => void;
  /** Called the moment a session finishes, so the parent can reopen the
   *  panel automatically -- otherwise a session that finishes while the
   *  panel is closed would show its results nowhere at all. */
  onFinished?: () => void;
}

type Phase = "idle" | "running" | "finished";
type Verb = "GET" | "POST";

const DURATIONS = [10, 20, 30, 45];

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmt(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : String(Math.round(v * 10) / 10);
}

interface MiniWidgetProps {
  remaining: number;
  distractionCount: number;
  busy: boolean;
  onEndEarly: () => void;
  onPopOut?: (() => void) | undefined;
}

// Shared between the in-page corner widget and the Document PiP window --
// deliberately minimal: just the timer and the distraction count, per the
// "top-right corner, only distractions & timer" request.
function FocusMiniWidget({ remaining, distractionCount, busy, onEndEarly, onPopOut }: MiniWidgetProps) {
  return (
    <div className="w-64 rounded-2xl border border-border bg-card p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-clay-purple">
          Focus
        </span>
        {onPopOut && (
          <button
            type="button"
            title="Pop out as a floating window"
            onClick={onPopOut}
            className="grid size-6 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <PictureInPicture2 className="size-3.5" />
          </button>
        )}
      </div>
      <p className="mt-1 font-display text-4xl font-extrabold tabular-nums">{formatClock(remaining)}</p>
      <p className="mt-1 text-xs font-semibold text-muted-foreground">
        {distractionCount === 0 ? "No distractions yet" : `Switched away ${distractionCount}x`}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onEndEarly}
        className="mt-3 w-full rounded-xl border border-border py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        End early
      </button>
    </div>
  );
}

export function FocusProtection({
  token,
  recommended = false,
  onSessionExpired,
  initialMinutes = 20,
  panelOpen,
  onRequestClose,
  onFinished,
}: Props) {
  const callServer = useServerFn(callApi);

  const [phase, setPhase] = useState<Phase>("idle");
  const [minutes, setMinutes] = useState(initialMinutes);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [result, setResult] = useState<FocusResult | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [distractionCount, setDistractionCount] = useState(0);
  const [pipActive, setPipActive] = useState(false);
  const [pipSupported] = useState(
    () => typeof window !== "undefined" && !!window.documentPictureInPicture,
  );

  const endsAtRef = useRef(0);
  const finishingRef = useRef(false);
  const awayRef = useRef(false);
  const pipWindowRef = useRef<Window | null>(null);

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

  const callRef = useRef(call);
  callRef.current = call;

  const closePip = useCallback(() => {
    pipWindowRef.current?.close();
    pipWindowRef.current = null;
    setPipActive(false);
  }, []);

  const openPip = useCallback(async () => {
    if (!pipSupported || !window.documentPictureInPicture) return;
    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 260,
        height: 190,
      });

      // Copy the current document's stylesheets into the PiP window so
      // Tailwind/theme classes render correctly there -- a PiP window
      // starts with an empty <head>. Cross-origin stylesheets (e.g. a
      // fonts CDN) throw on .cssRules access, so those are re-linked by
      // href instead of inlined.
      Array.from(document.styleSheets).forEach((styleSheet) => {
        try {
          const rules = Array.from(styleSheet.cssRules)
            .map((rule) => rule.cssText)
            .join("");
          const style = pipWindow.document.createElement("style");
          style.textContent = rules;
          pipWindow.document.head.appendChild(style);
        } catch {
          if (styleSheet.href) {
            const link = pipWindow.document.createElement("link");
            link.rel = "stylesheet";
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          }
        }
      });
      pipWindow.document.body.style.margin = "0";
      pipWindow.document.body.className = document.body.className;

      pipWindowRef.current = pipWindow;
      setPipActive(true);

      pipWindow.addEventListener("pagehide", () => {
        pipWindowRef.current = null;
        setPipActive(false);
      });
    } catch {
      // Permission denied, popup blocked, or unsupported -- the in-page
      // corner widget keeps working regardless, so this fails silently.
    }
  }, [pipSupported]);

  useEffect(() => {
    return () => {
      pipWindowRef.current?.close();
    };
  }, []);

  const beginRunning = useCallback((id: string, remainingSeconds: number) => {
    finishingRef.current = false;
    awayRef.current = false;
    endsAtRef.current = Date.now() + remainingSeconds * 1000;
    setSessionId(id);
    setRemaining(remainingSeconds);
    setDistractionCount(0);
    setPhase("running");
  }, []);

  useEffect(() => {
    let cancelled = false;
    callRef
      .current<ActiveResponse>("GET", "/focus/active")
      .then((data) => {
        if (!cancelled && data.session) beginRunning(data.session.id, data.remaining_seconds);
      })
      .catch(() => {
        /* no active session, or offline: stay idle */
      });
    return () => {
      cancelled = true;
    };
  }, [beginRunning]);

  const finish = useCallback(
    async (cancelledByUser: boolean) => {
      if (!sessionId || finishingRef.current) return;
      finishingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const data = await callRef.current<FocusResult>("POST", `/focus/${sessionId}/end`, {
          cancelled: cancelledByUser,
          distraction_count: distractionCount,
        });
        setResult(data);
        setPhase("finished");
        closePip();
        onFinished?.();
      } catch (e) {
        finishingRef.current = false;
        setError(e instanceof Error ? e.message : "Could not end the session");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, distractionCount, closePip, onFinished],
  );

  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const left = Math.max(0, Math.round((endsAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void finish(false);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, finish]);

  // Focus Guard: Page Visibility + window blur/focus. This is what
  // actually detects "left this tab/window" -- it works whether the user
  // switches to another tab, another browser window, or a completely
  // different application (all of these blur the current window).
  useEffect(() => {
    if (phase !== "running") return;

    const markAway = () => {
      if (!awayRef.current) {
        awayRef.current = true;
        setDistractionCount((c) => c + 1);
      }
    };
    const markBack = () => {
      awayRef.current = false;
    };
    const onVisibility = () => {
      if (document.hidden) markAway();
      else markBack();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", markBack);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", markBack);
    };
  }, [phase]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call<StartResponse>("POST", "/focus/start", {
        planned_duration_min: minutes,
      });
      setResult(null);
      setRating(null);
      setFeedbackSent(false);
      beginRunning(data.session.id, data.remaining_seconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start focus mode");
    } finally {
      setBusy(false);
    }
  };

  const refreshResult = async () => {
    if (!sessionId) return;
    try {
      setResult(await call<FocusResult>("GET", `/focus/${sessionId}/result`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh results");
    }
  };

  const submitFeedback = async (value: number) => {
    if (!sessionId) return;
    setRating(value);
    try {
      const data = await call<FocusResult>("POST", `/focus/${sessionId}/feedback`, {
        rating: value,
      });
      setResult(data);
      setFeedbackSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save feedback");
    }
  };

  const reset = () => {
    setPhase("idle");
    setSessionId(null);
    setResult(null);
    setError(null);
  };

  // RUNNING: always shows the mini widget, regardless of panelOpen, so the
  // timer and distraction count keep tracking even if the header dropdown
  // is closed. Portals to the PiP window when active, otherwise to a fixed
  // corner of the current page -- never a full-screen takeover.
  if (phase === "running") {
    const widget = (
      <FocusMiniWidget
        remaining={remaining}
        distractionCount={distractionCount}
        busy={busy}
        onEndEarly={() => void finish(true)}
        onPopOut={pipSupported && !pipActive ? () => void openPip() : undefined}
      />
    );

    if (pipActive && pipWindowRef.current) {
      return createPortal(widget, pipWindowRef.current.document.body);
    }
    return createPortal(<div className="fixed right-4 top-4 z-[100]">{widget}</div>, document.body);
  }

  if (!panelOpen) return null;

  const backdrop = <div className="fixed inset-0 z-20" onClick={onRequestClose} />;

  const shell = (children: React.ReactNode) => (
    <>
      {createPortal(backdrop, document.body)}
      {createPortal(
        <div
          className="fixed right-6 top-24 z-30 w-full max-w-sm overflow-hidden rounded-3xl bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Focus Mode
            </span>
            <button
              type="button"
              aria-label="Close Focus Mode panel"
              onClick={onRequestClose}
              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {children}
        </div>,
        document.body,
      )}
    </>
  );

  if (phase === "finished" && result) {
    const c = result.comparison;
    return shell(
      <div className="p-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-clay-purple">
          Focus session {result.status === "cancelled" ? "ended early" : "complete"}
        </p>
        <h3 className="mt-1 text-xl font-extrabold">Before vs after</h3>

        <div className="mt-4 rounded-2xl border border-border p-4">
          <p className="text-xs font-bold uppercase text-muted-foreground">Focus continuity</p>
          <p className="mt-1 text-sm font-bold">
            {result.distraction_count === 0
              ? "You stayed on this tab the whole session."
              : `You switched away ${result.distraction_count} time${result.distraction_count === 1 ? "" : "s"} during this session.`}
          </p>
        </div>

        {result.after ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border p-4">
              <p className="text-xs font-bold uppercase text-muted-foreground">Task switching</p>
              <p className="mt-1 font-display text-2xl font-extrabold">
                {fmt(result.before.task_switching)} → {fmt(result.after.task_switching)}
              </p>
            </div>
            <div className="rounded-2xl border border-border p-4">
              <p className="text-xs font-bold uppercase text-muted-foreground">Predicted risk</p>
              <p className="mt-1 font-display text-2xl font-extrabold">
                {fmt(result.before.risk)} → {fmt(result.after.risk)}
              </p>
            </div>
            {c && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {c.improved
                  ? "Your predicted risk went down during this session."
                  : "Your predicted risk did not drop this time. That's useful information too."}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-border p-4 text-sm text-muted-foreground">
            Your after-session reading isn't in yet. It appears once the tracker records your
            next session.
            <button
              type="button"
              onClick={() => void refreshResult()}
              className="ml-2 font-bold text-clay-purple underline"
            >
              Check again
            </button>
          </div>
        )}

        <div className="mt-5">
          <p className="text-sm font-bold">Was this session helpful?</p>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                disabled={feedbackSent}
                onClick={() => void submitFeedback(n)}
                className={`size-10 rounded-xl border font-bold transition-colors ${
                  rating === n
                    ? "border-clay-purple bg-clay-purple text-card"
                    : "border-border hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {feedbackSent ? "Thanks, feedback saved." : "1 = not helpful, 5 = very helpful"}
          </p>
        </div>
        {error && <p className="mt-3 text-sm text-clay-coral">{error}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-4 w-full rounded-2xl border border-border py-2 text-sm font-bold text-muted-foreground hover:bg-muted"
        >
          Close
        </button>
      </div>,
    );
  }

  return shell(
    <div
      className={`m-3 rounded-2xl border p-5 ${
        recommended ? "border-clay-purple/40 bg-clay-purple/10" : "border-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-card">
          <Shield className="size-4 text-clay-purple" />
        </span>
        <div>
          <h3 className="text-base font-extrabold">Focus Protection</h3>
          <p className="text-sm text-muted-foreground">
            {recommended
              ? "Recommended right now: your task switching is above your usual pattern."
              : "A timed, distraction-free block for your current task."}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {DURATIONS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMinutes(m)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-bold transition-colors ${
              minutes === m
                ? "border-clay-purple bg-clay-purple text-card"
                : "border-border hover:bg-muted"
            }`}
          >
            {m} min
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void start()}
          className="ml-auto flex items-center gap-2 rounded-2xl bg-clay-purple px-5 py-2.5 font-bold text-card transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50"
        >
          <Timer className="size-4" />
          START
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-clay-coral">{error}</p>}
    </div>,
  );
}