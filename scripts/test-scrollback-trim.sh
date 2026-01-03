#!/bin/bash
# Spam lines until we're just before the scrollback limit trims.

set -euo pipefail


before="${1:-5}"
limit="${SCROLLBACK_LIMIT:-}"

if [ -z "$limit" ] && command -v rg >/dev/null 2>&1; then
  limit="$(rg -n "SCROLLBACK_LIMIT\\s*=\\s*[0-9]+" src/terminal/ghostty-vt/emulator.ts \
    | sed -n 's/.*SCROLLBACK_LIMIT\\s*=\\s*\\([0-9][0-9]*\\).*/\\1/p' \
    | head -n 1)"
fi

if [ -z "$limit" ]; then
  limit=2000
fi

rows=""
if command -v tput >/dev/null 2>&1; then
  rows="$(tput lines 2>/dev/null || true)"
fi
if [ -z "$rows" ] && command -v stty >/dev/null 2>&1; then
  rows="$(stty size 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$rows" ] || [ "$rows" -le 0 ]; then
  rows=24
fi

target=$((limit - before))
if [ "$target" -lt 0 ]; then
  target=0
fi
total=$((target + rows))

echo "Scrollback limit: $limit"
echo "Viewport rows: $rows"
echo "Printing $total lines to reach scrollback length ~${target} (limit - ${before})"
echo ""

for ((i = 1; i <= total; i++)); do
  printf "Line %05d: scrollback spam\n" "$i"
done

echo ""
echo "Done. Add a few more lines to force trimming."
