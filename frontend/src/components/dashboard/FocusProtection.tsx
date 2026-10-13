import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { Monitor, PictureInPicture2, Shield, Timer, X } from "lucide-react";

import { callApi } from "@/lib/dashboard.functions";
import { getAgentMetrics } from "@/lib/agent";

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
  targetName?: string | null;
  stream?: MediaStream | null;
  onEndEarly: () => void;
  onPopOut?: (() => void) | undefined;
}

// Shared between the in-page corner widget and the Document PiP window --
// minimal: timer, target, and distraction count, with optional screen preview.
function FocusMiniWidget({
  remaining,
  distractionCount,
  busy,
  targetName,
  stream,
  onEndEarly,
  onPopOut,
}: MiniWidgetProps) {
  const [showPreview, setShowPreview] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream && showPreview) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, showPreview]);

  return (
    <div className="w-72 rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-clay-purple">
          <Shield className="size-3" /> Focus Mode
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

      {targetName && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-clay-purple/10 px-2.5 py-1 text-[11px] font-semibold text-clay-purple">
          <Monitor className="size-3 shrink-0" />
          <span className="truncate" title={targetName}>
            {targetName}
          </span>
        </div>
      )}

      <p className="mt-1 font-display text-4xl font-extrabold tabular-nums">{formatClock(remaining)}</p>
      <p className="mt-1 text-xs font-semibold text-muted-foreground">
        {distractionCount === 0 ? "Flow state · 0 task switches" : `Switched tasks ${distractionCount}×`}
      </p>

      {stream && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="text-[10px] font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPreview ? "Hide preview" : "Show screen preview"}
          </button>
          {showPreview && (
            <div className="mt-1 overflow-hidden rounded-xl border border-border bg-black/40">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-24 w-full object-cover"
              />
            </div>
          )}
        </div>
      )}

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

  const [targetName, setTargetName] = useState<string | null>(null);
  const [focusStream, setFocusStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const endsAtRef = useRef(0);
  const finishingRef = useRef(false);
  const agentStartSwitchesRef = useRef<number | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setFocusStream(null);
  }, []);

  const pickScreenTarget = async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen selection is not supported in this browser. Please use Chrome, Edge, or Firefox.");
      return false;
    }
    try {
      setError(null);
      // Native browser screen-sharing prompt — zero extensions required!
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      if (!track) return false;

      stopMediaStream();
      streamRef.current = stream;
      setFocusStream(stream);

      const label = track.label || "Selected Tab / Window";
      setTargetName(label);

      track.addEventListener("ended", () => {
        stopMediaStream();
      });

      return true;
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setError(err.message);
      }
      return false;
    }
  };

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
        width: 300,
        height: 230,
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
      stopMediaStream();
    };
  }, [stopMediaStream]);

  const beginRunning = useCallback((id: string, remainingSeconds: number) => {
    finishingRef.current = false;
    agentStartSwitchesRef.current = null;
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
        stopMediaStream();
        onFinished?.();
      } catch (e) {
        finishingRef.current = false;
        setError(e instanceof Error ? e.message : "Could not end the session");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, distractionCount, closePip, stopMediaStream, onFinished],
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

  // Focus Guard: Monitors genuine general task switches via the PC agent
  // instead of falsely penalizing switching away from the MindEase website.
  useEffect(() => {
    if (phase !== "running") {
      agentStartSwitchesRef.current = null;
      return;
    }

    let cancelled = false;

    const pollMetrics = async () => {
      const metrics = await getAgentMetrics();
      if (cancelled || !metrics) return;

      const currentTotal =
        metrics.total_switches !== undefined
          ? metrics.total_switches
          : metrics.switches ?? 0;

      if (agentStartSwitchesRef.current === null) {
        agentStartSwitchesRef.current = currentTotal;
      } else {
        const delta = Math.max(0, currentTotal - agentStartSwitchesRef.current);
        setDistractionCount(delta);
      }
    };

    void pollMetrics();
    const intervalId = window.setInterval(pollMetrics, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
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
    stopMediaStream();
    setTargetName(null);
    setPhase("idle");
    setSessionId(null);
    setResult(null);
    setError(null);
  };

  const handleStart = async () => {
    if (!targetName && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia) {
      await pickScreenTarget();
    }
    await start();
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
        targetName={targetName}
        stream={focusStream}
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
              ? "Deep uninterrupted flow — 0 task switches."
              : `Detected ${result.distraction_count} task switch${result.distraction_count === 1 ? "" : "es"} during this session.`}
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

      <div className="mt-4 rounded-xl border border-border/80 bg-muted/40 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Focus Target / Document
          </p>
          <span className="text-[11px] font-semibold text-clay-purple">No extension needed</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Choose which document, app window, or browser tab you are studying with:
        </p>

        {targetName ? (
          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-clay-purple/40 bg-card p-2.5 shadow-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-clay-purple/10 text-clay-purple">
                <Monitor className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-foreground" title={targetName}>
                  {targetName}
                </p>
                <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  ● Tracking this tab/window
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void pickScreenTarget()}
              className="ml-2 shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void pickScreenTarget()}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-clay-purple/50 bg-card/60 py-2.5 text-xs font-bold text-clay-purple transition-all hover:border-clay-purple hover:bg-clay-purple/10 hover:shadow-xs"
          >
            <Monitor className="size-4" />
            Select Tab, Window, or Screen to Track
          </button>
        )}
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
          onClick={() => void handleStart()}
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