"""usage: fixlinks.py <worktree> <doc: protocol|data-model> <old> <new> <anchor-slug-after-number>
Rewrites links to a renumbered section (`#<old>-<slug>` and their `§<old>` labels) in every tracked text file."""
import pathlib, re, subprocess, sys

wt, doc, old, new, slug = sys.argv[1:6]
d = pathlib.Path(wt)
label = "protocol" if doc == "protocol" else "data model"
files = subprocess.run(["git", "-C", wt, "grep", "-l", f"#{old}-{slug}"], capture_output=True, text=True).stdout.split()
for f in files:
    p = d / f
    s = p.read_text(encoding="utf-8")
    t = re.sub(rf"§{old}\]\(([^)#]*)#{old}-{re.escape(slug)}", rf"§{new}](\1#{new}-{slug}", s)
    t = t.replace(f"#{old}-{slug}", f"#{new}-{slug}")
    if t != s:
        p.write_text(t, encoding="utf-8", newline="\n")
        print("fixed", f)
