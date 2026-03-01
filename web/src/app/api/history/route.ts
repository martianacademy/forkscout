// web/src/app/api/history/route.ts
// Proxies history requests to the ForkScout agent's /v1/history endpoint.

const AGENT_URL = process.env.AGENT_URL || process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3200";

function getToken(req: Request): string {
    return req.headers.get("x-agent-token") || "";
}

/** GET /api/history — fetch server-side chat history */
export async function GET(req: Request) {
    const token = getToken(req);
    if (!token) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/v1/history`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    return Response.json(data, { status: res.status });
}

/** DELETE /api/history — clear server-side chat history */
export async function DELETE(req: Request) {
    const token = getToken(req);
    if (!token) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/v1/history`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    return Response.json(data, { status: res.status });
}
