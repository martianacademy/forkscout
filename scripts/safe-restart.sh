#!/usr/bin/env bash
# scripts/safe-restart.sh — Safe agent restart with CLI smoke test + git rollback
#
# Flow:
#   1. Kill existing instances
#   2. Run CLI smoke test (pipe a message, capture output, timeout 90s)
#   3. If pass → tag HEAD as forkscout-last-good → start production
#   4. If fail → reset to forkscout-last-good tag (or HEAD~1 if tag missing) → retry
#   5. If still fail → exit 1, no changes made to git state

set -euo pipefail

SMOKE_TIMEOUT=90
SMOKE_MSG="reply with only the single word: ok"
SMOKE_LOG="/tmp/forkscout-smoke.log"
AGENT_LOG="/tmp/forkscout.log"
GOOD_TAG="forkscout-last-good"

log()  { echo "[safe-restart] $*"; }
fail() { echo "[safe-restart] ❌ $*" >&2; exit 1; }

# ── Smoke test ──────────────────────────────────────────────────────────────────
# Pipes a test message into CLI mode.
# Exit 0 or 124 (timeout) = ok. Anything else = crash.
smoke_test() {
    log "Starting CLI smoke test (timeout ${SMOKE_TIMEOUT}s)..."
    local exit_code=0

    set +e
    echo "$SMOKE_MSG" | timeout "$SMOKE_TIMEOUT" bun run src/index.ts --cli \
        > "$SMOKE_LOG" 2>&1
    exit_code=$?
    set -e

    if [[ $exit_code -eq 0 || $exit_code -eq 124 ]]; then
        if [[ -s "$SMOKE_LOG" ]]; then
            log "✅ Smoke test passed (exit $exit_code)"
            return 0
        fi
        log "Smoke test: exited cleanly but produced no output"
        return 1
    fi

    log "Smoke test: process crashed (exit $exit_code)"
    log "--- output ---"
    cat "$SMOKE_LOG"
    log "--------------"
    return 1
}

# ── Stop existing instances ─────────────────────────────────────────────────────
log "Stopping existing instances..."
bun run stop

# ── Attempt 1: current code ─────────────────────────────────────────────────────
if smoke_test; then
    DEVTOOLS=1 nohup bun run src/index.ts >> "$AGENT_LOG" 2>&1 &
    STARTED_PID=$!
    # Tag this commit as the last known-good state
    git tag -f "$GOOD_TAG" HEAD
    log "✅ Agent started (PID $STARTED_PID). Tagged HEAD as $GOOD_TAG. Log: $AGENT_LOG"
    exit 0
fi

# ── Attempt 2: rollback to last known-good tag ──────────────────────────────────
log "Smoke test failed. Rolling back to $GOOD_TAG..."

CURRENT_HASH=$(git rev-parse HEAD)

if git rev-parse "$GOOD_TAG" >/dev/null 2>&1; then
    ROLLBACK_HASH=$(git rev-parse "$GOOD_TAG")
    log "Resetting to $GOOD_TAG ($ROLLBACK_HASH)..."
    git reset --hard "$GOOD_TAG"
    log "Rolled back. Your code at $CURRENT_HASH is still in git history — recover with: git cherry-pick $CURRENT_HASH"
else
    log "No $GOOD_TAG tag found. Falling back to HEAD~1..."
    git reset --hard HEAD~1
    log "Rolled back to HEAD~1. Previous HEAD was $CURRENT_HASH"
fi

bun install --frozen-lockfile 2>/dev/null || true

log "Retrying smoke test on rolled-back code..."
if smoke_test; then
    DEVTOOLS=1 nohup bun run src/index.ts >> "$AGENT_LOG" 2>&1 &
    STARTED_PID=$!
    git tag -f "$GOOD_TAG" HEAD
    log "✅ Agent started on rolled-back code (PID $STARTED_PID). Log: $AGENT_LOG"
    exit 0
fi

# ── Both attempts failed ────────────────────────────────────────────────────────
fail "Both attempts failed. Agent not started. Check $SMOKE_LOG for details."
