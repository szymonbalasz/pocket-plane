# Continue: orchestrator session handover

Start your agent CLI (any Herdr agent kind; Claude Code today) in `C:\Repos\pocket-plane` inside Herdr and say:

> Read `docs/agents/continue-session.md` and continue as the orchestrator.

---

You are the **orchestrator and integrator** for Pocket Plane. Your role, rules, brief templates and phase plan are in [orchestrator-prompt.md](orchestrator-prompt.md). Read it first, then this file, then [status.md](status.md), the current sprint plan [sprint-10.md](sprint-10.md) and the [backlog](backlog.md). Follow [AGENTS.md](../../AGENTS.md) §1: short replies; 1–2 questions at a time, each with options and your pick.

**Working mode (DM, #141):** run long autonomous stretches. Merge, fix and sequence on your own; settle technical questions yourself and log them. Come back to the DM only when blocked: product decisions, phase gates, ADR acceptance, new dependencies, anything destructive. **Sprint milestones first** (#204, #205, [orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill)): pick a small backlog item without asking only during downtime (one agent working, nothing in the sprint queue can start); stop picking near the sprint's end.

## 1. Where we are (2026-10-24)

| Area | State |
|---|---|
| MVP, sprints 1–3 | Done (#176–#242). Playtest scripts in [sprint-2](sprint-2.md), [sprint-3](sprint-3.md#playtest-sprint-3-features). |
| Sprint 4 | **Done (#243–#249).** Vision + fog (middle-mouse pan, plain DM map, 999 ft default, sight while dragging, party vision + View as Party, Blinded, fog brush + Ctrl+Z), dice (die-shape chips, full-screen dice, roll popup, log dice; #247 OS reduced motion ignored), map tools (freeform AoE, drag path + trail, Show to players in Scenes, window placement, labels + best-rectangle Fit), rules (Flame Tongue +1 damage parts, "— DM: hit.", trigger state + badges, negative uses, Divine Fury log line, physical dice in combat), compendium (word search, groups, token art). Gate session-sim-8 16 / 17 (FAIL: launcher windows stack). Playtest script: [sprint-4 §Playtest: sprint 4 features](sprint-4.md#playtest-sprint-4-features). |
| Sprint 5 | **Done (#250–#284).** Windows (no stacking on first open, inward columns, auto-minimise, 2.5× Game log, Fit keeps tokens visible, tool bars push windows aside, live resize, Initiative chips), dice (landing hold, popup dice line, 3D tray stills, compressed + cached client, Alt hints), combat (Apply hit + late damage, log wording, stored trails, ally side), party (Loot tab, handout present, image attach + paste, Add to party), compendium images, player colours + template menu. DM ceiling 1.5 MiB (#256). Gate session-sim-9 13 / 17 (FAILs → BL-38, 39, 40, 43, 47). Playtest script: [sprint-5 §Playtest](sprint-5.md#playtest-sprint-5-features). Test-all bundle: `session-sim-9`. |
| Sprint 6 | **Done (#285–#309).** Companions + summons (owner PC, turn modes, pets with kept HP + Party Companions tab, summons with Dismiss / Turn hostile / concentration card, companion card with attacks via the DM popup, owner edits a pet, paw marker; ADR-0056), window fixes (reopen re-places a covered window, PC footprints, pending toast off tool bars, Fit uses the space, players' reveal refit, Initiative never cuts, tray Roll visible, template label on hover), Preferences (identity chip, free colour picker ADR-0057, Sound / Dice / Layout / Account, loot Subtract), image search + tags in every picker (shared matcher `@shared/search/match`). Backfill BL-33, BL-45, BL-51. Gate session-sim-10 9 / 11 (FAILs: windows can still land on PCs; drake paw marker after End → Start). Playtest script: [sprint-6 §Playtest](sprint-6.md#playtest-sprint-6-features). Test-all bundle: `session-sim-10`. |
| Sprint 7 | **Done (#310–#330).** Gems as an optional per-campaign feature (ADR-0058 feature switches; award / spend, Inspiration reroll with struck lines, Combat gem max dice, gems off hides every trace), stats (ADR-0059 read models: Stats window, live leaderboard, overkill callouts, session awards, From on heals), sprint-6 follow-ups (auto-minimise instead of covering a PC, useful sizes, pushed windows return, Space / focus keyboard, kept HP on rebind, End removes summon tokens, compact companion line, concentration chip, drake paw, no Start jump, reveal refit with the card open), BL-48 copy. Backfill BL-49, BL-50, BL-55, BL-58. Gate session-sim-11 15 / 17 (FAILs → BL-64, BL-65). Playtest script: [sprint-7 §Playtest](sprint-7.md#playtest-sprint-7-features). Test-all bundle: `session-sim-11`. Recap #331–#334 (card shows the line's damage; window-frame pass; sprint 8 scope). |
| Sprint 8 | **Done (#335–#337).** Window frame (ADR-0060: one placer, PCs clear first with a 4-px margin, shrink to useful, put away the LRU launcher window; zones; grow-back; pushes through the ladder; refits never zoom in; one toast stack; session-replay harness failing cells 307 → 19), table tools (ADR-0061: macros, roll requests + Requests window, pause screen, alert sounds), stats tier B (ADR-0062: kill feed, Highlights + End summary, Luck, Trophies), combat polish (ADR-0063: drag reorder, turn ring, Party status). Gate session-sim-12 14 / 16 (FAILs → BL-83, BL-84; glitches BL-85–90). Playtest script: [sprint-8 §Playtest](sprint-8.md#playtest-sprint-8-features). Test-all bundle: `session-sim-12`. Recap + sprint 9 scope #338. |
| Sprint 9 | **Done (#338–#340).** Reminders + strongholds (ADR-0065 records, ADR-0066 Stores holder: Party Manager Reminders / Strongholds tabs, a sheet Reminders tab, the Stronghold window with Facilities / Staff / Stores / Reminders / Notes / Defenders, DM-only rows and Stores items), Party Manager (Party status first, companions under owners, 550 px) + window memory (ADR-0064: moved / resized windows reopen exactly, newest on top, temporary pushes, Reset), fix pack (toast stack, hidden-kill feed, stats retry, fixture load clock ADR-0068, drop detection, stale-chunk reload, log / gem / popup / macro fixes), command palette + shortcuts (ADR-0067), rules quick reference (SRD 5.1 cards), session recap. Gate session-sim-13 14 / 15 (FAIL e → BL-98; glitches BL-97, BL-99–104). Playtest script: [sprint-9 §Playtest](sprint-9.md#playtest-sprint-9-features). Test-all bundle: `session-sim-13`. |
| Sprint 10 | **Done (#341–#342), hardening run, no DM gate.** H1 combat + dice (Add hidden on a bound visible token, roll-request Roll follows dice settings, players' overkill award as damage, one frame per card update, roll-popup e2e), H2 window frame (Party Manager 600 px, shrink-in-place before put-away, Fit / resize round trips never fall to the PCs-only floor, harness DM 10 → 7 / players 37 → 30), H3 toasts (FR-NOTE-75–77: off window content, first rows, modal dialogs), H4 rules / recap / strongholds (Rules lands on the card, rule links / quotes, DM-only badge, recap ≤ 2 s, confirms, party item → Stores, session helper). Gate session-sim-14 **13 / 13** (glitches → BL-107–BL-114). Playtest script: [sprint-10 §Playtest](sprint-10.md#playtest-sprint-10-fixes). |
| Verification | Evidence in the main checkout's `.verify/` (latest `20261018-030613-session-sim-8/`, ranked glitches); sprint-4 seams / rulings / reviews / gate in `.verify/sprint4/`. |
| Specs / ADRs | All specs `complete`. ADRs 0001–0068 accepted (sprint 8: 0060–0063; sprint 9: 0064 window memory, 0065 reminder / stronghold records, 0066 Stores holder, 0067 command registry, 0068 fixture load clock). |
| Decisions | Up to #348 in [decisions-log](../decisions-log.md). |
| CON-44 | Ceilings DM 1.5 MiB (#256, was 1 MiB #208), players 512 KiB. Worst measured DM 863 KB (sprint-4 rules data, 3-byte names), players ≤ 346 KB. Images must stay out of the snapshot. |
| Agents | Herdr kind `claude` (`-- --permission-mode auto`, `--strict-mcp-config` except test agents). |
| Helpers | [`docs/agents/tools/`](tools/), orchestrator only, run from the main checkout by absolute path: `mkwt.sh <branch> <label> [build]`, `startagent.sh <pane> <name> <brief> [test]`, `starttest.sh <ws> <name> <brief-template>`, `poll.sh <agent…>`; **sprint 4 additions:** `gates.sh <dir> <tag>` (check + full e2e, logs `%TEMP%/pocket-plane/{check,e2e}-<tag>.log`, writes a `gates-<tag>.done` marker), `waitgates.sh <tag>` (wait for that marker), `waitrep.sh <agent…>` (wait until an agent is blocked or idle with a finished reply and no background shell), `resolve_docs.py <files>` (resolve protocol / data-model section-number conflicts: main's sections first, the branch's renumbered after; then fix the branch's cross-links by hand), `mkbuild.py <key>…` (builder briefs from `%TEMP%/pocket-plane/slices.json`); **sprint 5 additions:** `startslice.sh <key> [--base <branch>]` (worktree + `.verify` inputs + brief + builder agent in one go), `fixlinks.py` (relink a renumbered protocol / data-model section); **sprint 7 addition:** `mergemain.sh <wt>` (finish a conflicted `git merge main` in a worktree). Change them on `main` only, and **never edit a script while a background job runs it** (bash reads it as it goes). |
| Scratch | `%TEMP%\pocket-plane\`: `briefs/` (builder briefs, test templates `tpl-*.md`), `slices.json`, logs. Storage Sense may clear it. |
| Worktrees | `main` (slot 1; verify port 4112; test agents on `main` use 4113). |

## 2. Next, in order


**Next: rest of the DM recap of sprint 10** (paused after #343–#348: Dice tray +25 %, thin d20 lines, roll popup +40 %, BL-111 / BL-114 built, Stats Campaign tab, faster test loop). Bring: sprint 11 scope (backlog BL-107–BL-110, BL-112, BL-113, BL-115, BL-93). Gates: `gates.sh` now runs `check:full` + e2e on 4 workers (~12 min).

*(Done, #341–#342.)* **Sprint 10, DM decision #341: [sprint-10](sprint-10.md).** A hardening run, **overnight from the kickoff prompt to done, no spec phase and no DM gate unless something truly blocks** (rule the rest yourself, log it in status.md, report at the recap). Four builders at once (H1 combat + dice, H2 window frame + Party Manager, H3 toasts, H4 rules / recap / strongholds / misc), briefs ready in `%TEMP%/pocket-plane/briefs/build-h{1,2,3,4}.md`; then session-sim-14 in a detached gates worktree, "Playtest: sprint 10 fixes", pause and recap.

*(Done, #338–#340.)* Sprint 9: [sprint-9](sprint-9.md). Backlog candidates from sim-13: BL-97 (Add hidden ignored when binding a visible token: leak-like, do first), BL-98, BL-99–BL-104; harness BL-93; flakes BL-95.

*(Done, #338–#340.)* **Sprint 9, DM decision #338: [sprint-9](sprint-9.md).** Tracks RS (Reminders + Strongholds, BL-73), PM (Party Manager: rename, Party status as the first tab, Companions as a section, 550 px; window memory: a moved / resized window always reopens exactly there, most recent on top, the placer only for untouched windows and Reset; amends ADR-0060; owns the frame follow-ups), FX (fix pack: BL-83, -84, -88–91 and older small items), SP (keyboard shortcuts + command palette, rules quick reference, session recap). Phase A specs (all four at once) → seams → two reviews → **one DM gate** → Phase B builds per the hotspot table → session-sim-13 → "Playtest: sprint 9 features" → pause and recap. Don't rebuild `main`'s dist while the DM may be testing on it.
*(Done, #335–#337.)* **Sprint 8, DM decisions #333–#334: [sprint-8](sprint-8.md).** Tracks WF (window-frame pass: one placement path proven by a session-replay layout harness; at small screens PCs stay clear first, then shrink, then put away; BL-52, -53, -59, -60, -61, -64, -65, -66, -70), TT (table tools: saved macros / custom roll buttons, DM roll requests, pause / intermission screen, DM-added alert sounds), SB (stats tier B: kill-feed toasts, trophy case, dice luck tracker, end-of-combat summary), CB (combat polish: drag to reorder initiative, current-turn token highlight, party HP / AC summary for players). Phase A specs (all four at once) → seams → two reviews → **one DM gate** → Phase B builds per the hotspot table → session-sim-12 → "Playtest: sprint 8 features" → pause and recap. Backlog backfill in idle slots (#286).

**Idle slots (#204, #205, #286, [orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill)):** the goal is the sprint's milestones. When an agent slot is idle and nothing in the sprint queue can start (DM #286: "pull more stories from the backlog when there are idle agents"), pick one small eligible item from [backlog](backlog.md) without asking (max two at once; sprint work always wins the next slot); stop picking once the last sprint slices are in flight. If nothing fits, ask the DM.

Lessons from sprint 10 (2026-10-24), on top of the ones below:
- **Test loop (DM #345):** builders run the tests near their change + one full `check` + their area's e2e specs only; the orchestrator runs the full e2e once, in the branch after merging `main` (`gates.sh`); skip `main`'s gates when `git rev-parse main^{tree}` equals the tested branch's tree (`main` didn't move in between), run them otherwise. T4 `fix/test-speed` adds shards / e2e workers / a slow set (`check:full` in final gates).
- **A no-gate hardening run works overnight**: four `fix/*` slices from one sim report, rulings logged as they come; ~1 working day end to end. Each walkthrough FAIL went straight back to its builder with the exact repro rects.
- **Toast / placement fixes need several re-test rounds** (H3: 5/8 → 7/8 → 9/10 → 12/12): each round's fix exposed a sibling case (fold timing, summary-only stacks). Ask builders to reproduce with the report's exact rects in unit tests, and re-test only the changed cases plus a short regression.
- **A test agent in the orchestrator's tab starts in the main checkout**: for the session-sim in the gates worktree, `Set-Location` the server pane there and tell the agent before it starts the server (sim-14 caught it in time).
- **Put-away windows keep their rect**: walkthrough "stacked windows" reports were minimised windows; rect helpers count only `[data-state="open"]`.
- `herdr agent prompt` without `--wait` to a working agent can be dropped: resend once it's idle and check it arrived.
- `startslice.sh` takes `SPRINT_EVIDENCE=<dir under .verify>` to copy the last session-sim into each worktree.

Lessons from sprint 9 (2026-10-22/23), on top of the ones below:
- **Run `main`'s gates in a detached worktree** (`git worktree add --detach <wt> main`; `git -C <wt> checkout --detach main` after each merge): `main`'s own `dist/` is never rebuilt while the DM tests, and the session-sim runs there too (own slot / port).
- **Copy a worktree's `.verify/` out before removing it** (RS0's evidence was lost at cleanup).
- **Every new window adds layout-harness cells** (resize round trips): budget the exemptions per window and track them in one backlog row (BL-93).
- **When two branches register windows, hand the merge to the builder** (windows.ts, size table, goldens, replay sets): they regenerate the generated files and re-apply exemptions; abort a conflicted merge you started.
- Stacking on passed branches (PM2 on PM1, FX1 / SP1 / SP2 on PM1, RS1 / RS2 on PM2, RS3 on RS2, RS2 merging RS1's branch for its wiring) kept 4 slots busy almost all sprint.
- Walkthrough FAILs were often spec wording vs fixtures (pets in sim-12, wide-enough names): rule them and fix the step text on `main` at once.
- A builder's "e2e N passed" can be a partial run: compare with `main`'s count before merging.

Lessons from sprint 8 (2026-10-21/22), on top of the ones below:
- **Never `cd` into a worktree, not even in a compound command**: the session's primary directory followed it and every later command started there (a no-op "merge" ran inside the branch). Use `git -C` and absolute script paths; a standalone `cd /c/Repos/pocket-plane` in a later call restored it.
- **Generated test data conflicts on almost every merge** (`replay.failing.json`, goldens): never hand-merge them; take main's side and regenerate with `UPDATE_FAILING=1` / `UPDATE_GOLDEN=1` in the branch.
- `mergemain.sh` keeps both sides only in index / kinds / windows / session-sim files; other "append-only" files (`kinds.ts` lists with a new field, `sheet-sections.ts`, `notification-views.ts`) can merge into broken code: typecheck after every merge, or hand the merge to the builder.
- Partial walkthroughs early (part 1 before a dependency lands, part 2 after) found real bugs while slots were idle; slices that depend on several branches (the pause screen) merge last and add every cross-slice hook themselves.
- Benches only on a quiet machine: under 4 agents the placer bench read 56 ms, alone 24 ms.
- Never put backticks in a double-quoted `herdr agent prompt` string: bash runs them.
- **Gates on `main` rebuild `main`'s `dist/`** (`bun run e2e` builds): a DM page loaded before that breaks on the next lazily loaded window ("Failed to fetch dynamically imported module"). Tell the DM to hard-reload, and don't run gates on `main` while they test there (BL-91 makes the client offer a reload).

Lessons from sprint 7 (2026-10-20/21), on top of the ones below:
- **Never background with `&` in the Bash tool.** A stray `(...) &` chain ran a second gate run on `main` unseen; both wrote `test-results/` at once (≈ 40 false e2e failures). Use `run_in_background` only; re-run a failed gate alone before calling it real.
- **Doc section numbers collide on almost every merge, often without a conflict** (two §128s after a clean merge). `docs/agents/tools/mergemain.sh <wt>` finishes a conflicted `git merge main` (index files keep both sides, docs via `resolve_docs.py`); always run `resolve_docs.py` afterwards and fix DUPLICATEs with `fixlinks.py`. Merge order decides who renumbers.
- **Stack the next slice on an unmerged branch** (`startslice.sh <key> --base <branch>`) once that branch passed its walkthrough: FU3 on FU1, ST2 on ST-core, GM2 on GM1 kept every slot busy; merge (never rebase) so stacked branches survive.
- **Core slices without UI get a thin walkthrough through raw intents** (`browser_evaluate` + its own WebSocket, as `e2e/gems-core.e2e.ts` does): it caught a real stats bug (facts 1 ms after their entry fell outside the session).
- **Before fixing a "leak", check the decisions log**: the card HP leak was accepted at #138; a contradicting fix waits for the DM.
- A DM pause / session restart kills background gate runs: re-run them on resume; agents keep their context but lose background shells.
- `waitrep.sh` caps at 28 min: long builds return TIMEOUT; just wait again.

Lessons from sprint 6 (2026-10-19/20), on top of the ones below:
- **Never merge into `main` (or run anything else there) while `main`'s gates run**: a merge mid-run changed spec files under a running e2e (3 false failures), and a manual e2e on `main` during gates collided on Playwright trace files (ENOENT).
- **Git can append two branches' protocol / data-model sections with the same number and no conflict**: `resolve_docs.py` now warns about duplicate section numbers; run it after every merge, conflicted or not, and fix with `fixlinks.py`.
- **Golden layout files** (`windows.golden.json`) auto-merge into a wrong state when two branches add window kinds: after such a merge, regenerate with `UPDATE_GOLDEN=1` (invariants + brute check still guard it).
- State-changing e2e specs on a shared bundle bit again (Initiative rows Ended the session-sim-9 fight): every spec that Starts / Ends / Dismisses gets its own alias bundle.
- Small slices in the same area went to one builder with one walkthrough (image picker + wiring, tray + template label, Preferences + Subtract): fewer slots, fewer walkthroughs, no loss.
- Fixed-ms checks belong only in `bun run bench` (BL-51 done); a `bun test` red from a timing bound under load is noise.
- A builder's "fails on the base too" claim needs checking on `main` itself (once it was the branch).

Lessons from sprint 5 (2026-10-18/19), on top of the ones below:
- **Protocol / data-model section numbers collide on every merge**: merge main into the branch, run `resolve_docs.py`, then fix the moved section's links (`docs/agents/tools/fixlinks.py <wt> <protocol|data-model> <old> <new> <slug>` does it). Abort and redo a conflicted merge in the branch's worktree, never resolve on `main`.
- **Gates one at a time**, chained with `waitgates.sh`: parallel suites made timing tests flake; all fixed-ms gates now live in `bun run bench` (#265).
- A builder's walkthrough PASS isn't the end: re-merge main and re-run the branch gates before merging (two real regressions caught that way: Fit's top row, a placement e2e).
- Builders ask for small shared changes mid-slice (a hub flag, a loader option, a test file): grant fast when nothing else holds the file, and log it.
- `herdr agent prompt` can stall on a fresh agent: check `agent get` ~10 s later and resend.

Lessons from sprint 4 (2026-10-17/18), on top of the ones below:
- **Track every unblocked slice.** Two slices (fog brush, party vision) sat ready for hours because nothing listed them as startable; after each merge, scan the plan for what just became unblocked.
- Two slices that share one file can still run in parallel with a merge order (the second rebases); stack a slice on an unmerged branch with `--base` when it needs that branch's code.
- Protocol / data-model section numbers collide on almost every merge: `resolve_docs.py` + fix the moved section's cross-links (`§NN](…#NN-…)`), also in-file `#NN-` anchors.
- Fixture bundles share one server per e2e run: a new spec that changes state (Rage on, a trigger used) breaks the next spec in the same bundle. Give state-changing specs their own bundle name.
- Seeded-looking failures can be real randomness: a test that assumes one die breaks on a natural-20 crit. Ask builders to cover crits / edge rolls in e2e.
- A walkthrough re-test can fail the same way after a fix because the fix's condition doesn't hold in the real layout: have the fixer reproduce the exact browser inputs in a unit test.
- Load-sensitive timing tests (`vision-s4.bench`, `weapon-combat` e2e) flake when several suites run at once: run gates one at a time where possible (`waitgates.sh`), re-run a failure alone before calling it real.
- The DM tests on their own machine during the sprint: answer setup questions first (bundle, profile, settings that disable features such as OS reduced motion).

Lessons from sprint 2 (2026-10-15/16), on top of the ones below:
- **Wait for the builder's commit before you check its worktree.** Running `check` / `e2e` while a builder's own e2e runs collides (Playwright trace ENOENT, ports) and merging main into a dirty tree mixes states. Poll `git status --short` clean + agent not working + "ready" in its output.
- Append-only registry files (`canvas-tools.ts`, `canvas-layers.ts`, bundle / unit indexes) conflict on every parallel merge: the resolution is always "keep both lines"; let the builder do it or use `git -C`.
- Measure snapshot costs in the heavy harness before a gate; estimates were off by 2–3× twice (presets, fogged tokens).
- A spec-only rule a builder can't meet in the default layout (pinned header fallback, toast placement) shows up only in the walkthrough: give builders the default window sizes in the brief.
- Builders: tools only via the repo's binaries (`bun run`, `bun x`); `npx biome` once ran an unrelated npm package.
- Seams between parallel spec agents: write one `seams.md` ruling, copy it into each worktree, let authors push back once; then one review agent across all specs; then `rulings.md` for the review.

Lessons from sprint 1 (2026-10-14):
- **Agents can't read outside their working directory** without a prompt (`blockReadsOutsideWorkingDirectories`). Copy inputs (evidence, review summaries) into the agent's worktree or the main checkout's `.verify/` and point the brief there. Writes to `%TEMP%\pocket-plane\` work.
- A safety hook blocks `rm -rf`, for agents and the orchestrator. Use `git worktree remove --force` (it deletes untracked data); leave `data/verify-*` in the main checkout for the DM.
- **Never `cd` into a worktree** from the orchestrator shell, not even in a compound command: the shell's cwd persists and the session's primary directory switches. Use `(cd <wt> && …)` subshells or `git -C`.
- Run `check` **and the full e2e on `main` after every merge** that touches UI: a branch's own green e2e didn't catch a cross-branch break.
- Suite time is a health signal (#184). Main checkout check now ~40 s.
- Builders who need a shared file message the orchestrator (`shared change needed`); the `from` address goes stale once their session ends.
- Start a dependent fix on top of an unmerged branch with `herdr worktree create --base <branch>` when it only needs one export.

## 3. Herdr: how to run agents (learned the hard way)

Load the `herdr` skill. Check `HERDR_ENV=1`; if not set, stop and tell the DM. Find your workspace: `herdr pane current --current` → `workspace_id` (was `wR`).

**Create a worktree + agent**
```powershell
$r = herdr worktree create --workspace <ws> --branch <type>/<slug> --label <slug> --base main --no-focus | ConvertFrom-Json
# MUST check: $r.result.workspace.worktree.repo_name -eq 'pocket-plane'
# build/* and fix/*: in the worktree run `bun install` and `bun run env:init` before the agent starts
$p = herdr pane split $r.result.root_pane.pane_id --direction right --no-focus | ConvertFrom-Json
Start-Sleep 4   # a fresh shell isn't ready at once; agent start then fails with agent_pane_busy
herdr agent start <name> --kind claude --pane $p.result.pane.pane_id --timeout 90000 -- --permission-mode auto --strict-mcp-config   # test agents: drop --strict-mcp-config (they need the Playwright MCP servers from .mcp.json)
```
- Args after `--` go to the agent CLI and are kind-specific (claude shown). `startagent.sh` keeps them in one `case` per kind.
- **Always pass `--workspace`** (without it Herdr once created worktrees in another repo).
- If `agent start` says `agent_pane_busy`: close that pane, split a new one, wait, retry.
- Read-only reviewers: a new tab in `<ws>` (`herdr tab create --workspace <ws> --label reviews --no-focus`), no worktree.

**Prompting**
- Write each brief to `%TEMP%\pocket-plane\briefs\<name>.md` (UTF-8 is fine), then send one line: `herdr agent prompt <name> "Read your brief at <path> and follow it exactly."`. `--wait` times out while the agent works; check `herdr agent get` instead.
- Write briefs with the file tool, not shell here-docs/here-strings (quoting and interpolation bite in both shells, §4).
- Check `herdr agent get <name>` ~10 s after prompting; if still `idle`, the prompt stalled — resend.
- Poll: loop `herdr agent list` every 30 s, cap ~14 min, stop when any watched agent leaves `working`. `blocked` = a question dialog: read it with `herdr agent read <name> --source visible`; answer with `send-keys` (enter = recommended option) only if it's technical; product questions go to the DM.
- Read results when idle/done: `herdr agent read <name> --source recent-unwrapped --lines 40`.
- Long outputs: agents write to `%TEMP%\pocket-plane\<name>.md`. Hand review findings to a revision agent by copying them into its worktree as `.review.md` (it deletes it before committing).
- MCP: each agent kind loads the Playwright servers from its own repo config (AGENTS §9.6). Only test agents need them; with `claude`, builders, spec and review agents start with `--strict-mcp-config` so they load none. Close a finished agent's pane promptly (its MCP children go with it).

**Builders**
- Brief = orchestrator-prompt §5 builder template plus: own paths (`src/server/features/<f>/`, `src/shared/<f>/`, `src/client/{common,dm,player}/features/<f>/`, `fixtures/units/<f>/`, own bundle, `e2e/<f>.e2e.ts` with a `// e2e-bundle: <name>` header), append-only registries (AGENTS §9.9), and "any other shared file: STOP and report `shared change needed: <path> — <what> — <why>`".
- Approve shared changes by **sequencing**: one branch holds the lock (record it in status.md), the others wait or work on non-shared slices. Builders may write the data-model/protocol rows for what they build.
- Window geometry: protocol §18/§24 is authoritative; shell layout tests are registry-driven (fit at 1280×720, product no-overlap at 1600×900, test windows among themselves).
- Agents must never start long-running servers from their own shell (hangs on Windows) and never run browser sessions; builders report "ready for walkthrough".

**Test agents (browser walkthroughs)**
- Run in the builder's worktree, new tab, plus a **dedicated server pane** (split from the agent pane). Build the client once yourself first (`bun run build` in that worktree, after `git merge main`).
- Template (fill `{{…}}`): see §5 below. Give each test agent its own `PP_PORT` (e.g. base+3 of the worktree's slot), `PP_DATA_DIR=data/verify-<name>`, `PP_PROFILE=verify`, `PP_TEST_MODE=1` when the walkthrough uses Probes / test windows.
- "Drop connection" reconnects in ~0.5 s; agents hold a player offline with Playwright `setOffline` or close the socket to observe the banner. `ERR_CONNECTION_REFUSED` during deliberate outages is expected, not a failure.
- After a PASS: copy `<worktree>\.verify\*` to `%TEMP%\pocket-plane\verify-<task>\` before removing the worktree.

**Merging and cleanup (always)**
1. `git -C <wt> status --short`, `git log --oneline main..HEAD`; in the worktree `git merge main`, then `bun run check` (+ `bun run e2e` for UI changes).
2. On `main`: `git merge --no-ff -q -m "Merge <branch> (…)" <branch>`.
3. Close every pane of the worktree's workspace (`herdr pane list --workspace <id>` → `pane close`), wait 3 s, `git worktree remove --force <path>`, `git branch -d <branch>`, `git worktree prune`.
4. Update status.md, decisions-log, spec index, glossary as the integrator; number proposed ADRs at acceptance (rename file, fix links with `git grep`, add to the ADR index).
5. Known flake: loader tests EBUSY on Windows temp-dir teardown — fixed with retries; if it reappears, it's that.

## 4. Shell and file gotchas

Know your shell: Claude Code's shell tool is **Git Bash** (POSIX: `$TEMP`, `/c/...` paths, `export X=y`); Herdr panes and the DM's terminal are **PowerShell** (`%TEMP%` = `$env:TEMP`, `$env:X='y'`). Write commands for the shell that runs them.

- Prefer the file tools (Read / Edit / Write) over shell text edits for docs: they keep UTF-8 and line endings. LF endings; keep `docs/protocol/README.md` LF.
- Lines with `—`/`§`/`→`: edit with the Edit tool. A shell `.Replace()` / `sed` typed with those characters often won't match (console mojibake; the files are fine).
- Backslashes: Git Bash collapses `\\` even inside quoted here-docs, and `\b`, `\t`, `\v` in a written path become control bytes (this corrupted two `%TEMP%` paths here once). Write scripts with the Write tool, not here-docs; in them build Windows paths with `chr(92)` or forward slashes.
- PowerShell: `@'…'@` (literal) here-strings; with `@"…"@` every `$x` interpolates. Never put `\"` inside a double-quoted string. UTF-8 without BOM: `[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))`. `[regex]::Replace`: write `${1}` when digits follow a backreference. Don't name a helper function `R`.
- Format new JSON/TS files with `bun x biome format --write <file>`.
- Playwright MCP servers: see AGENTS §9.6 (one repo config per agent kind; agents load them at start).

## 5. Test-agent brief template

```
You are verifying ONE walkthrough for Pocket Plane in this worktree (branch {{BRANCH}}). Do NOT fix code, do NOT edit tracked files, do NOT commit.
Read: AGENTS.md section 9.2, 9.3, 9.5, 9.6; docs/specs/{{SPEC}}.md section 13 (the walkthrough) and the FRs it references; docs/architecture/adr/0017-agent-verification-fixture-library.md.
ISOLATION: in EVERY shell command first set PP_PROFILE=verify, PP_PORT={{PORT}}, PP_DATA_DIR=data/{{DATADIR}}{{EXTRAENV}} (bash: export PP_PROFILE=verify PP_PORT={{PORT}} ...; PowerShell: $env:PP_PROFILE='verify'; ...). Use only port {{PORT}}. Never touch other data folders. The client is already built (dist/client); do NOT run bun run build.
1. Reset + load: bun run fixtures:reset-load {{BUNDLE}} (with the env above). Note the printed DM URL, DM secret and player link(s).
2. Start: NEVER from your own shell tool (it hangs on Windows). Use your Herdr pane {{SRVPANE}}: herdr pane run {{SRVPANE}} "<env above, in the pane shell's syntax>; bun run start"; poll http://127.0.0.1:{{PORT}}. Stop: herdr pane send-keys {{SRVPANE}} ctrl+c (hard kill of <pid in server.lock>: PowerShell Stop-Process -Id <pid> -Force; bash taskkill //F //PID <pid>). Logs: herdr pane read {{SRVPANE}} --source recent-unwrapped --lines 80.
3. Browsers: Playwright MCP pw-dm (DM), pw-player-1, pw-player-2 - separate isolated browsers. data-testid selectors; canvas nodes: name = test ID, id = record ID (helper in e2e/support/).
4. Walk through every step of {{SPEC}} section 13. Also: reload mid-flow (DM and a player), player reconnect, cheap edge cases.
5. Evidence under .verify/{{RUNID}}/ (gitignored): report.md (PASS/FAIL per step, repro per failure), NN-<step>-<context>.png, console-<context>.log, server.log excerpt.
6. Teardown: stop the server, close the browsers, bun run fixtures:reset (same env), remove data/{{DATADIR}}.
If spec and app disagree, mark FAIL with what you saw; don't speculate about fixes.
Report (<= 20 lines): PASS/FAIL per step, failures with repro + evidence path, total PASS count.
```

## 6. Don't forget

- Ask the DM before: a new phase, accepting/superseding an ADR, a dependency outside ADR-0001 / #110 / #119, anything destructive, reading their personal config.
- Token display name belongs to the token (#126); only the DM picks targets and applies damage (#134, #136); monsters show players a health band, never HP (#138).
- Gems are tier A (post-MVP, [gems](../specs/gems.md)); MVP data already allows rerolls and maxed damage dice.
- Keep status.md current; it's how the next session picks up.
