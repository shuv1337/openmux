#!/usr/bin/env bash
set -euo pipefail

# Publish openmux to npm
# This script polls GitHub release assets and publishes non-interactively

REPO="monotykamary/openmux"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EXPECTED_ASSETS=3
POLL_INTERVAL_SECONDS="${GITHUB_POLL_INTERVAL_SECONDS:-15}"
POLL_TIMEOUT_SECONDS="${GITHUB_POLL_TIMEOUT_SECONDS:-1200}"
POLL_DEADLINE=$((SECONDS + POLL_TIMEOUT_SECONDS))
SUBMODULE_DIR="$PROJECT_DIR/vendor/ghostty"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

cd "$PROJECT_DIR"

# Load .env if present
if [[ -f ".env" ]]; then
    set -a
    source ".env"
    set +a
fi

# Get version from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
TAG="v$VERSION"

echo ""
echo "Publishing openmux $TAG to npm"
echo "─────────────────────────────────"
echo ""

# Configure npm auth from NPM_TOKEN
if [[ -z "${NPM_TOKEN:-}" ]]; then
    error "NPM_TOKEN is not set. Add it to .env or export it in your shell."
fi
TMP_NPMRC="$(mktemp)"
MAIN_STASH_REF=""
SUBMODULE_STASH_REF=""

cleanup() {
    local exit_code=$?

    if [[ -n "$SUBMODULE_STASH_REF" ]]; then
        if git -C "$SUBMODULE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
            if ! git -C "$SUBMODULE_DIR" stash pop --index "$SUBMODULE_STASH_REF" >/dev/null; then
                warn "Failed to pop submodule stash $SUBMODULE_STASH_REF. Resolve manually."
            else
                info "Restored submodule stash."
            fi
        fi
    fi

    if [[ -n "$MAIN_STASH_REF" ]]; then
        if ! git stash pop --index "$MAIN_STASH_REF" >/dev/null; then
            warn "Failed to pop main repo stash $MAIN_STASH_REF. Resolve manually."
        else
            info "Restored main repo stash."
        fi
    fi

    rm -f "$TMP_NPMRC"
    exit "$exit_code"
}

trap cleanup EXIT
{
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"
    echo "always-auth=true"
} > "$TMP_NPMRC"
export NPM_CONFIG_USERCONFIG="$TMP_NPMRC"

# Check npm auth
if ! npm whoami &>/dev/null; then
    error "NPM_TOKEN is invalid or lacks access."
fi
info "Authenticated to npm as $(npm whoami)"

# Stash uncommitted changes (main repo)
if [[ -n $(git status --porcelain --ignore-submodules=dirty) ]]; then
    prev_hash="$(git stash list -n 1 --format="%H" || true)"
    git stash push -u -m "publish:npm auto-stash" >/dev/null
    new_hash="$(git stash list -n 1 --format="%H" || true)"
    if [[ -z "$new_hash" || "$new_hash" == "$prev_hash" ]]; then
        error "Failed to stash main repo changes."
    fi
    MAIN_STASH_REF="$(git stash list -n 1 --format="%gd" || true)"
    if [[ -z "$MAIN_STASH_REF" ]]; then
        error "Failed to resolve main repo stash reference."
    fi
    info "Stashed main repo changes."
fi

# Stash uncommitted changes (ghostty submodule)
if [[ -d "$SUBMODULE_DIR" ]] && git -C "$SUBMODULE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -n $(git -C "$SUBMODULE_DIR" status --porcelain) ]]; then
        prev_hash="$(git -C "$SUBMODULE_DIR" stash list -n 1 --format="%H" || true)"
        git -C "$SUBMODULE_DIR" stash push -u -m "publish:npm auto-stash" >/dev/null
        new_hash="$(git -C "$SUBMODULE_DIR" stash list -n 1 --format="%H" || true)"
        if [[ -z "$new_hash" || "$new_hash" == "$prev_hash" ]]; then
            error "Failed to stash ghostty submodule changes."
        fi
        SUBMODULE_STASH_REF="$(git -C "$SUBMODULE_DIR" stash list -n 1 --format="%gd" || true)"
        if [[ -z "$SUBMODULE_STASH_REF" ]]; then
            error "Failed to resolve ghostty submodule stash reference."
        fi
        info "Stashed ghostty submodule changes."
    fi
fi

if [[ -z "$MAIN_STASH_REF" && -z "$SUBMODULE_STASH_REF" ]]; then
    info "Working directory clean"
fi

# Check if tag exists
if ! git rev-parse "$TAG" &>/dev/null; then
    error "Tag $TAG does not exist. Run 'bun run release' first."
fi
info "Tag $TAG exists"

# Poll for GitHub release assets
echo ""
echo "Waiting for GitHub release assets..."

RELEASE_URL="https://api.github.com/repos/$REPO/releases/tags/$TAG"
ASSETS=0
RELEASE_DATA=""

while [[ $SECONDS -lt $POLL_DEADLINE ]]; do
    RELEASE_DATA=$(curl -fsSL "$RELEASE_URL" 2>/dev/null || echo "")
    if [[ -n "$RELEASE_DATA" ]]; then
        ASSETS=$(echo "$RELEASE_DATA" | grep -o '"name": *"openmux-[^"]*\.tar\.gz"' | wc -l | tr -d ' ')
        if [[ "$ASSETS" -ge "$EXPECTED_ASSETS" ]]; then
            info "GitHub release has $ASSETS binary assets"
            break
        fi
        warn "Found $ASSETS/$EXPECTED_ASSETS assets, waiting..."
    else
        warn "Release $TAG not available yet, waiting..."
    fi
    sleep "$POLL_INTERVAL_SECONDS"
done

if [[ "$ASSETS" -lt "$EXPECTED_ASSETS" ]]; then
    echo ""
    error "Timed out waiting for $EXPECTED_ASSETS GitHub assets for $TAG."
fi

# Dry run first
echo ""
echo "Running npm pack (dry run)..."
npm pack --dry-run

echo ""
echo "Publishing to npm..."
npm publish
echo ""
info "Published openmux@$VERSION to npm!"
echo ""
echo "Users can now install with:"
echo "  npm install -g openmux"
echo "  bun add -g openmux"
