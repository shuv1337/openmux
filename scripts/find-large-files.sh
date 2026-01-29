#!/usr/bin/env bash

# Find all source files with more than 500 lines of code
# Excludes: node_modules, vendor, dist, coverage, .git, logs, out, build artifacts

MIN_LINES=500

echo "Finding source files with > ${MIN_LINES} lines of code..."
echo ""

# Find source files and count lines, excluding common directories and build artifacts
find . -type f \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o \
     -name "*.zig" -o -name "*.sh" -o -name "*.md" -o -name "*.json" \) \
  ! -path "./node_modules/*" \
  ! -path "./vendor/*" \
  ! -path "./dist/*" \
  ! -path "./coverage/*" \
  ! -path "./.git/*" \
  ! -path "./logs/*" \
  ! -path "./out/*" \
  ! -path "./.claude/*" \
  ! -path "./worktrees/*" \
  ! -path "*/.zig-cache/*" \
  ! -path "*/zig-out/*" \
  -exec wc -l {} + | \
  awk -v min="$MIN_LINES" '$1 >= min {print $0}' | \
  sort -rn | \
  awk '{printf "%6d lines: %s\n", $1, substr($0, index($0,$2))}'

echo ""
echo "Done."