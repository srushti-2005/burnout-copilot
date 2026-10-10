import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";

import type { DashboardPayload } from "@/lib/dashboard.types";
import { doneCountsByDay } from "@/lib/recoStore";
import type { TwinPayload } from "@/lib/dashboard.types";
import { FEATURE_LABELS, exhaustionProfile, resetsFor } from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";
import { STATUS_LABEL, buildWeeks, downloadText, toCsv, toJson } from "@/lib/reports";

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Which direction counts as strain for each signal. */
const SIGNALS: { key: string; strainWhen: "above" | "below" | "none" }[] = [
  { key: "typing_mean", strainWhen: "below" },
  { key: "typing_variance", strainWhen: "above" },
  { key: "task_switching", strainWhen: "above" },
  { key: "work_duration", strainWhen: "above" },
  { key: "late_night", strainWhen: "above" },
];

type Tone = "strain" | "calm" | "plain";

const TONE_TEXT: Record<Tone, string> = {
  strain: "text-clay-coral",
  calm: "text-clay-teal",
  plain: "text-muted-foreground",
};
const TONE_DOT: Record<Tone, string> = {
  strain: "bg-clay-coral",
  calm: "bg-clay-teal",
  plain: "bg-muted-foreground",
};

/** Turns a raw deviation into plain words, so large percentages never reach the reader. */
function describeDeviation(
  d: { status: string; difference_pct: number | null } | undefined,
  strainWhen: "above" | "below" | "none",
): { text: string; tone: Tone } {
  if (!d) return { text: "Not enough data yet", tone: "plain" };
  if (d.status === "normal") return { text: "About your usual", tone: "calm" };
  const above = d.status === "above_normal";
  const p = d.difference_pct === null ? 999 : Math.abs(d.difference_pct);
  const size = p <= 50 ? "Slightly " : p <= 150 ? "" : "Much ";
  const word = above ? "higher" : "lower";
  const text = `${size}${word} than usual`;
  const tone: Tone = strainWhen === "none" ? "plain" : strainWhen === (above ? "above" : "below") ? "strain" : "calm";
  return { text: text.charAt(0).toUpperCase() + text.slice(1), tone };
}

function describeTrend(
  t: { direction: string } | undefined,
  strainWhen: "above" | "below" | "none",
): { text: string; tone: Tone } {
  if (!t || t.direction === "insufficient_data") return { text: "Not enough data yet", tone: "plain" };
  if (t.direction === "stable") return { text: "→ Steady", tone: "plain" };
  const up = t.direction === "increasing";
  const tone: Tone = strainWhen === "none" ? "plain" : strainWhen === (up ? "above" : "below") ? "strain" : "calm";
  return { text: up ? "↑ Rising" : "↓ Easing", tone };
}

