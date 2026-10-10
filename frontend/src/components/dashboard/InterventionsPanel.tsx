import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Bell, Check, CheckCircle2, Sparkles, X } from "lucide-react";

import { callApi } from "@/lib/dashboard.functions";
import type { InterventionPayload } from "@/lib/dashboard.types";

interface Props {
  token: string;
  onStartFocus: (durationMin: number) => void;
  onSessionExpired?: () => void;
  reloadKey?: number;
  variant?: "full" | "compact";
}

type Status = "loading" | "ready" | "error";

export function InterventionsPanel({
  token,
  onStartFocus,
  onSessionExpired,
  reloadKey = 0,
  variant = "full",
}: Props) {
  const callServer = useServerFn(callApi);
  const [intervention, setIntervention] = useState<InterventionPayload | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const call = useCallback(
    async <T,>(
      method: "GET" | "POST",
      path: string,
    ): Promise<{ ok: boolean; data: T | null; detail: string | null }> => {
      // FIX: this call was previously unguarded -- if callServer() itself
      // rejected (a network hiccup, a slow/aborted request, anything
      // thrown before the server function even returned a value), that
      // rejection propagated silently up to the caller's .catch(), which
      // only ever recorded "error, no detail". Wrapping this in try/catch
      // and capturing e.message means the banner can now show the real
      // reason instead of a generic message with nothing to go on.
      try {
        const res = await callServer({ data: { token, method, path } });
        if (res.status === 401) {
          onSessionExpired?.();
          return { ok: false, data: null, detail: "Session expired" };
        }
        if (res.status < 200 || res.status >= 300) {
          let detail = `HTTP ${res.status || "unknown"}`;
          try {
            const parsed = res.body ? JSON.parse(res.body) : null;
            if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
          } catch {
            /* body wasn't JSON -- keep the plain HTTP status message */
          }
          return { ok: false, data: null, detail };
        }
        try {
          return {
            ok: true,
            data: res.body ? (JSON.parse(res.body) as T) : null,
            detail: null,
          };
        } catch {
          return { ok: false, data: null, detail: "Malformed response body" };
        }
      } catch (e) {
        return {
          ok: false,
          data: null,
          detail: e instanceof Error ? e.message : "Request failed before reaching the server",
        };
      }
    },
    [callServer, token, onSessionExpired],
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDismissed(false);
    void call<{ intervention: InterventionPayload | null }>("GET", "/interventions/current").then(
      ({ ok, data, detail }) => {
        if (cancelled) return;
        if (!ok) {
          setStatus("error");
          setErrorDetail(detail);
          return;
        }
        setIntervention(data?.intervention ?? null);
        setStatus("ready");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [call, reloadKey]);

  const respond = async (action: "accept" | "skip") => {
    if (!intervention) return;
    if (!intervention.id) {
      setDismissed(true);
      return;
    }
    setBusy(true);
    setActionError(null);
    const { ok, detail } = await call("POST", `/interventions/${intervention.id}/${action}`);
    setBusy(false);
    if (!ok) {
      setActionError(detail || "Could not save your response, please try again.");
      return;
    }
    if (action === "accept" && intervention.ui_action.kind === "focus_protection") {
      onStartFocus(intervention.ui_action.duration_min ?? 20);
    }
    setDismissed(true);
  };

  const errorSuffix = errorDetail ? ` — ${errorDetail}` : "";

  if (variant === "compact") {
    if (status === "loading") {
      return (
        <div className="rounded-3xl border border-border p-5 text-sm text-muted-foreground">
          Checking in on your day…
        </div>
      );
    }
    if (status === "error") {
      return (
        <div className="rounded-3xl border border-clay-coral/30 bg-clay-coral/10 p-5 text-sm text-clay-coral">
          Couldn't load your suggestion right now{errorSuffix}. Try refreshing.
        </div>
      );
    }
    if (dismissed || !intervention) {
      return (
        <div className="flex items-center gap-3 rounded-3xl border border-clay-teal/30 bg-clay-teal/10 p-5 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-clay-teal" />
          <span className="text-muted-foreground">
            You're on track — nothing needs your attention right now.
          </span>
        </div>
      );
    }
    return (
      <div className="clay-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-clay-purple/15">
          <Sparkles className="size-5 text-clay-purple" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Best next step</p>
          <p className="mt-0.5 text-xl font-extrabold">{intervention.action_label}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{intervention.why}</p>
          {actionError && <p className="mt-2 text-sm text-clay-coral">{actionError}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void respond("accept")}
            className="flex items-center gap-2 rounded-full bg-clay-purple px-5 py-2.5 text-sm font-bold text-card transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50"
          >
            <Check className="size-4" />
            {busy ? "Saving…" : "I'll do it"}
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label="Not now"
            title="Not now"
            onClick={() => void respond("skip")}
            className="grid size-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Bell className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="mb-4 rounded-2xl border border-border p-5 text-sm text-muted-foreground">
        Checking what's driving your score right now…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mb-4 rounded-2xl border border-clay-coral/30 bg-clay-coral/10 p-5 text-sm text-clay-coral">
        Couldn't load your recommendation right now{errorSuffix}. Try the refresh button, or check
        back shortly.
      </div>
    );
  }

  if (dismissed || !intervention) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-clay-teal/30 bg-clay-teal/10 p-5 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-clay-teal" />
        <span className="text-muted-foreground">
          Nothing stands out from your usual pattern right now — no intervention needed.
        </span>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-clay-purple/40 bg-clay-purple/10 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card">
          <AlertTriangle className="size-4 text-clay-purple" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-clay-purple">
            {intervention.title} · {intervention.risk_level} risk
          </p>
          <p className="mt-1 text-sm font-bold">{intervention.what}</p>
          <p className="mt-1 text-sm text-muted-foreground">{intervention.why}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond("accept")}
              className="flex items-center gap-2 rounded-2xl bg-clay-purple px-4 py-2 text-sm font-bold text-card transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50"
            >
              <Sparkles className="size-4" />
              {intervention.action_label}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond("skip")}
              className="flex items-center gap-2 rounded-2xl border border-border px-4 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <X className="size-4" />
              Not now
            </button>
          </div>
          {actionError && <p className="mt-2 text-sm text-clay-coral">{actionError}</p>}
        </div>
      </div>
    </div>
  );
}