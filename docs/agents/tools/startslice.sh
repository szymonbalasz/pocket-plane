#!/usr/bin/env bash
# usage: startslice.sh <key> [--base <branch>]  - worktree for slices.json[key].branch, .verify inputs, brief, builder agent build-<key>
# Inputs copied into the worktree: $SPRINT_VERIFY (default .verify/sprint6) seams.md, rulings-a/b.md (concatenated to rulings.md), gate.md
set -euo pipefail
key=$1; base=${3:-main}
M=/c/Repos/pocket-plane; T=$M/docs/agents/tools; W=/c/Users/<user>/.herdr/worktrees/pocket-plane
branch=$(python3 -c "import json,os;print(json.load(open(os.path.join(os.environ['TEMP'],'pocket-plane','slices.json'),encoding='utf-8'))['$key']['branch'])")
label=${branch#*/}
if [ "$base" = main ]; then bash $T/mkwt.sh "$branch" "$label" build | tail -1; else
  ws=$(herdr pane current --current | jq -r '.result.pane.workspace_id' | tr -d '\r')
  herdr worktree create --workspace "$ws" --branch "$branch" --label "$label" --base "$base" --no-focus >/dev/null
  d=$(git -C $M worktree list --porcelain | awk -v b="branch refs/heads/$branch" '/^worktree /{w=substr($0,10)} $0==b{print w}')
  (cd "$d" && bun install 2>&1 | tail -1 && bun run env:init 2>&1 | tail -1); fi
d=$(git -C $M worktree list --porcelain | awk -v b="branch refs/heads/$branch" '/^worktree /{w=substr($0,10)} $0==b{print w}')
mkdir -p "$d/.verify"; cp $M/${SPRINT_VERIFY:-.verify/sprint6}/seams.md "$d/.verify/seams.md"; cat $M/${SPRINT_VERIFY:-.verify/sprint6}/rulings-a.md $M/${SPRINT_VERIFY:-.verify/sprint6}/rulings-b.md > "$d/.verify/rulings.md"; cp $M/${SPRINT_VERIFY:-.verify/sprint6}/gate.md "$d/.verify/gate.md"
# optional: SPRINT_EVIDENCE=<dir under main's .verify/> copied into the worktree's .verify/ (e.g. the last session-sim)
[ -n "${SPRINT_EVIDENCE:-}" ] && cp -r "$M/.verify/$SPRINT_EVIDENCE" "$d/.verify/"
(cd $M && python3 $T/mkbuild.py "$key" >/dev/null)
ws=$(herdr workspace list | jq -r ".result.workspaces[]|select(.label==\"$label\")|.workspace_id" | tr -d '\r' | tail -1)
r=$(herdr pane list --workspace "$ws" | jq -r '.result.panes[0].pane_id' | tr -d '\r')
echo "dir=$d ws=$ws"
bash $T/startagent.sh "$r" "build-$key" "C:/Users/<user>/AppData/Local/Temp/pocket-plane/briefs/build-$key.md" | tail -1
