#!/usr/bin/env bash
# usage: poll.sh [agent ...]  - wait until any listed agent (default: all named) leaves "working"; cap ~14 min
jq() { command jq "$@" | tr -d '\r'; } # Windows jq ends lines with CRLF
for i in $(seq 1 28); do
  s=$(herdr agent list | jq -r '.result.agents[]|select(.name!=null)|"\(.name)=\(.agent_status)"')
  w=$s; if [ $# -gt 0 ]; then w=$(echo "$s" | grep -E "^($(IFS='|'; echo "$*"))=" || true); fi
  [ -n "$w" ] || { echo "no such agent: $*"; echo "$s"; exit 1; }
  if echo "$w" | grep -qvE "=working$"; then echo "$s"; exit 0; fi
  sleep 30
done
echo "TIMEOUT"; echo "$s"
