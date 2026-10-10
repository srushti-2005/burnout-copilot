import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

import { DashboardSidebar } from "./DashboardSidebar";
import { RecommendationsChecklist } from "./RecommendationsChecklist";
import { ReportsView } from "./ReportsView";
import { emptyDashboard } from "@/lib/dashboard.fallback";
import { RECOS, doneCountsByDay, loadDone, saveDone, suggestedCategories, todayKey } from "@/lib/recommendations";
import { buildWeeks, rangeStats, toCsv, toJson, dayKey } from "@/lib/reports";
import type { DashboardPayload, TrendPoint, TwinPayload } from "@/lib/dashboard.types";

const NOW = new Date(2026, 9, 8, 12, 0, 0); // Thu 8 Oct 2026, local
const at = (daysAgo: number, hour: number, cli: number): TrendPoint => ({
  session_index: 0,
  timestamp: new Date(2026, 9, 8 - daysAgo, hour, 0, 0).toISOString(),
  CLI: cli,
  CLI_category: "x",
});

function dash(over: Partial<DashboardPayload> = {}): DashboardPayload {
  return { ...emptyDashboard(), ok: true, ...over };
}

function twinWith(deviations: TwinPayload["deviations"]): TwinPayload {
  return {
    user_id: "u", generated_at: "", profile: { age: 30 },
    baseline: { is_established: true, session_count: 9, averages: {} },
    current_state: null, deviations,
    historical_state: { session_count: 9, cli_history: [], risk_history_pct: [], average_cli: null, peak_cli: null, recent_sessions: [] },
    trends: {},
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("reports logic", () => {
  it("buckets sessions into rolling weeks ending today and computes real averages", () => {
    const trend = [at(0, 9, 0.5), at(2, 10, 0.3), at(8, 9, 0.8), at(9, 9, 0.6)];
    const weeks = buildWeeks(trend, {}, NOW);
    expect(weeks.length).toBe(2);
    expect(weeks[0]!.label).toBe("Oct 2 – Oct 8");
    expect(weeks[0]!.sessions).toBe(2);
    expect(weeks[0]!.avgRiskPct).toBe(40);
    expect(weeks[0]!.peakRiskPct).toBe(50);
    expect(weeks[1]!.avgRiskPct).toBe(70);
    expect(weeks[0]!.status).toBe("easing"); // 40 vs 70
    expect(weeks[1]!.status).toBe("first");
    expect(weeks[0]!.summary).toContain("30 points lower");
  });

  it("never invents data for an empty trend", () => {
    const weeks = buildWeeks([], {}, NOW);
    expect(weeks.length).toBe(1);
    expect(weeks[0]!.avgRiskPct).toBeNull();
    expect(weeks[0]!.status).toBe("none");
    expect(weeks[0]!.summary).toBe("No sessions were recorded this week.");
  });

  it("ignores bad timestamps and clamps out-of-range CLI", () => {
    const bad: TrendPoint = { session_index: 0, timestamp: "nope", CLI: 0.5, CLI_category: "x" };
    const weeks = buildWeeks([bad, at(0, 9, 7)], {}, NOW);
    expect(weeks[0]!.sessions).toBe(1);
    expect(weeks[0]!.avgRiskPct).toBe(100);
  });

  it("adds ticked recommendations per week", () => {
    const weeks = buildWeeks([at(0, 9, 0.5)], { [dayKey(NOW)]: 3, "2000-01-01": 9 }, NOW);
    expect(weeks[0]!.tipsDone).toBe(3);
  });

  it("range stats honour 7/30/90 days and need 3 sessions for a calmest hour", () => {
    const trend = [at(0, 9, 0.2), at(1, 9, 0.4), at(2, 15, 0.9), at(20, 9, 0.9), at(60, 9, 0.9)];
    expect(rangeStats(trend, 7, NOW).sessions).toBe(3);
    expect(rangeStats(trend, 7, NOW).avgRiskPct).toBe(50);
    expect(rangeStats(trend, 7, NOW).calmestHour).toBe(9);
    expect(rangeStats(trend, 30, NOW).sessions).toBe(4);
    expect(rangeStats(trend, 90, NOW).sessions).toBe(5);
    expect(rangeStats([at(0, 9, 0.2)], 7, NOW).calmestHour).toBeNull();
    expect(rangeStats([], 7, NOW)).toEqual({ sessions: 0, avgRiskPct: null, calmestHour: null });
  });

  it("CSV and JSON exports are well formed and omit untracked sleep/screen", () => {
    const weeks = buildWeeks([at(0, 9, 0.5)], {}, NOW);
    const csv = toCsv(weeks).trim().split("\n");
    expect(csv[0]).toBe("Week,Start,End,Sessions,Avg risk %,Peak risk %,Tips done,Status");
    expect(csv[1]).toContain("Oct 2 – Oct 8");
    expect(csv[1]!.split(",").length).toBe(8);
    expect(csv.join("")).not.toMatch(/sleep|screen/i);
    const json = JSON.parse(toJson(weeks, NOW));
    expect(json.weeks[0].avgRiskPct).toBe(50);
    expect(json.weeks[0].status).toBe("First week");
  });
});

describe("recommendations store", () => {
  it("saves, loads, drops unknown ids and counts per day", () => {
    saveDone("2026-10-07", new Set(["box-breathing", "power-nap"]));
    localStorage.setItem("me_reco_done:2026-10-06", JSON.stringify(["box-breathing", "ghost"]));
    localStorage.setItem("me_reco_done:2026-10-05", "not json");
    expect([...loadDone("2026-10-07")].sort()).toEqual(["box-breathing", "power-nap"]);
    expect(doneCountsByDay()).toEqual({ "2026-10-07": 2, "2026-10-06": 1, "2026-10-05": 0 });
  });

  it("suggests categories only from real above-normal signals", () => {
    const dev = (status: "above_normal" | "normal") => ({ current: 1, baseline: 1, difference: 0, difference_pct: 1, status });
    const s = suggestedCategories(twinWith({ late_night: dev("above_normal"), task_switching: dev("normal") }));
    expect([...s]).toEqual(["Sleep"]);
    expect(suggestedCategories(null).size).toBe(0);
  });
});

describe("DashboardSidebar", () => {
  const base = { name: "Divya Desai", email: "d@example.com", cli: 0.51, cliCategory: "Medium", activeSection: "home", onNavigate: () => {}, onLogout: () => {} };

  it("matches the reference: brand, CLI card, six nav items, user card, logout", () => {
    const onNavigate = vi.fn();
    const onLogout = vi.fn();
    render(<DashboardSidebar {...base} onNavigate={onNavigate} onLogout={onLogout} />);
    expect(screen.getByText("MindEase")).toBeTruthy();
    expect(screen.getByText("51%")).toBeTruthy();
    expect(screen.getByText("Moderate risk")).toBeTruthy();
    expect(within(screen.getByRole("navigation")).getAllByRole("button").length).toBe(6);
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: /AI Insights/ }));
    expect(onNavigate).toHaveBeenCalledWith("AI Insights");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
  });

  it("has no Live Tracking message and no old brand", () => {
    render(<DashboardSidebar {...base} lastSynced="just now" />);
    expect(document.body.textContent).not.toMatch(/live tracking/i);
    expect(document.body.textContent).not.toMatch(/burnout\s*copilot/i);
  });
});

