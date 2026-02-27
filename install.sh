#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# ForkScout — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/marsnext/forkscout/main/install.sh | bash
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

REPO_URL="https://github.com/marsnext/forkscout.git"
INSTALL_DIR="${FORKSCOUT_DIR:-$HOME/forkscout-agent}"
BRANCH="${FORKSCOUT_BRANCH:-main}"

# ── Helpers ───────────────────────────────────────────────────────────────────

info()    { echo -e "  ${CYAN}▸${RESET} $1"; }
success() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail()    { echo -e "\n  ${RED}✗ $1${RESET}\n"; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}${BOLD}  ╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}  ║                                                  ║${RESET}"
echo -e "${CYAN}${BOLD}  ║${RESET}   ${BOLD}⑂  ForkScout — Installer${RESET}                      ${CYAN}${BOLD}║${RESET}"
echo -e "${CYAN}${BOLD}  ║${RESET}   ${DIM}Autonomous AI Agent${RESET}                             ${CYAN}${BOLD}║${RESET}"
echo -e "${CYAN}${BOLD}  ║                                                  ║${RESET}"
echo -e "${CYAN}${BOLD}  ╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────────────────

info "Checking prerequisites..."

# Git
if ! command -v git &>/dev/null; then
    fail "git is not installed. Install it first: https://git-scm.com"
fi
success "git $(git --version | awk '{print $3}')"

# Bun
if ! command -v bun &>/dev/null; then
    warn "Bun is not installed. Installing..."
    curl -fsSL https://bun.sh/install | bash
    # Source the updated PATH
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if ! command -v bun &>/dev/null; then
        fail "Bun installation failed. Install manually: https://bun.sh"
    fi
    success "Bun $(bun --version) installed"
else
    success "Bun $(bun --version)"
fi

echo ""

# ── Step 2: Clone or update repo ─────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
    info "Existing installation found at ${BOLD}$INSTALL_DIR${RESET}"
    info "Pulling latest changes..."
    cd "$INSTALL_DIR"
    git pull --rebase origin "$BRANCH" 2>/dev/null || {
        warn "Pull failed — continuing with existing code"
    }
    success "Updated to latest"
else
    info "Cloning ForkScout to ${BOLD}$INSTALL_DIR${RESET}..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
        fail "Clone failed. Check your network and repo access."
    }
    cd "$INSTALL_DIR"
    success "Cloned successfully"
fi

echo ""

# ── Step 3: Install dependencies ─────────────────────────────────────────────

info "Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install
success "Dependencies installed"

echo ""

# ── Step 4: Link global command ───────────────────────────────────────────────

info "Linking 'forkscout' global command..."
bun link 2>/dev/null || true
success "Global command ready: ${BOLD}forkscout${RESET}"

echo ""

# ── Step 5: Run setup wizard ─────────────────────────────────────────────────

info "Launching setup wizard..."
echo ""

bun run setup

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${GREEN}${BOLD}Installation complete!${RESET}"
echo ""
echo -e "  ${DIM}Directory:${RESET} ${BOLD}$INSTALL_DIR${RESET}"
echo ""
echo -e "  ${DIM}Quick start:${RESET}"
echo -e "    ${BOLD}forkscout start${RESET}     ${DIM}— Start Telegram bot${RESET}"
echo -e "    ${BOLD}forkscout cli${RESET}       ${DIM}— Terminal chat${RESET}"
echo -e "    ${BOLD}forkscout dev${RESET}       ${DIM}— Development mode${RESET}"
echo -e "    ${BOLD}forkscout setup${RESET}     ${DIM}— Re-run setup wizard${RESET}"
echo -e "    ${BOLD}forkscout help${RESET}      ${DIM}— All commands${RESET}"
echo ""
