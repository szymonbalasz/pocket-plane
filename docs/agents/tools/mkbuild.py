"""Builder brief generator (orchestrator only). usage: python mkbuild.py <key>...  (reads %TEMP%/pocket-plane/slices.json)
Writes briefs/build-<key>.md from SLICES below."""
import json, os, sys, pathlib

BASE = pathlib.Path(os.environ["TEMP"]) / "pocket-plane"  # briefs/ and slices.json live in the scratch dir
TPL = """# Brief: build-{key} ({branch}) — sprint {sprint} slice {sid} ({title})

You are implementing ONE slice of Pocket Plane (branch {branch}, this worktree; .env and bun install done).
Read: AGENTS.md (section 9 build conventions, 9.3 fixtures + seams, 9.5 test IDs, 9.9 shared files), {specs} (status complete: your slice row in the spec's build split, the FRs / tests / walkthrough steps it names), docs/data-model/README.md, docs/protocol/README.md, ADR-0016, ADR-0017, ADR-0022{adrs}, docs/decisions-log.md ({decisions}), and .verify/seams.md + .verify/rulings.md + .verify/gate.md in this worktree (this sprint's seams, review rulings and the DM's gate picks, {gate}: they override older text where they conflict).{extra}
Scope: {scope}
Rules: every capability is a server command (validated intent → mutate + event log in one transaction → domain event → listeners → visibility filter → WS). IDs / tokens / time / dice only from ctx. zod at every boundary (z.infer, no duplicates). No feature logic in clients. Players never receive what they must not see: leak tests per player (snapshot, events, signals, load acks, before and after reconnect). CON-44: measure any snapshot growth in the heavy harness (DM ceiling 1.5 MiB since #256, players 512 KiB); never raise a ceiling.
Own paths: {own}
Shared files assigned to this branch (locks held by you, AGENTS 9.9): {shared}. Docs rows (protocol / data-model) for what you build, in this branch (section numbers fixed at merge). Any other shared file: STOP and report "shared change needed: <path> — <what> — <why>".
Window geometry: protocol §18 / §24 is authoritative; registry-driven layout tests must pass (fit 1280×720, no product overlap 1600×900).
Fixtures: add your slice's units to your own bundle AND append the ones the sprint gate needs to fixtures/bundles/{simbundle}.ts under your track's comment (keep both lines on a merge; if that bundle isn't on main yet, add your lines after rebasing once it is).
Done: every FR of the slice implemented with a named test (test("FR-<PREFIX>-NN …")); test loop per AGENTS 9.4.1 (DM #368): locally only the targeted bun run check (re-run once if a snapshot-size or loader test fails with SQLITE_BUSY / EBUSY: known flakes) and the e2e specs of your area (one bun run build, then bun run e2e <spec>.ts … --no-build: your new ones + the existing ones touching your files); never check:all, check:full or the full e2e locally — GitHub CI runs everything on each push. Tools only via bun run / bun x (never npx). Never start long-running servers from your shell; no browser sessions.
Commit per sub-slice (short imperative subject, no attribution lines); git push -u origin {branch}; start bun run ci:watch as a BACKGROUND job and keep working; act only when it exits non-zero (fix, push, watch again). A deliberate look change: gh workflow run screenshots.yml --ref {branch}, say so in the report. When done, STOP and report "ready for walkthrough: {sid} ({title})" with the CI state so far.
Report (<= 20 lines): what's done per FR, tests, check / build / e2e, CON-44 figures if you added records, shared files touched, open issues with suggested picks.
"""

def main():
    slices = json.loads((BASE / "slices.json").read_text(encoding="utf-8"))
    for key in sys.argv[1:]:
        s = dict(slices[key]); s["key"] = key; s.setdefault("sprint", "6"); s.setdefault("gate", "#288"); s.setdefault("simbundle", "session-sim-10"); s.setdefault("decisions", "the current sprint's DM decisions and gate")
        s.setdefault("adrs", ""); s.setdefault("extra", "")
        out = BASE / "briefs" / f"build-{key}.md"
        out.write_text(TPL.format(**s), encoding="utf-8")
        print(out)

main()
