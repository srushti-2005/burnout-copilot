// frontend/src/lib/agent.ts
//
// Talks to the MindEase PC agent running on the USER'S OWN computer
// (http://127.0.0.1:47821). Runs in the browser only. If the agent is not
// installed, every call fails quietly and the website works as before.
//
// Chrome/Edge: allowed from an https page (loopback counts as trustworthy).
// Chrome 142+ shows a one-time "access devices on your local network" prompt: the
// tester must click Allow. Safari blocks this, and the agent is Windows-only anyway.

const AGENT_URL = "http://127.0.0.1:47821";

export type AgentStatus =
  | { installed: false }
  | { installed: true; email: string | null; tracking: boolean };

async function agentFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${AGENT_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      // Chrome's Local Network Access hint. Other browsers ignore it.
      ...({ targetAddressSpace: "loopback" } as object),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Is the agent installed and running on this PC, and who is it tracking? */
export async function getAgentStatus(): Promise<AgentStatus> {
  try {
    const res = await agentFetch("/status", { method: "GET" }, 3000);
    if (!res.ok) return { installed: false };
    const j = (await res.json()) as { email?: string | null; tracking?: boolean };
    return { installed: true, email: j.email ?? null, tracking: Boolean(j.tracking) };
  } catch {
    return { installed: false };
  }
}

/**
 * Hand the signed-in user's tokens to the agent so it starts tracking for them.
 * Call right after a successful login or signup, WITHOUT awaiting it before
 * you navigate: the first call can take about a minute if the free Render
 * server is waking up. The refresh token is passed straight through and must
 * not be stored anywhere in the web app.
 */
export async function connectAgent(
  accessToken: string,
  refreshToken: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await agentFetch(
      "/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
      },
      100_000,
    );
    const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && j?.ok) return { ok: true, error: null };
    return { ok: false, error: j?.error ?? `agent returned ${res.status}` };
  } catch {
    return { ok: false, error: "agent not reachable" };
  }
}

/** Stop tracking on this PC. Call from the sign-out button. */
export async function disconnectAgent(): Promise<void> {
  try {
    await agentFetch("/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, 3000);
  } catch {
    /* agent not installed: nothing to stop */
  }
}
