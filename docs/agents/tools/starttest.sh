#!/usr/bin/env bash
# usage: starttest.sh <ws> <name> <brief-template>  - new tab in <ws> + server pane, fill {{SRVPANE}} into <name>.md next to the template, start the test agent
# Run from the main checkout (orchestrator only).
set -euo pipefail
jq() { command jq "$@" | tr -d '\r'; } # Windows jq ends lines with CRLF
here=$(cd "$(dirname "$0")" && pwd)
ws=$1; name=$2; tpl=$3
root=$(herdr tab create --workspace "$ws" --label "$name" --no-focus | jq -r '.result.root_pane.pane_id')
sleep 3
srv=$(herdr pane split "$root" --direction down --no-focus | jq -r '.result.pane.pane_id')
out="$(dirname "$tpl")/$name.md"
sed "s/{{SRVPANE}}/$srv/g" "$tpl" > "$out"
echo "root=$root server=$srv brief=$out"
bash "$here/startagent.sh" "$root" "$name" "$out" test 2>&1 | tail -1