describe("RecommendationsChecklist", () => {
  it("shows progress, filters, ticks, persists and hides completed", () => {
    const { unmount } = render(<RecommendationsChecklist twin={null} />);
    expect(screen.getByText(`0 of ${RECOS.length}`)).toBeTruthy();
    expect(screen.getByText("Integration coming soon")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /Box breathing/ }));
    expect(screen.getByText(`1 of ${RECOS.length}`)).toBeTruthy();
    expect(localStorage.getItem("me_reco_done:" + todayKey())).toContain("box-breathing");

    fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
    expect(screen.queryByText("Box breathing")).toBeNull();
    expect(screen.getByText("Wrap up by 9 PM")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    fireEvent.click(screen.getByLabelText("Hide completed"));
    expect(screen.queryByText("Box breathing")).toBeNull();

    unmount();
    render(<RecommendationsChecklist twin={null} />);
    expect(screen.getByText(`1 of ${RECOS.length}`)).toBeTruthy(); // restored from storage
  });

  it("marks 'Suggested for you' only when the twin shows that signal", () => {
    const dev = { current: 1, baseline: 1, difference: 0, difference_pct: 50, status: "above_normal" as const };
    render(<RecommendationsChecklist twin={twinWith({ late_night: dev })} />);
    expect(screen.getAllByText("Suggested for you").length).toBe(1);
  });
});

describe("ReportsView", () => {
  it("lists weeks, switches week, and exports", () => {
    const trend = [at(0, 9, 0.5), at(8, 9, 0.8)];
    const createUrl = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const print = vi.fn();
    window.print = print;

    render(
  <ReportsView
    dashboard={dash({ trend })}
    twin={null}
    token={null}
  />
);
    expect(screen.getByText("Week of Oct 2 – Oct 8")).toBeTruthy();
    expect(screen.getByText("Not tracked yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sep 25 – Oct 1/ }));
    expect(screen.getByText("Week of Sep 25 – Oct 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    fireEvent.click(screen.getByRole("button", { name: /JSON/ }));
    expect(createUrl).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /Print/ }));
    expect(print).toHaveBeenCalled();
  });
});
