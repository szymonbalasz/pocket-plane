#!/usr/bin/env bash
# usage: waitgates.sh <tag>  - wait until gates.sh <tag> wrote its done marker (cap 2 h)
for i in $(seq 1 240); do [ -f $TEMP/pocket-plane/gates-$1.done ] && exit 0; sleep 30; done; echo "TIMEOUT waiting for $1"
