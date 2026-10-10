import { api } from './api';
import type { ActivitySummaryPayload, DashboardPayload, InterventionPayload, TwinPayload } from './webTypes';

export async function fetchCopilotData() {
  const [dashR, twinR, ivR, actR, sesR] = await Promise.allSettled([
    api<any>('/dashboard'),
    api<any>('/twin'),
    api<any>('/interventions/current'),
    api<any>('/activity/summary?days=7'),
    api<any[]>('/sessions?limit=1'),
  ]);

  const latestCli = sesR.status === 'fulfilled' ? (sesR.value?.[0]?.cli_score ?? 0) : 0;
  const d = dashR.status === 'fulfilled' && dashR.value ? dashR.value : null;

  const dashboard: DashboardPayload = {
    ...(d ?? {}),
    cli: d?.cli ?? d?.cli_score ?? latestCli,
    forecast: d?.forecast ?? [],
  };

  const t = twinR.status === 'fulfilled' && twinR.value ? twinR.value : null;
  const twin: TwinPayload | null = t
    ? {
        ...t,
        profile: { age: t.profile?.age ?? null },
        baseline: {
          is_established: t.baseline?.is_established ?? false,
          session_count: t.baseline?.session_count ?? 0,
        },
        deviations: t.deviations ?? {},
      }
    : null;

  const intervention: InterventionPayload | null =
    ivR.status === 'fulfilled' && ivR.value
      ? (ivR.value.intervention ?? (ivR.value.title ? ivR.value : null))
      : null;

  const activity: ActivitySummaryPayload | null = actR.status === 'fulfilled' ? actR.value : null;

  return { dashboard, twin, intervention, activity };
}