import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Calendar, Heart, Moon, RefreshCw, Shield, Sparkles } from "lucide-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import { callApi, getDashboard, refreshUserToken } from "@/lib/dashboard.functions";
import { disconnectAgent, agentStatus, connectAgent, connectAgentViaDeepLink } from "@/lib/agent";
import { toast } from "sonner";
import {SESSION_EXPIRED_MSG, emptyDashboard } from "@/lib/dashboard.fallback";
import type {DashboardPayload, TwinPayload } from "@/lib/dashboard.types";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { StatCard } from "@/components/dashboard/StatCard";
import { RiskGauge } from "@/components/dashboard/RiskGauge";
import { ForecastChart } from "@/components/dashboard/ForecastChart";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { ComparePanel } from "@/components/dashboard/ComparePanel";
import { FocusProtection } from "@/components/dashboard/FocusProtection";
import { DigitalTwinPanel } from "@/components/dashboard/DigitalTwinPanel";
import { InterventionsPanel } from "@/components/dashboard/InterventionsPanel";
import { HomeOverview } from "@/components/dashboard/HomeOverview";
import { ActivityCheckInProvider } from "@/components/dashboard/ActivityCheckInProvider";
import { CopilotWidget } from "@/components/dashboard/CopilotWidget";
import { ThemeToggle } from "@/components/mindease/ThemeToggle";
import { IntroSplash } from "@/components/mindease/IntroSplash";
import { AnalyticsTop, TimeBreakdownCard } from "@/components/dashboard/AnalyticsOverview";
import { RecommendationsHub } from "@/components/dashboard/RecommendationsHub";
import { ReportsView } from "@/components/dashboard/ReportsView";
import { FairLoadCard } from "@/components/dashboard/FeatureCards";

type ViewId = "home" | "digital-twin" | "recommendations" | "analytics" | "ai-insights" | "reports";

const BREAK_POPUP_CLI_THRESHOLD = 0.15;

function formatToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MindEase — Wellness Dashboard" },
      {
        name: "description",
        content:
          "Live burnout risk, 7-day forecast and personalised insights from your tracked work sessions.",
      },
      { property: "og:title", content: "MindEase — Wellness Dashboard" },
      {
        property: "og:description",
        content: "Live burnout risk, 7-day forecast and personalised insights.",
      },
    ],
  }),
  component: Dashboard,
});

const DASH_CACHE_KEY = "bc_dash_cache_v1";

function readCachedDashboard(uid: string | null): DashboardPayload | undefined {
  if (!uid) return undefined;
  try {
    const raw = localStorage.getItem(`${DASH_CACHE_KEY}:${uid}`);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as DashboardPayload;
    return p?.ok ? p : undefined;
  } catch {
    return undefined;
  }
}

