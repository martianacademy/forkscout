#!/usr/bin/env bash
#
# Forkscout Agent Watchdog
# Builds the agent, then runs it from compiled dist/.
#
# Flow:
#   1. tsc build → dist/
#   2. Run agent from dist/ (tsx handles ESM resolution)
#   3. Agent edits src/ freely (no impact on running process)
#   4. Agent calls self_rebuild tool → tsc → exit(10) → watchdog rebuilds + restarts
#
# Exit codes:
#   0  — clean shutdown, stop
#   10 — reload requested (agent self-rebuilt successfully)
#   *  — crash, apply rollback protection
#
# Usage:
#   ./watchdog.sh            # production mode
#   ./watchdog.sh --dev      # dev mode (auto-restart on crash with rollback)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GRACE_PERIOD=10       # seconds — if crash within this window, assume bad self-edit
MAX_ROLLBACKS=3       # max consecutive rollbacks before giving up
ROLLBACK_COUNT=0
RELOAD_EXIT_CODE=10   # convention: exit(10) = "please reload me"

# Color helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[watchdog]${NC} $1"; }
warn() { echo -e "${YELLOW}[watchdog]${NC} $1"; }
err()  { echo -e "${RED}[watchdog]${NC} $1"; }
info() { echo -e "${CYAN}[watchdog]${NC} $1"; }

MODE="start"
if [[ "${1:-}" == "--watch" || "${1:-}" == "--dev" ]]; then
    MODE="dev"
fi

# ─── Build ───────────────────────────────────────────────

build_agent() {
    info "Building agent (tsc)..."
    local build_start
    build_start=$(date +%s)

    if node_modules/.bin/tsc 2>&1; then
        local elapsed=$(( $(date +%s) - build_start ))
        log "Build succeeded in ${elapsed}s"
        return 0
    else
        err "Build FAILED"
        return 1
    fi
}

# ─── Rollback ────────────────────────────────────────────

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

# ─── Backup dist ─────────────────────────────────────────

backup_dist() {
    if [[ -d dist ]]; then
        rm -rf dist.bak
        cp -r dist dist.bak
        log "Backed up dist/ → dist.bak/"
    fi
}

restore_dist() {
    if [[ -d dist.bak ]]; then
        rm -rf dist
        mv dist.bak dist
        warn "Restored dist/ from backup"
    fi
}

# ─── Run agent from dist ─────────────────────────────────

run_agent() {
    if [[ "$MODE" == "dev" ]]; then
        log "Starting Forkscout Agent with dist/ watcher (auto-restart on build changes)..."
        node scripts/watch-dist.mjs serve
    else
        log "Starting Forkscout Agent from dist/ (mode: $MODE)..."
        pnpm exec tsx dist/serve.js
    fi
}

# ─── Initial build ───────────────────────────────────────

if ! build_agent; then
    err "Initial build failed. Fix errors and try again."
    exit 1
fi

# ─── Main loop ───────────────────────────────────────────

while true; do
    START_TIME=$(date +%s)

    set +e
    run_agent
    EXIT_CODE=$?
    set -e

    ELAPSED=$(( $(date +%s) - START_TIME ))

    # Clean exit (user typed "exit" or SIGINT)
    if [[ $EXIT_CODE -eq 0 ]]; then
        log "Agent exited cleanly."
        exit 0
    fi

    # Reload requested (agent self-rebuilt)
    if [[ $EXIT_CODE -eq $RELOAD_EXIT_CODE ]]; then
        ROLLBACK_COUNT=0
        info "🔄 Reload requested — rebuilding from updated source..."
        backup_dist
        if build_agent; then
            log "Rebuild succeeded — restarting agent..."
            rm -rf dist.bak
            continue
        else
            err "Rebuild FAILED after self-edit — restoring previous build"
            restore_dist
            rollback_src
            warn "Restarting with previous build in 2 seconds..."
            sleep 2
            continue
        fi
    fi

    # Crash
    err "Agent crashed with exit code $EXIT_CODE after ${ELAPSED}s"

    if [[ $ELAPSED -lt $GRACE_PERIOD ]]; then
        # Crash within grace period → likely bad self-edit
        ROLLBACK_COUNT=$((ROLLBACK_COUNT + 1))

        if [[ $ROLLBACK_COUNT -gt $MAX_ROLLBACKS ]]; then
            err "Max rollbacks ($MAX_ROLLBACKS) exceeded. Giving up."
            err "Manually fix the issue in src/ and restart."
            exit 1
        fi

        err "Crash within ${GRACE_PERIOD}s grace period — likely a bad self-edit"
        err "Auto-rollback #$ROLLBACK_COUNT of $MAX_ROLLBACKS"
        rollback_src

        # Rebuild from rolled-back source
        info "Rebuilding after rollback..."
        if build_agent; then
            warn "Restarting in 2 seconds..."
            sleep 2
        else
            err "Rebuild after rollback also failed!"
            restore_dist
            warn "Restarting with last known good dist/ in 3 seconds..."
            sleep 3
        fi
    else
        # Crash after grace period → normal crash, no rollback
        ROLLBACK_COUNT=0
        warn "Agent ran for ${ELAPSED}s before crashing. Not rolling back."
        warn "Restarting in 3 seconds... (Ctrl+C to stop)"
        sleep 3
    fi
done
