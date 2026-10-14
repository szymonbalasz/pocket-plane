#!/usr/bin/env bash
# usage: mkwt.sh <branch> <label> [build]  - create a Herdr worktree for <branch> off main; with "build": bun install + env:init
# Workspace: $HERDR_WORKSPACE, else the caller's own (herdr pane current). Run from the main checkout (orchestrator only).
set -euo pipefail
jq() { command jq "$@" | tr -d '\r'; } # Windows jq ends lines with CRLF
here=$(cd "$(dirname "$0")" && pwd)
repo=$(basename "$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")")
ws="${HERDR_WORKSPACE:-$(herdr pane current --current | jq -r '.result.pane.workspace_id')}"
r=$(herdr worktree create --workspace "$ws" --branch "$1" --label "$2" --base main --no-focus)
got=$(echo "$r" | jq -r '.result.workspace.worktree.repo_name')
[ "$got" = "$repo" ] || { echo "WRONG REPO ($got, expected $repo): $r"; exit 1; }
wsid=$(echo "$r" | jq -r '.result.workspace.workspace_id'); root=$(echo "$r" | jq -r '.result.root_pane.pane_id')
d=$(git -C "$here" worktree list --porcelain | awk -v b="branch refs/heads/$1" '/^worktree /{w=substr($0,10)} $0==b{print w}')
[ -n "$d" ] || { echo "worktree for $1 not found in git worktree list"; exit 1; }
echo "ws=$wsid root=$root dir=$d"
if [ "${3:-}" = build ]; then (cd "$d" && bun install 2>&1 | tail -1 && bun run env:init 2>&1 | tail -1); fi
