#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <cmd> [args...]" >&2
  exit 2
fi

cmd="$1"
shift

cmdname="$(basename "$cmd")"
ts="$(date +%s)"
logdir="${LOG_DIR:-.}"
logfile="${logdir}/${cmdname}-${ts}.log"

mkdir -p "$logdir"

if command -v script >/dev/null 2>&1; then
  if script --help 2>&1 | grep -q -- '-c'; then
    cmdline="$(printf '%q ' "$cmd" "$@")"
    exec script -q -c "$cmdline" "$logfile"
  else
    exec script -q "$logfile" "$cmd" "$@"
  fi
else
  exec "$cmd" "$@" 2>&1 | tee "$logfile"
fi
