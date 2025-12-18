#!/bin/bash
# Fast scroll drift test - rapid output to stress test scroll stability
#
# This outputs lines very quickly to test scroll stability under load

echo "=== Fast Scroll Drift Test ==="
echo "Rapid output starting in 2 seconds - scroll up quickly!"
sleep 2

for i in $(seq 1 200); do
    printf "Line %3d: %-60s [*]\n" "$i" "$(printf '%*s' $((i % 50)) '' | tr ' ' '=')"
    sleep 0.05  # 50ms between lines - fast enough to test drift
done

echo ""
echo "=== Done ==="
