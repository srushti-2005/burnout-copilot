import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Calendar, Heart, Moon, RefreshCw, Shield, Sparkles } from "lucide-react";

import { callApi, getDashboard } from "@/lib/dashboard.functions";
import { emptyDashboard } from "@/lib/dashboard.fallback";
import type { TwinPayload } from "@/lib/dashboard.types";
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
  const fetchDashboard = useServerFn(getDashboard);
  const callApiFn = useServerFn(callApi);

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
    localStorage.removeItem("bc_uid");
    localStorage.removeItem("bc_token");
    void navigate({ to: "/login" });
  }, [navigate]);

  useEffect(() => {
    const storedUid = localStorage.getItem("bc_uid");
    const storedToken = localStorage.getItem("bc_token");
    if (!storedUid || !storedToken) {
      localStorage.removeItem("bc_uid");
      localStorage.removeItem("bc_token");
      void navigate({ to: "/login" });
      return;
    }
    setToken(storedToken);
    setReady(true);
  }, [navigate]);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", token],
    queryFn: () => fetchDashboard({ data: { token: token! } }),
    enabled: Boolean(token),
  });

  const { data: twinData, isLoading: twinLoading } = useQuery({
    queryKey: ["twin", token],
    queryFn: async (): Promise<TwinPayload | null> => {
      const res = await callApiFn({ data: { token: token!, method: "GET", path: "/twin" } });
      if (res.status === 401) {
        endSession();
        return null;
      }
      if (res.status < 200 || res.status >= 300) return null;
      try {
        return JSON.parse(res.body) as TwinPayload;
      } catch {
        return null;
      }
    },
    enabled: Boolean(token),
    refetchInterval: 60_000,
  });

  const d = data ?? emptyDashboard();
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
    await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["twin", token] })]);
    setInterventionsReloadKey((k) => k + 1);
  };

  const openFocusPanel = (minutes = 20) => {
    setFocusInitialMinutes(minutes);
    setShowFocusPanel(true);
  };

  useEffect(() => {
    if (!ready || !data) return;
    if (d.cli > BREAK_POPUP_CLI_THRESHOLD) {
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
              className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted ${
                showFocusPanel ? "border-clay-purple bg-clay-purple/10 text-clay-purple" : "border-border"
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
            onSessionExpired={endSession}
            initialMinutes={focusInitialMinutes}
            panelOpen={showFocusPanel}
            onRequestClose={() => setShowFocusPanel(false)}
            onFinished={() => setShowFocusPanel(true)}
          />
        )}

        {token && (
          <ActivityCheckInProvider
            token={token}
            onSessionExpired={endSession}
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
            onSessionExpired={endSession}
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
              onSessionExpired={endSession}
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