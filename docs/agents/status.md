# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 9 Phase B (builds), DM gate 1 passed (#339), plan [sprint-9](sprint-9.md).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| PM1 window memory (frame + canvas) | `fix/window-memory` (ws w9T, slot 0) | build-pm1 | building | walkthrough M0, M3-M10, M12, M14 |
| PM2 Party Manager | `build/party-manager` (ws w9V, slot 2) | build-pm2 | party-board part done (4 commits); waits for PM1 to merge for shared rows | walkthrough M0-M2, M11, M13 |
| RS0 reminders + strongholds core | `fix/rs-core` (ws w9W, slot 3) | build-rs0 | ready (check 5214, e2e 206; CON-44 DM +2.9 KB) | test-rs0 walkthrough running |
| FX2 dice + gems lines | `fix/fx-dice-lines` (ws w9X, slot 4) | build-fx2 | building | walkthrough FX2 |
| FX3 sync, stale chunk, misc | `fix/fx-sync-shell` (ws w9Y) | build-fx3 | building (ShellWindow branch after PM1; merges after RS0) | walkthrough FX3 |

Queue (`.verify/sprint9/seams.md` build plan): wave 2 FX3, SP3 server (after RS0) · wave 3 after PM1: FX1, SP1, SP2 · wave 4 after RS0 + PM1 + PM2: RS1, RS2 · wave 5 RS3; SP3 stats edits after FX1. Slice defs: `%TEMP%/pocket-plane/slices.json` (`pm1`, `pm2`, `rs0`, `fx2`).

## Shared-file locks

- Play-shell frame (placer, manager, placement, geometry, shell-store, ShellWindow, registry, ShellContext, keys, layout-checks, free-area (granted 2026-10-23), replay + goldens, placement bench) + canvas (MapCanvas, camera): `fix/window-memory` (PM1), all sprint.
- Schema / core lane (`src/server/db/`, `src/shared/events/`, record-type registry, `features/index.ts`): `fix/rs-core` (RS0) first; then SP3, FX3.
- Toast runtime (ToastRuntime, keep-out, toasts, stack-inputs): FX1 (not started).
- Stats client files: FX1, then SP3.
- `sync/connection.ts` + `protocol/frames.ts`: `fix/fx-sync-shell` (FX3).
- combat-tracker `companions.ts` / `hp.ts` strings ("Party Manager"): `build/party-manager` (PM2), granted 2026-10-23.
- Backlog: no picks (four sprint slices working).

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
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
