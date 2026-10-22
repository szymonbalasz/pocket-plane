#!/usr/bin/env bash
# usage: mergemain.sh <worktree>  (run after `git -C <worktree> merge main` stops on conflicts)  - finish a `git merge main` in <worktree>: append-only index files keep both sides,
# protocol / data-model via resolve_docs.py; refuses if any other file is still conflicted. Commits the merge.
set -uo pipefail
W=$1; T=/c/Repos/pocket-plane/docs/agents/tools
python - "$W" <<'EOF'
import sys,re,pathlib,subprocess
w=pathlib.Path(sys.argv[1])
u=subprocess.run(["git","-C",str(w),"diff","--name-only","--diff-filter=U"],capture_output=True,text=True).stdout.split()
for f in u:
    if f.endswith("index.ts") or re.search(r"session-sim-\d+\.ts$", f) or f.endswith("kinds.ts") or f.endswith("windows.ts"):
        p=w/f; s=p.read_text(encoding='utf-8')
        s=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', lambda m: m.group(1)+m.group(2), s, flags=re.S)
        p.write_text(s,encoding='utf-8',newline='\n'); print("both sides:",f)
EOF
docs=$(git -C "$W" diff --name-only --diff-filter=U | grep -E "docs/(protocol|data-model)/README.md" | tr '\n' ' ')
[ -n "$docs" ] && (cd "$W" && python $T/resolve_docs.py $docs)
(cd "$W" && python $T/resolve_docs.py docs/protocol/README.md docs/data-model/README.md >/dev/null 2>&1)
left=$(git -C "$W" diff --name-only --diff-filter=U | grep -v -E "docs/(protocol|data-model)/README.md|index.ts|session-sim-11.ts|kinds.ts|windows.ts")
if [ -n "$left" ]; then echo "STILL CONFLICTED: $left"; exit 1; fi
if grep -l "^<<<<<<<\|^>>>>>>>" "$W"/docs/protocol/README.md "$W"/docs/data-model/README.md "$W"/fixtures/*/index.ts 2>/dev/null; then echo "MARKERS LEFT"; exit 1; fi
(cd "$W" && bun x biome check --write fixtures/bundles/index.ts fixtures/units/index.ts >/dev/null 2>&1)
git -C "$W" add -A && git -C "$W" commit -q --no-edit && git -C "$W" log --oneline -1
