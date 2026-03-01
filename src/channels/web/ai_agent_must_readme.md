# src/channels/web/ — Web Channel

## Purpose

Browser-based chat channel using Clerk authentication and per-user isolated history.
The web channel is served by a Next.js frontend (`web/`) that communicates with the
agent backend over the self channel's HTTP server.

## Architecture

```
Browser (user) → Next.js frontend (Clerk auth) → Agent HTTP API → runAgent/streamAgent
```

- **Frontend** (`web/`): Next.js app with Clerk auth, useChat + AI SDK v6
- **Backend**: Agent's self channel HTTP server handles /v1/\* endpoints
- **Auth**: Clerk JWT verified in Next.js; userId passed to agent as X-User-Id header
- **History**: Per-user at `.agents/chats/web-{userId}/history.json`

## Auth Flow

1. User signs in via Clerk (social login, email, etc.)
2. Next.js API routes extract `userId` from Clerk `auth()`
3. Routes proxy to agent backend with `X-User-Id: <userId>` header
4. Agent backend trusts X-User-Id from internal Next.js server (authenticated via INTERNAL_API_SECRET)
5. Chat history keyed by `web-{userId}` — each user has isolated history

## Files

| File                      | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `index.ts`                | Channel contract implementation, exports `default satisfies Channel` |
| `ai_agent_must_readme.md` | This file                                                            |

## Rules

- Web channel does NOT start its own HTTP server — it delegates to self channel's server
- Auth is handled by Clerk on the frontend, NOT by the agent backend
- userId is trusted from the X-User-Id header (internal traffic only)
- All per-user state is keyed by Clerk userId
- Never expose raw Clerk tokens to the agent — only the userId string
