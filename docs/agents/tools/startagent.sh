#!/usr/bin/env bash
# usage: [AGENT_KIND=claude] startagent.sh <split-from-pane> <name> <brief-path> [test]  - split a pane, start an agent, send the brief
# AGENT_KIND = the Herdr agent kind (default claude). Kind-specific CLI args live in the case below; "test" = agent needs the Playwright MCP servers.
set -euo pipefail
jq() { command jq "$@" | tr -d '\r'; } # Windows jq ends lines with CRLF
kind="${AGENT_KIND:-claude}"
p=$(herdr pane split "$1" --direction right --no-focus | jq -r '.result.pane.pane_id'); sleep 4 # a fresh shell isn't ready at once (agent_pane_busy)
case "$kind" in
  claude) args=(-- --permission-mode auto); [ "${4:-}" = test ] || args+=(--strict-mcp-config) ;;
  *) args=() ;;
esac
herdr agent start "$2" --kind "$kind" --pane "$p" --timeout 90000 "${args[@]}" | jq -r '.result.agent.agent_status // .'
herdr agent prompt "$2" "Read your brief at $3 and follow it exactly." --wait --timeout 10000 >/dev/null 2>&1 || true
echo "$2 kind=$kind pane=$p status=$(herdr agent get "$2" | jq -r '.result.agent.agent_status')"
