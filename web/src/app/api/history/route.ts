// web/src/app/api/history/route.ts
// Proxies history requests to the ForkScout agent's /v1/history endpoint.
// Auth: Clerk — userId extracted and sent as X-User-Id header.

import { auth } from "@clerk/nextjs/server";

const AGENT_URL = process.env.AGENT_URL || process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3200";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "forkscout-internal";

/** GET /api/history — fetch server-side chat history for the current user */
export async function GET() {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/v1/history`, {
        headers: {
            Authorization: `Bearer ${INTERNAL_SECRET}`,
            "X-User-Id": userId,
        },
    });

    const data = await res.json();
    return Response.json(data, { status: res.status });
}

/** DELETE /api/history — clear server-side chat history for the current user */
export async function DELETE() {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/v1/history`, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${INTERNAL_SECRET}`,
            "X-User-Id": userId,
        },
    });

    const data = await res.json();
    return Response.json(data, { status: res.status });
}
