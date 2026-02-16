#!/usr/bin/env zsh
#
# Forkscout Agent Watchdog
# Runs the agent with crash-loop protection.
#
# If the agent crashes within GRACE_PERIOD seconds of starting,
# it auto-rolls back the last git changes in src/ and restarts.
#
# Usage:
#   ./watchdog.sh          # production mode (no auto-restart on crash)
#   ./watchdog.sh --dev     # dev mode (auto-restart on crash with rollback protection)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GRACE_PERIOD=10       # seconds — if crash within this window, assume bad self-edit
MAX_ROLLBACKS=3       # max consecutive rollbacks before giving up
ROLLBACK_COUNT=0

# Color helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[watchdog]${NC} $1"; }
warn() { echo -e "${YELLOW}[watchdog]${NC} $1"; }
err() { echo -e "${RED}[watchdog]${NC} $1"; }

MODE="start"
if [[ "${1:-}" == "--watch" || "${1:-}" == "--dev" ]]; then
    MODE="dev"
fi

rollback_src() {
    warn "Rolling back agent source to last known good state..."

    # Try git restore first
    if git diff --name-only -- src/ 2>/dev/null | grep -q .; then
        git checkout -- src/
        log "Restored src/ from git"
    fi

    # Also restore .bak files if any exist
    local bak_files
    bak_files=$(find src/ -name "*.bak" 2>/dev/null || true)
    if [[ -n "$bak_files" ]]; then
        while IFS= read -r bak; do
            local orig="${bak%.bak}"
            mv "$bak" "$orig"
            log "Restored $orig from backup"
        done <<< "$bak_files"
    fi
}

run_agent() {
    local start_time exit_code

    log "Starting Forkscout Agent (mode: $MODE)..."
    start_time=$(date +%s)

    # Always use plain tsx (not tsx watch) — tsx watch kills the process on every
    # source-file save, which destroys in-flight LLM calls during interactive chat.
    # The watchdog loop already provides crash restart, so tsx watch is redundant here.
    pnpm exec tsx src/cli.ts

    exit_code=$?
    local elapsed=$(( $(date +%s) - start_time ))

    return $exit_code
}

# ─── Main loop ───────────────────────────────────────────

while true; do
    START_TIME=$(date +%s)

    set +e
    run_agent
    EXIT_CODE=$?
    set -e

    ELAPSED=$(( $(date +%s) - START_TIME ))

    # Clean exit (user typed "exit")
    if [[ $EXIT_CODE -eq 0 ]]; then
        log "Agent exited cleanly."
        exit 0
    fi

    # Crash
    err "Agent crashed with exit code $EXIT_CODE after ${ELAPSED}s"

    if [[ $ELAPSED -lt $GRACE_PERIOD ]]; then
        # Crash within grace period → likely bad self-edit
        ROLLBACK_COUNT=$((ROLLBACK_COUNT + 1))

        if [[ $ROLLBACK_COUNT -gt $MAX_ROLLBACKS ]]; then
            err "Max rollbacks ($MAX_ROLLBACKS) exceeded. Giving up."
            err "Manually fix the issue in packages/agent/src/ and restart."
            exit 1
        fi

        err "Crash within ${GRACE_PERIOD}s grace period — likely a bad self-edit"
        err "Auto-rollback #$ROLLBACK_COUNT of $MAX_ROLLBACKS"
        rollback_src
        warn "Restarting in 2 seconds..."
        sleep 2
    else
        # Crash after grace period → normal crash, no rollback
        ROLLBACK_COUNT=0
        warn "Agent ran for ${ELAPSED}s before crashing. Not rolling back."
        warn "Restarting in 3 seconds... (Ctrl+C to stop)"
        sleep 3
    fi
done
