#!/bin/bash
# Test script for scroll position drift
#
# How to test:
# 1. Run this script: ./scripts/test-scroll-drift.sh
# 2. Wait for ~20 lines to appear
# 3. Scroll up a few lines (mouse wheel or Ctrl+b then Page Up)
# 4. Watch if the scroll position stays stable or drifts up
#
# Expected behavior (FIXED):
#   - The text you're viewing should stay in place
#   - New lines appear at the bottom but don't shift your view
#
# Broken behavior (before fix):
#   - Every new line causes the viewed text to shift up
#   - Makes it hard to read previous output while new content is added

echo "=== Scroll Drift Test ==="
echo ""
echo "Instructions:"
echo "  1. Wait for some lines to appear"
echo "  2. Scroll UP a few lines"
echo "  3. Watch if your view stays stable or drifts"
echo ""
echo "Starting continuous output in 3 seconds..."
sleep 3

# Generate numbered lines with timestamps
count=1
while [ $count -le 100 ]; do
    timestamp=$(date +"%H:%M:%S")
    printf "[%s] Line %3d: This is test output to check scroll stability\n" "$timestamp" "$count"

    # Vary the delay slightly for more realistic output
    if [ $((count % 10)) -eq 0 ]; then
        sleep 0.5  # Longer pause every 10 lines
    else
        sleep 0.2  # Normal pace
    fi

    count=$((count + 1))
done

echo ""
echo "=== Test complete ==="
echo "Did the scroll position stay stable while new lines were added?"
