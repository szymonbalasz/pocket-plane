"""Resolve append-only doc conflicts (protocol / data-model): keep main's sections first, then the branch's,
renumbering the branch's new '## NN.' sections after the highest number in main's block.
usage: python resolve_docs.py <file> [<file> ...]   (run in the worktree being merged; HEAD = branch, theirs = main)"""
import re, sys

def resolve(path):
    s = open(path, encoding="utf-8").read()
    pat = re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> main\n", re.S)
    blocks = pat.findall(s)
    if not blocks:
        print(path, "no conflicts"); return
    # main's highest section number over the whole file (outside our side of every hunk), so a branch
    # section never lands on a number main already uses in another hunk or in clean text
    mains = pat.sub(lambda m: m.group(2), s)
    mtop = max((int(n) for n in re.findall(r"^## (\d+)\.", mains, re.M)), default=None)
    def sub(m):
        ours, theirs = m.group(1), m.group(2)
        nums = [int(n) for n in re.findall(r"^## (\d+)\.", theirs, re.M)]
        top = mtop if nums else None
        ren = {}
        if top is not None:
            def bump(mm):
                n = int(mm.group(1)); nn = top + 1 + len(ren); ren[n] = nn
                return f"## {nn}."
            ours = re.sub(r"^## (\d+)\.", bump, ours, flags=re.M)
        print(path, "renumbered", ren)
        sep = "" if theirs.endswith("\n\n") or not ours else "\n"
        return theirs + sep + ours
    s = pat.sub(sub, s)
    open(path, "w", encoding="utf-8", newline="\n").write(s)

def dupes(path):
    # git may append two branches' new sections without a conflict: same number twice
    nums = re.findall(r"^## (\d+)\.", open(path, encoding="utf-8").read(), re.M)
    d = sorted({n for n in nums if nums.count(n) > 1}, key=int)
    if d:
        print(path, "DUPLICATE section numbers:", d, "- renumber the branch's and fix links (fixlinks.py)")

for p in sys.argv[1:]:
    resolve(p)
    dupes(p)
