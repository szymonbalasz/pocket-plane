# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 9 Phase B (builds), DM gate 1 passed (#339), plan [sprint-9](sprint-9.md).

**Gates on `main`:** run in the detached worktree `~/.herdr/worktrees/pocket-plane/gates-main` (`git -C <it> checkout --detach main`, then `gates.sh <it> <tag>`), so `main`'s own `dist/` is never rebuilt while the DM tests there.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| RS0 reminders + strongholds core | merged `fb3884a3` | — | done (23/23) | — |
| FX2 dice + gems lines | merged `d4837dc4` | — | done (10/10; branch gates 5232 / 208) | main gates with PM1 |
| PM1 window memory | merged `4179c883` | — | done (re-test 7/7; branch gates 5309 / 209) | main gates: check 5307 + 1 timeout flake (passes alone), e2e 207 + 2 load flakes (pass alone) |
| PM2 Party Manager | merged `77f5fd2f` | — | done (re-test 5/5; e2e 213 + roll-popup flake) | main gates after FX1 |
| FX3 sync, stale chunk, misc | merged `dcd5e20e` | — | done (6/6; branch gates 5326 / 210) | main gates with SP1 |
| SP3 session recap | `build/sp-recap` (ws w9Z, slot 3) | build-sp3 | part 1 7/7, part 2 13/14 (RC5 session picker stale) → fixing + stats edits after FX1 | re-test RC2, RC5, RC1 |
| FX1 toasts + kill feed + stats retry | merged `ed177bd1` | — | done (12/12) | main gates: check 5392 + 1 load flake (3/3 alone), e2e 215 |
| SP1 palette + shortcuts | merged `54ea15b2` | — | done (re-test 11/11; branch gates 5355 / 212) | main gates after PM2 |
| SP2 rules reference | `build/sp-rules` (ws wA2; base PM1) | build-sp2 | walkthrough 14/14 + re-tests 16/16 | merge after RS1 + RS2 |

| RS1 Reminders tab + sheet | merged `d52a5587` | — | done (branch gates 5408 / 216) | main gates running |
| RS2 Strongholds tab + window | `build/hold-ui` (ws wA4; base PM2) | build-rs2 | walkthrough 11/11; stacking on RS1 to wire reminder buttons + icon | short re-test → merge after RS1 |
| RS3 Stores UI | `build/hold-stores` (ws wA5; base RS2) | build-rs3 | walkthrough 18/18 | merge after RS2 |

Queue: SP3 part 2 after PM1 + SP1 + FX1. Gates on main: detached worktree `gates-main`.

## Shared-file locks

- Play-shell frame + canvas: PM1 merged; grants now per slice: FX3 `ShellWindow.tsx` boundary branch; PM2 / RS2 / SP2 / SP3 append rows (windows.ts, size table, goldens, replay sets: regenerate, never hand-merge).
- Schema / core lane: free (RS0 merged); SP3 / FX3 append their lines.
- Toast runtime (ToastRuntime, keep-out, toasts, stack-inputs): `fix/fx-toasts-feed` (FX1).
- Character sheet `sections.ts` + `SheetView.tsx` (count badge): `build/rem-ui` (RS1), granted 2026-10-23.
- Stats client files: FX1, then SP3.
- `sync/connection.ts` + `protocol/frames.ts`: `fix/fx-sync-shell` (FX3).
- combat-tracker `companions.ts` / `hp.ts` strings ("Party Manager"): `build/party-manager` (PM2), granted 2026-10-23.
- Backlog: no picks (four sprint slices working).

## Integrator rulings this sprint (tell the DM at the recap)

- Toast stack: a window's title bar + first 40 px keeps the DM / player toast stack out (amends FR-NOTE-53; FX1 build, 2026-10-23), fallback FR-NOTE-71.
- Placer speed-up 3 (`roomFor`, exact) kept for the 25 ms bench gate (OQ-SHELL-84).
- Party Manager 550 px: 20 new player harness cells approved as named exemptions (BL-93).
- Launcher labels (SP2 re-test): with Rules added, the DM's launcher at 1280 shows icons only (threshold 1434 px); players keep full labels at 1280 (1044 px); per FR-SHELL-43 / #245.
- Walkthrough step wording fixed: live-sync FX3 step 4 (ellipsis only when the name doesn't fit), play-shell SP1 P3 / P8 (fixture pets).

## Pending DM decisions

- None (gate 1 passed, #335).

## Resolved locally (report at gate)

- Sprint 2 phase 1 seams S1–S7 + review rulings: `.verify/review-phase1/{seams,rulings}.md` (main checkout). N7 kinds: `toHit` / `spellToHit` new, `attack` keeps Attack + damage. Token gets a `characterId` display copy (ADR-0021/0024-safe) for FR-CBTX-50. Build plan = the reviewer's graph (`review.md` "Build order").

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `e2e/combat2-polish.e2e.ts` FR-CBT-75 popup placement at 1440×900 / 1280×720 under parallel suites (sprint 5; 8 / 8 alone).
- Known flake: `e2e/weapon-rows.e2e.ts` "2d6+5 slashing" text check under a parallel full e2e (sprint 5; 3 / 3 alone).
- Known flake: `e2e/weapon-combat.e2e.ts` (Flame Tongue line count) under a loaded full run; passes alone.
- Known flake: `vision-s4.bench.test.ts` party move ≤ 30 ms fails only under parallel load (32 ms with 4 suites running; 11 ms alone). Re-run alone before treating it as real.
- Known flake: `placement.test.ts` FR-SHELL-46 inward column ≤ 5 ms under parallel load (37 ms on main after WF1; 3 / 3 alone) → BL-51.
- Known flake: `tooltip-titles.test.ts` FR-SHELL-30 scan times out (5 s) under parallel load; passes alone.
- Known flake: `dice-extras` e2e bundle (dice-extras / dice-screen) 1 / 4 runs under load: login never live, or the 3D chunk (Fit build, sprint 6).
- Known flake: `init-chips-effect.e2e.ts` Divine Fury hover tooltip under a loaded full run (3 / 3 alone; CP3 build).
- Known flake: `fog-of-war/leak.test.ts` walkthrough 8 "No frame within 1500 ms" under a parallel suite (main after BL-49, sprint 7; 3 / 3 alone).
- Known flake: `e2e/popup-line.e2e.ts` FR-DICEX-47 short screens (roll popups count) and `e2e/image-search.e2e.ts` token Image… menu under a loaded full run (sprint 7; pass alone).
- Known flake (sprint 9): `party-loot/sync.test.ts` FR-LOOT-03 "No frame within 1000 ms" under a full check (3 / 3 alone, main after FX1).
- Known flake (sprint 9): `e2e/roll-popup.e2e.ts` FR-DICEX-39–41 under a loaded full run (3 / 3 alone, main after PM1 + FX2).
- Known flake (sprint 9): `strongholds/con44.test.ts` "REM / HOLD §12 CON-44 at the caps" hits the 5 s default timeout under load (passes alone; FX3 sets a 30 s timeout).
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
