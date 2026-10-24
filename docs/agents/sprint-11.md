# Sprint 11: backlog fixes + art-pass planning

DM decision #349 (sprint-10 recap, part 3): two parallel tracks. **Fix track** (orchestrator): the session-sim-14 backlog, run like sprint 10's hardening (no spec phase, no DM gate unless something truly blocks; the orchestrator rules and logs in status.md). **Art track** (DM, own agent): plan the art / style pass ([BL-29](backlog.md)) before notes and world-building; it works in its own worktree and touches only `docs/design/` until a build is planned, so the tracks don't collide. Process: [orchestrator prompt](orchestrator-prompt.md), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and the faster test loop (#345).

Evidence: the [session-sim-14 report](../../.verify/20261024-061849-session-sim-14/report.md) (local, gitignored; copied into each worktree).

## Slices (three builders at once; one walkthrough each)

| Slice | Branch | Items | Area (files) |
|---|---|---|---|
| **F1** frame + camera | `fix/f1-frame` | **BL-107** (DM 1440×900: Fit with the untouched 600-px Party Manager mid-map falls to the 48-px PCs-only view); **BL-109** (player 1280×720 out of a fight: opening Rules beside Recap + Stats puts both away though Rules + Stats fit); from **BL-113**: Party Manager at 600 covering the whole enemy line at DM 1440 (PC rule only), DM launcher icon-only at 1440 in test mode; **BL-93** where the fixes allow | play-shell frame (placer, put-away order, size table, goldens, replay), scenes-map camera Fit, launcher |
| **F2** toasts | `fix/f2-toasts` | **BL-108** (the DM's pending-actions toast on window content where no clear spot exists: the Roll requests card, Party Manager Loot wallets, the damage-card popup's heading / damage field); **BL-115** (toast stack keeps moving: `combat2-polish` FR-CBT-75 `stableBox` flake; settle the stack) | notifications `ToastRuntime.tsx`, `keep-out.ts`, `toasts.ts`, `stack-inputs.ts`, `e2e/combat2-polish.e2e.ts` |
| **F3** combat + dice | `fix/f3-combat-dice` | **BL-110** (Next silently skips a downed companion: give the "Skipped …" toast as for positioned combatants); **BL-112** (the Dice tray stays open after a roll-request prompt is answered via Alt → tray); from **BL-113**: "Add hidden" already ticked when Add… first opens (check FR-CBTX default) | combat-tracker next / skip toast, combat-extras Add dialog, dice-extras prompt / tray |

## Boundaries and hotspots

| Overlap | Rule |
|---|---|
| Play-shell frame (placer, manager, size table, goldens, replay harness), scenes-map camera, launcher | **F1** holds them all sprint |
| Toast runtime | **F2** |
| combat-tracker next / skip, combat-extras Add, dice-extras prompt / tray | **F3** |
| `docs/design/`, concept art, theme tokens | **Art track** (DM's agent); fix branches don't touch them; no `src/` change from the art track until a build is planned |
| Schema | none expected |

## Orchestrator: how to run this sprint

1. Briefs via `mkbuild.py` (`f1`–`f3` in `slices.json`), inputs `.verify/sprint11/`, sim-14 evidence copied in (`SPRINT_EVIDENCE`). Start all three.
2. Builders: tests near the change + `bun run check` + their area's e2e specs (#345). Walkthrough per slice (DM + two players, reload, leak scan where visibility is involved). Then `merge main` + `gates.sh` (check:full + e2e on 4 workers) in the branch → merge; `main`'s gates only when `main`'s code moved since the branch was tested.
3. Sprint gate: **session-sim-15** on final `main` in a detached gates worktree (bundle `session-sim-13`): every item above, sim-14's glitch list, full regression, leak scan, hard kill. Then "Playtest: sprint 11 fixes" here, pause, recap. Clean up worktrees, panes, tabs.

## Progress

| Date | What |
|---|---|
| 2026-10-24 | Planned (DM #349): fix track F1–F3 + DM's art track in parallel |
| 2026-10-24 | **F3 merged**: the DM's skip toast names a downed companion that acts in its owner's turn; a roll request answered through the tray puts the tray back as it was; "Add hidden" default confirmed. Walkthrough 16 / 16 |
| 2026-10-24 | **F1 merged**: Fit keeps every token in view with an untouched window open (also after a resize); opening a window puts away only one other (moving one aside first); launcher labels drop one at a time. Walkthrough 11 / 12 → re-test 6 / 6 |
