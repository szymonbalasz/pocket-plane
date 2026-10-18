#!/usr/bin/env bash
# usage: gates.sh <dir> <tag>  - check + full e2e in <dir>, logs to %TEMP%/pocket-plane/{check,e2e}-<tag>.log, prints a summary
d=$1; t=$2; L=$TEMP/pocket-plane
rm -f $L/gates-$t.done
(cd "$d" && bun run check > $L/check-$t.log 2>&1); c=$?
(cd "$d" && bun run e2e > $L/e2e-$t.log 2>&1); e=$?
echo "$t check=$c e2e=$e"
grep -E "^ *[0-9]+ (pass|fail)$" $L/check-$t.log | tail -2
grep "(fail)" $L/check-$t.log | head -3
grep -E "^\s+[0-9]+ passed" $L/e2e-$t.log | awk '{s+=$1} END {print s" e2e passed"}'
grep -E "^\s+[0-9]+ (failed|flaky)" $L/e2e-$t.log
grep -E "^\s+[0-9]+\) " $L/e2e-$t.log | head -5
touch $L/gates-$t.done
true