function ReportTwinSection({ token, dashboard, twin }: { token: string; dashboard: DashboardPayload; twin: TwinPayload | null }) {
  const { activity } = useCopilotData(token);
  const prof = exhaustionProfile(dashboard, twin, activity.data ?? null);

  if (!twin) {
    return (
      <section className="clay-card p-6 text-sm text-muted-foreground lg:col-span-2">
        Your digital twin snapshot appears here once you have tracked sessions.
      </section>
    );
  }

  const balanced = String(prof.type) === "balanced";
  const best = resetsFor(prof.type, twin.profile.age ?? null)[0];
  const hs = twin.historical_state;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
  const trendRows: {
      key: string;
      label: string;
      strainWhen: "above" | "below" | "none";
    }[] = [
      { key: "cli", label: "Burnout risk", strainWhen: "above" },
      ...SIGNALS.map((s) => ({
        key: s.key,
        label: FEATURE_LABELS[s.key] ?? s.key,
        strainWhen: s.strainWhen,
      })),
    ];

  return (
    <section className="clay-card flex flex-col gap-6 p-6 lg:col-span-2" aria-label="Digital twin snapshot">
      <div>
        <h3 className="text-xl font-bold">Digital twin snapshot</h3>
        <div className="mt-3 flex items-center gap-3">
          <span className={`inline-block size-3.5 shrink-0 rounded-full ${balanced ? "bg-clay-teal" : "bg-clay-coral"}`} aria-hidden="true" />
          <p className="font-display text-2xl font-extrabold">{prof.label}</p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{prof.summary}</p>
        {best && (
          <p className="mt-2 text-sm text-muted-foreground">
            Try next: <span className="font-bold text-foreground">{best.title} ({best.minutes} min)</span>
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Signals compared with your usual</p>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 font-semibold">Signal</th>
              <th className="py-2 font-semibold">Compared with your usual</th>
            </tr>
          </thead>
          <tbody>
            {SIGNALS.map((s) => {
              const v = describeDeviation(twin.deviations[s.key], s.strainWhen);
              return (
                <tr key={s.key} className="border-b border-border">
                  <td className="py-2 font-semibold">{FEATURE_LABELS[s.key] ?? s.key}</td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className={`inline-block size-2.5 rounded-full ${TONE_DOT[v.tone]}`} aria-hidden="true" />
                      {v.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Last 4 sessions</p>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 font-semibold">Metric</th>
              <th className="py-2 font-semibold">Direction</th>
            </tr>
          </thead>
          <tbody>
            {trendRows.map((row) => {
              const v = describeTrend(twin.trends[row.key], row.strainWhen);
              return (
                <tr key={row.key} className="border-b border-border">
                  <td className="py-2 font-semibold">{row.label}</td>
                  <td className={`py-2 font-semibold ${TONE_TEXT[v.tone]}`}>{v.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Based on {hs.session_count} sessions · Average risk {pct(hs.average_cli)} · Peak risk {pct(hs.peak_cli)}
        </p>
      </div>
    </section>
  );
}

export function ReportsView({ dashboard, twin, token }: { dashboard: DashboardPayload; twin: TwinPayload | null; token: string | null }) {
  const [doneByDay, setDoneByDay] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setDoneByDay(doneCountsByDay());
  }, []);

  const weeks = useMemo(() => buildWeeks(dashboard.trend, doneByDay), [dashboard.trend, doneByDay]);
  const week = weeks.find((w) => w.id === selected) ?? weeks[0];

  const exportCsv = () => downloadText("mindease-weekly-report.csv", "text/csv", toCsv(weeks));
  const exportJson = () => downloadText("mindease-weekly-report.json", "application/json", toJson(weeks));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay-purple">Summaries</p>
          <h2 className="mt-1 text-3xl font-extrabold">Reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">Weekly summaries of your wellbeing.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} className="flex items-center gap-2 rounded-full bg-clay-purple px-5 py-2.5 text-sm font-bold text-card transition-all hover:-translate-y-0.5 active:scale-[0.98]">
            <Download className="size-4" /> CSV
          </button>
          <button type="button" onClick={exportJson} className="flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-bold transition-colors hover:bg-muted">
            <Download className="size-4" /> JSON
          </button>
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-bold transition-colors hover:bg-muted">
            <Printer className="size-4" /> Print
          </button>
        </div>
      </div>

      <div className="me-print-root grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="me-print-only">
          <h2 className="text-3xl font-extrabold">Reports</h2>
          <p className="mt-1 text-sm">Weekly summaries of your wellbeing.</p>
        </div>
        <div className="clay-card flex flex-col gap-2 p-5">
          <h3 className="mb-1 text-lg font-bold">Weeks</h3>
          {weeks.map((w) => {
            const active = week?.id === w.id;
            return (
              <button
                key={w.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setSelected(w.id)}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors duration-300 ${
                  active ? "bg-clay-purple/15 font-bold text-clay-purple" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                {w.label}
              </button>
            );
          })}
        </div>

        {week && (
          <div className="clay-card flex flex-col gap-5 p-6">
            <h3 className="text-xl font-bold">Week of {week.label}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Avg risk" value={week.avgRiskPct === null ? "—" : `${week.avgRiskPct}%`} />
              <Tile label="Peak risk" value={week.peakRiskPct === null ? "—" : `${week.peakRiskPct}%`} />
              <Tile label="Sessions" value={String(week.sessions)} />
              <Tile label="Avg sleep" value="—" note="Not tracked yet" />
              <Tile label="Tips done" value={String(week.tipsDone)} note="Ticked in Recommendations" />
              <Tile label="Status" value={STATUS_LABEL[week.status]} />
            </div>
            <div>
              <p className="text-sm font-bold">Summary</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{week.summary}</p>
            </div>
          </div>
        )}

        {token && <ReportTwinSection token={token} dashboard={dashboard} twin={twin} />}
      </div>
    </div>
  );
}