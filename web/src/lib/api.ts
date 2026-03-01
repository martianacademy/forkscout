// web/src/lib/api.ts — API client for the ForkScout agent backend
// Token is passed explicitly from the AuthProvider context — never hardcoded.

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3200";

export { AGENT_URL };

export interface HealthResponse {
    ok: boolean;
    status: string;
    uptime?: number;
    version?: string;
    timestamp?: string;
}

export interface ChatResponse {
    ok: boolean;
    text?: string;
    steps?: number;
    error?: string;
}

/**
 * Check agent health (no auth required)
 */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    const res = await fetch(`${AGENT_URL}/health`, { cache: "no-store", signal });
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    return res.json();
}

/**
 * Send a message to the agent via HTTP trigger
 */
export async function sendChat(
    token: string,
    message: string,
    sessionKey: string,
): Promise<ChatResponse> {
    const res = await fetch(`${AGENT_URL}/trigger`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            prompt: message,
            session_key: sessionKey,
            role: "user",
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(body);
    }
    return res.json();
}
