#!/usr/bin/env bash
# usage: waitrep.sh agent...  - wait until any listed agent is blocked, or idle with a finished reply and no background shell
for i in $(seq 1 56); do
  for a in "$@"; do
    st=$(herdr agent get "$a" 2>/dev/null | jq -r '.result.agent.agent_status' | tr -d '\r')
    [ "$st" = blocked ] && { echo "$a=blocked"; exit 0; }
    [ "$st" = working ] && continue
    [ -z "$st" ] || [ "$st" = null ] && continue
    full=$(herdr agent read "$a" --source recent-unwrapped --lines 40 2>/dev/null)
    echo "$full" | grep -qE "[0-9]+ shells?( |$)" && continue
    echo "$full" | tail -12 | grep -q "copy reply" && { echo "$a=$st"; exit 0; }
  done
  sleep 30
done
echo TIMEOUT
