// ui/src/lib/useCopilotData.ts
// Fetches the two extra datasets the co-pilot needs, via the SAME callApi server function the rest of the app uses.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { callApi } from "@/lib/dashboard.functions";
import type { ActivitySummaryPayload, InterventionPayload } from "@/lib/dashboard.types";

export function useCopilotData(token: string) {
  const call = useServerFn(callApi);

  async function getJson<T>(path: string): Promise<T | null> {
    const res = await call({ data: { token, method: "GET", path } });
    if (res.status < 200 || res.status >= 300) return null;
    try {
      return JSON.parse(res.body) as T;
    } catch {
      return null;
    }
  }

  const activity = useQuery({
    queryKey: ["copilot-activity", token],
    queryFn: () => getJson<ActivitySummaryPayload>("/activity/summary"),
    refetchInterval: 120_000,
  });

  const intervention = useQuery({
    queryKey: ["copilot-intervention", token],
    queryFn: async (): Promise<InterventionPayload | null> => {
      // handles both {…payload…} and {intervention: {…payload…}}
      const r = await getJson<Record<string, unknown>>("/interventions/current");
      const p = (r && "intervention" in r ? r["intervention"] : r) as InterventionPayload | null;
      return p && typeof p === "object" && "title" in p ? p : null;
    },
    refetchInterval: 120_000,
  });

  return { activity, intervention };
}