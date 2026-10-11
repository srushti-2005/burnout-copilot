// src/lib/agent.ts
const AGENT_URL = "http://127.0.0.1:47821";

export type AgentResult =
  | { ok: true; email?: string }
  | { ok: false; error: "agent not reachable" | string };

export type AgentStatus = {
  installed: boolean;
  tracking: boolean;
  email?: string | null;
};

/** Hand this browser session's tokens to the locally-installed PC agent, if any. */
export async function connectAgent(
  accessToken: string,
  refreshToken?: string,
): Promise<AgentResult> {
  try {
    const res = await fetch(`${AGENT_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken || "",
      }),
      signal: AbortSignal.timeout(6000), // agent is local; don't hang on it
    });
    if (!res.ok) return { ok: false, error: `agent error (${res.status})` };
    const data = await res.json();
    return { ok: true, email: data.email };
  } catch {
    return { ok: false, error: "agent not reachable" };
  }
}

/** Stop tracking on this PC. Call from the sign-out button. */
export async function disconnectAgent(): Promise<void> {
  try {
    await fetch(`${AGENT_URL}/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* agent not installed: nothing to stop */
  }
}

export async function agentStatus(): Promise<AgentStatus> {
  try {
    const res = await fetch(`${AGENT_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { installed: false, tracking: false };
    const data = await res.json();
    return { installed: true, tracking: !!data.tracking, email: data.email || null };
  } catch {
    return { installed: false, tracking: false };
  }
}

export const getAgentStatus = agentStatus;