function tokenExpiresWithin(token: string | null, seconds: number): boolean {
  if (!token) return true;
  try {
    const part = token.split(".")[1];
    if (!part) return true;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp !== "number" || payload.exp * 1000 - Date.now() < seconds * 1000;
  } catch {
    return true;
  }
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6" role="status" aria-live="polite">
      <div className="clay-card flex flex-col items-center gap-4 p-10">
        <div className="size-12 animate-spin rounded-full border-4 border-muted border-t-clay-purple" />
        <p className="text-sm font-semibold text-muted-foreground">Loading your dashboard…</p>
        <p className="text-xs text-muted-foreground">The first load can take a few seconds while the server wakes up.</p>
      </div>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [currentView, setCurrentView] = useState<ViewId>("home");
  const [showBreakPopup, setShowBreakPopup] = useState(false);
  const [showFocusPanel, setShowFocusPanel] = useState(false);
  const [focusInitialMinutes, setFocusInitialMinutes] = useState(20);
  const [interventionsReloadKey, setInterventionsReloadKey] = useState(0);
  const [agentStatusInfo, setAgentStatusInfo] = useState<{ installed: boolean; tracking: boolean; email?: string | null }>({ installed: false, tracking: false });
  const [agentInstalled, setAgentInstalled] = useState<boolean | null>(null);
  const [dismissAgentBanner, setDismissAgentBanner] = useState(false);
  const fetchDashboard = useServerFn(getDashboard);
  const callApiFn = useServerFn(callApi);
  const refreshTokenFn = useServerFn(refreshUserToken);

  const [uid, setUid] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const lastGood = useRef<DashboardPayload | null>(null);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const silentRefreshToken = useCallback((): Promise<string | null> => {
  if (refreshInFlight.current) return refreshInFlight.current;
  const run = (async (): Promise<string | null> => {
    const rf = localStorage.getItem("bc_refresh_token");
    if (!rf) return null;
    try {
      const res = await refreshTokenFn({ data: { refreshToken: rf } });
      if (res?.success && res.access_token) {
        localStorage.setItem("bc_token", res.access_token);
        if (res.refresh_token) localStorage.setItem("bc_refresh_token", res.refresh_token);
        tokenRef.current = res.access_token;
        setToken(res.access_token);
        return res.access_token;
      }
    } catch { /* keep current screen state, never auto-logout */ }
    return null;
  })().finally(() => { refreshInFlight.current = null; });
  refreshInFlight.current = run;
  return run;
}, [refreshTokenFn]);

useEffect(() => {
  const loadingFirst = Boolean(token) && !data && isPending;
  if (!ready) return;
  const maybeRefresh = () => {
    if (tokenExpiresWithin(localStorage.getItem("bc_token"), 300)) void silentRefreshToken();
  };
  maybeRefresh();
  const onVisible = () => { if (document.visibilityState === "visible") maybeRefresh(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}, [ready, silentRefreshToken]);

  // ── Buzzer: Web Audio API, no external sound file. Browsers block audio
  // until the page has received at least one real user interaction (a
  // click or keypress) -- this is a browser-enforced anti-autoplay rule,
  // not something any code can bypass. So the first click/keydown
  // anywhere on the page "unlocks" one shared AudioContext; every
  // playAlertBuzzer() call afterwards reuses that same unlocked context.
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx();
      }
      audioCtxRef.current?.resume().catch(() => {
        /* ignore — will simply try again on the next interaction */
      });
    };
    document.addEventListener("click", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  const playAlertBuzzer = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return; // no interaction yet this session -- browser would block it anyway
    const now = ctx.currentTime;
    // Two short triangle-wave beeps: noticeable, but not harsh.
    [0, 0.22].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  }, []);

  const endSession = useCallback(() => {
    void disconnectAgent(); // stop PC tracking for this user (no-op if the agent is not installed)
    localStorage.removeItem("bc_uid");
    localStorage.removeItem("bc_token");
    localStorage.removeItem("bc_refresh_token");
    const u = localStorage.getItem("bc_uid");
    if (u) localStorage.removeItem(`${DASH_CACHE_KEY}:${u}`);
    void navigate({ to: "/login" });
  }, [navigate]);

  useEffect(() => {
    const storedUid = localStorage.getItem("bc_uid");
    const storedToken = localStorage.getItem("bc_token");
    if (!storedUid || !storedToken) {
      localStorage.removeItem("bc_uid");
      localStorage.removeItem("bc_token");
      localStorage.removeItem("bc_refresh_token");
      void navigate({ to: "/login" });
      return;
    }
    setToken(storedToken);
    setUid(storedUid);
    setReady(true);
  }, [navigate]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !/Windows/i.test(navigator.userAgent)) return;

    let active = true;
    const checkAndSync = async () => {
      try {
        const s = await agentStatus();
        if (!active) return;
        setAgentStatusInfo(s);
        setAgentInstalled(s.installed);
        const storedToken = localStorage.getItem("bc_token");
        const storedRefresh = localStorage.getItem("bc_refresh_token");
        if (s.installed && !s.tracking && storedToken) {
          await connectAgent(storedToken, storedRefresh || undefined);
          const updated = await agentStatus();
          if (active) {
            setAgentStatusInfo(updated);
            setAgentInstalled(updated.installed);
          }
        }
      } catch {
        if (active) {
          setAgentInstalled(false);
          setAgentStatusInfo({ installed: false, tracking: false });
        }
      }
    };

    void checkAndSync();
    const intervalMs = agentStatusInfo.tracking ? 20000 : 4000;
    const timer = setInterval(() => {
      void checkAndSync();
    }, intervalMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [agentStatusInfo.tracking, token]);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { data, refetch, isFetching, isPending, error: queryError } = useQuery({
    queryKey: ["dashboard", uid],
    queryFn: async (): Promise<DashboardPayload> => {
      if (tokenExpiresWithin(tokenRef.current, 60)) await silentRefreshToken();
      let res = await fetchDashboard({ data: { token: tokenRef.current!, tz } });
      if (!res.ok && res.error === SESSION_EXPIRED_MSG) {
        const next = await silentRefreshToken();
        if (next) res = await fetchDashboard({ data: { token: next, tz } });
      }
      if (!res.ok) throw new Error(res.error || "Dashboard unavailable");
      return res;
    },
    enabled: Boolean(uid && token),
    initialData: () => readCachedDashboard(uid),   // last good copy from this browser
    retry: 2,
    retryDelay: (n) => Math.min(2000 * 2 ** n, 15000),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
  if (!uid || !data?.ok) return;
  try { localStorage.setItem(`${DASH_CACHE_KEY}:${uid}`, JSON.stringify(data)); } catch { /* quota */ }
  }, [uid, data]);

  const { data: twinData, isLoading: twinLoading } = useQuery({
    queryKey: ["twin", uid],
    queryFn: async (): Promise<TwinPayload | null> => {
      let activeTok = tokenRef.current!;
      let res = await callApiFn({ data: { token: activeTok, method: "GET", path: "/twin" } });
      if (res.status === 401) {
        // Attempt silent refresh instead of kicking the user out
        const nextTok = await silentRefreshToken();
        if (nextTok) {
          activeTok = nextTok;
          res = await callApiFn({ data: { token: activeTok, method: "GET", path: "/twin" } });
        }
      }
      if (res.status < 200 || res.status >= 300) return null;
      try {
        return JSON.parse(res.body) as TwinPayload;
      } catch {
        return null;
      }
    },
    enabled: Boolean(uid && token),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  
  if (data?.ok) lastGood.current = data;

  const d = data?.ok
    ? data
    : lastGood.current ??
      emptyDashboard(
        queryError ? "Can't reach the server, retrying…" : undefined
      );

  const name = d.user.display_name || (d.user.email ? d.user.email.split("@")[0]! : "");
  const trendSpark = d.trend.slice(-8).map((t) => t.CLI);

  const focusRecommended =
    twinData?.deviations["task_switching"]?.status === "above_normal" ||
    twinData?.trends["task_switching"]?.direction === "increasing";

  const logout = () => {
    endSession();
  };

  const onNavigate = (label: string) => {
    const id = label.toLowerCase().replaceAll(" ", "-") as ViewId;
    setCurrentView(id);
  };

  
  const refreshDashboard = async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["twin", uid] }),
    ]);
    setInterventionsReloadKey((k) => k + 1);
  };


  const openFocusPanel = (minutes = 20) => {
    setFocusInitialMinutes(minutes);
    setShowFocusPanel(true);
  };

  const popupShown = useRef(false);
  useEffect(() => {
  if (!ready || !data || popupShown.current) return;
  if (d.cli > BREAK_POPUP_CLI_THRESHOLD) {
    popupShown.current = true;
    setShowBreakPopup(true);
    playAlertBuzzer();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ready, data]);

  if (!ready) return <div className="min-h-screen" />;

  return (
    <div className="me-fade-in flex min-h-screen flex-col gap-6 p-4 md:flex-row md:p-6">
      <IntroSplash />
      <DashboardSidebar
        name={name}
        email={d.user.email}
        lastSynced={d.last_synced}
        cli={d.cli}
        cliCategory={d.cli_category}
        activeSection={currentView}
        onNavigate={onNavigate}
        onLogout={logout}
      />

      <main className="clay-card relative flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display flex items-center gap-3 text-4xl font-extrabold">
              {name ? `${name}'s MindEase` : "MindEase"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              AI-powered wellness insights • Live &amp; continuous
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 rounded-2xl border border-border px-4 py-2 text-sm font-semibold">
              <Calendar className="size-4 text-clay-purple" />
              {d.range_label || formatToday()}
            </span>

            <button
              type="button"
              aria-pressed={showFocusPanel}
              onClick={() => setShowFocusPanel((s) => !s)}
              className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted ${showFocusPanel ? "border-clay-purple bg-clay-purple/10 text-clay-purple" : "border-border"
                }`}
            >
              <Shield className="size-4" />
              Focus Mode
            </button>

            <button
              type="button"
              title="Refresh dashboard"
              aria-label="Refresh dashboard"
              onClick={() => void refreshDashboard()}
              className="grid size-10 place-items-center rounded-2xl border border-border transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted active:scale-95"
            >
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>

            <ThemeToggle />
          </div>
        </header>

        {token && (
          <FocusProtection
            token={token}
            recommended={focusRecommended}
            onSessionExpired={() => { void silentRefreshToken(); }}
            initialMinutes={focusInitialMinutes}
            panelOpen={showFocusPanel}
            onRequestClose={() => setShowFocusPanel(false)}
            onFinished={() => setShowFocusPanel(true)}
          />
        )}

        {token && (
          <ActivityCheckInProvider
            token={token}
            onSessionExpired={() => { void silentRefreshToken(); }}
            paused={showBreakPopup}
          />
        )}

        {token && (
          <CopilotWidget
            token={token}
            dashboard={d}
            twin={twinData ?? null}
            onStartFocus={openFocusPanel}
            onNavigate={setCurrentView}
          />
        )}

        {agentStatusInfo.tracking && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-foreground">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
              </span>
              <div>
                <strong className="text-emerald-700 dark:text-emerald-300">PC Wellness Companion: Active & Tracking</strong>
                <p className="text-xs text-muted-foreground">
                  Recording keystroke cadence and window switches for {agentStatusInfo.email || "your account"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-200">
                Connected
              </span>
            </div>
          </div>
        )}

        {agentStatusInfo.installed && !agentStatusInfo.tracking && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-3.5 text-sm text-foreground">
            <div className="flex items-center gap-3">
              <Sparkles className="size-5 shrink-0 text-amber-500" />
              <div>
                <strong>MindEase PC Agent is open:</strong> Connect this browser session to start background tracking.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  const tk = localStorage.getItem("bc_token");
                  const rf = localStorage.getItem("bc_refresh_token");
                  if (tk) {
                    const res = await connectAgent(tk, rf || undefined);
                    if (res.ok) {
                      toast.success("PC Tracking activated!");
                      const s = await agentStatus();
                      setAgentStatusInfo(s);
                    } else {
                      connectAgentViaDeepLink(tk, rf || undefined);
                    }
                  }
                }}
                className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-amber-600"
              >
                Sync & Connect Agent
              </button>
            </div>
          </div>
        )}

        {agentInstalled === false && !dismissAgentBanner && (
          <div className="flex flex-col gap-2 rounded-2xl border border-clay-purple/40 bg-clay-purple/10 px-5 py-3.5 text-sm text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Sparkles className="size-5 shrink-0 text-clay-purple" />
                <span>
                  <strong>PC Tracking is inactive:</strong> Run <code>MindEaseAgent.exe</code> on your computer to log typing rhythm and session focus.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href="/downloads/MindEaseAgent.zip"
                  download="MindEaseAgent.zip"
                  className="rounded-full bg-gradient-to-r from-clay-purple to-clay-pink px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Download Agent (.zip)
                </a>
                <a
                  href="/downloads/MindEaseAgent.exe"
                  download="MindEaseAgent.exe"
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                >
                  Direct .exe
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const tk = localStorage.getItem("bc_token");
                    const rf = localStorage.getItem("bc_refresh_token");
                    if (tk) connectAgentViaDeepLink(tk, rf || undefined);
                  }}
                  className="rounded-full border border-clay-purple/50 px-3 py-1.5 text-xs font-semibold text-clay-purple hover:bg-clay-purple/10"
                >
                  1-Click Connect
                </button>
                <button
                  type="button"
                  onClick={() => setDismissAgentBanner(true)}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              💡 <em>Tip:</em> Downloading <strong>.zip</strong> avoids browser download warnings. Extract and double-click <code>MindEaseAgent.exe</code> to start tracking.
            </p>
          </div>
        )}

        {d.error && (
          <p className="rounded-2xl border border-clay-coral/30 bg-clay-coral/10 px-4 py-2 text-sm text-clay-coral">
            {d.error}
          </p>
        )}

        <div key={currentView} className="me-page-enter flex flex-col gap-6">
          {currentView === "home" && token && (
            <HomeOverview
              name={name}
              dashboard={d}
              twin={twinData ?? null}
              token={token}
              onStartFocus={openFocusPanel}
              onSessionExpired={() => { void silentRefreshToken(); }}
              reloadKey={interventionsReloadKey}
              onNavigate={setCurrentView}
            />
          )}

          {currentView === "digital-twin" && (
            <div>
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">
                  Digital Twin
                </p>
                <h2 className="mt-1 text-2xl">Your personalized digital twin</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Age context, your rolling baseline, and how today compares to your own normal.
                </p>
              </div>
              <DigitalTwinPanel twin={twinData ?? null} loading={twinLoading} />
            </div>
          )}

          {currentView === "recommendations" && token && (
            <div>
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">
                  Recommendations
                </p>
                <h2 className="mt-1 text-2xl">Recommendations for You</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Personalized, cause-aware actions based on what's actually driving your score today.
                </p>
              </div>

              <InterventionsPanel
                token={token}
                onStartFocus={openFocusPanel}
                onSessionExpired={() => { void silentRefreshToken(); }}
                reloadKey={interventionsReloadKey}
              />

              <div className="mt-6">
                <RecommendationsHub token={token} dashboard={d} twin={twinData ?? null} />
              </div>
            </div>
          )}

          {currentView === "analytics" && (
            <div className="flex flex-col gap-6">
              <AnalyticsTop dashboard={d} />

              <div className="flex flex-wrap gap-6">
                <RiskGauge
                  cli={d.cli}
                  category={d.cli_category}
                  stress={d.stress_level}
                  energy={d.energy_level}
                  recovery={d.recovery_state}
                  headline={d.headline?.title}
                />
                {token && <TimeBreakdownCard token={token} />}
              </div>

              <div className="flex flex-wrap gap-6">
                <ForecastChart data={d.forecast} />
              </div>
            </div>
          )}

          {currentView === "ai-insights" && (
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">
                  AI Insights
                </p>
                <h2 className="mt-1 text-2xl">Risk and forecast insights</h2>
              </div>

              <div className="flex flex-wrap gap-6">
                <StatCard
                  label="Rest Quality"
                  value={`${d.rest_pct}%`}
                  caption={`${d.late_night_count} late night sessions`}
                  direction={d.late_night_count > 0 ? "down" : "up"}
                  icon={Moon}
                  tone="purple"
                  spark={trendSpark}
                />
                <StatCard
                  label="Focus Score"
                  value={`${d.focus_pct}%`}
                  caption={`${d.session_count} sessions recorded`}
                  direction="up"
                  icon={Brain}
                  tone="blue"
                  spark={trendSpark}
                />
                <StatCard
                  label="Work-Life Balance"
                  value={`${d.balance_pct}%`}
                  caption={`avg ${d.avg_duration.toFixed(1)} hrs/day`}
                  direction={d.balance_pct < 50 ? "down" : "up"}
                  icon={Heart}
                  tone="pink"
                  spark={trendSpark}
                />
              </div>

              <InsightsPanel headline={d.headline} suggestions={d.suggestions} drivers={d.drivers} />
              {token && <FairLoadCard token={token} />}
            </div>
          )}

          {currentView === "reports" && (
            <div className="flex flex-col gap-6">
              <ReportsView dashboard={d} twin={twinData ?? null} token={token} />
              <ComparePanel name={name} metrics={d.compare} />
            </div>
          )}

        </div>

        <footer className="flex items-center justify-center gap-3 pt-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2 font-bold text-clay-purple">
            <Sparkles className="size-4" />
            MindEase AI
          </span>
          <span>|</span>
          <span>Always here to help you thrive</span>
        </footer>

        {showBreakPopup && (
          <div className="me-backdrop-in fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-md">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="break-alert-title"
              className="me-modal-in w-full max-w-md rounded-3xl border border-clay-coral/20 bg-card p-7 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-clay-coral">
                    MindEase Alert
                  </p>
                  <h2 id="break-alert-title" className="mt-2 text-2xl">
                    Time to take a break
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Close break reminder"
                  onClick={() => setShowBreakPopup(false)}
                  className="grid size-9 place-items-center rounded-xl border border-border text-lg text-muted-foreground transition-colors hover:bg-muted"
                >
                  ×
                </button>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Your Cognitive Load Index has gone above 15%. Step away from the screen, hydrate, stretch, and
                give your mind a chance to reset before continuing.
              </p>
              <div className="mt-5 rounded-2xl bg-clay-purple/10 p-4">
                <p className="text-sm font-semibold">Current CLI</p>
                <p className="mt-1 font-display text-3xl font-extrabold text-clay-purple">
                  {Math.round(d.cli * 100)}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBreakPopup(false)}
                className="mt-5 w-full rounded-2xl bg-clay-purple px-5 py-3 font-bold text-card transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98]"
              >
                Got it — I'll take a break
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}