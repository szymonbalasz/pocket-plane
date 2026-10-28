#!/usr/bin/env bash
# usage: gates.sh <dir> <tag>  - CI gate (AGENTS §9.4.1, #368): push <dir>'s branch, wait for GitHub CI on its HEAD
# (bun run ci:watch), log to %TEMP%/pocket-plane/ci-<tag>.log, print the verdict, write gates-<tag>.done.
# Nothing heavy runs locally. Run it in the background; waitgates.sh <tag> waits for the marker.
d=$1; t=$2; L=$TEMP/pocket-plane; mkdir -p $L
rm -f $L/gates-$t.done
(cd "$d" && git push -q origin HEAD 2>&1 && bun run ci:watch) > $L/ci-$t.log 2>&1; c=$?
echo "$t ci=$c"
grep -E "^ci:watch|^  |^    |^      " $L/ci-$t.log | head -30
touch $L/gates-$t.done
true
