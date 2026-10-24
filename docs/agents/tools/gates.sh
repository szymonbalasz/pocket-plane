#!/usr/bin/env bash
# usage: gates.sh <dir> <tag>  - check:full (check + slow set) + full e2e in <dir>, logs to %TEMP%/pocket-plane/{check,e2e}-<tag>.log, prints a summary
d=$1; t=$2; L=$TEMP/pocket-plane
rm -f $L/gates-$t.done
(cd "$d" && bun run check:full > $L/check-$t.log 2>&1); c=$?
(cd "$d" && bun run e2e > $L/e2e-$t.log 2>&1); e=$?
echo "$t check=$c e2e=$e"
grep -E "^ tests: |^check(:full)?: " $L/check-$t.log | tail -2
grep -E "^  \(fail\) |^  FAIL " $L/check-$t.log | head -5
grep -E "^  total: " $L/e2e-$t.log
grep -E "^  FAIL |^         [0-9]+\) " $L/e2e-$t.log | head -8
touch $L/gates-$t.done
true
