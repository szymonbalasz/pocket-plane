# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 7 **Phase A (specs)** started 2026-10-20 ([sprint-7](sprint-7.md)): specs written, seams + review rulings applied; DM gate 1 **passed** (#315); specs merged + integrated (ADR-0058, -0059). Paused by the DM on 2026-10-21, **resumed** the same day ("go"). Phase B wave 2-3 in progress.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| GM1 Inspiration reroll | `build/gems-reroll` (ws w8V) | build-gm1 | walkthrough PASS (re-test) | branch gates → merge; then ST-core rebases |
| ST-core | `fix/st-core` (ws w8W) | build-st-core | session fix in; main merged | merge GM1 via main → re-test F1 → gates → merge |
| ST2 Stats window | `build/st-window` (ws w80, stacked on st-core) | build-st2 | building | walkthrough → merge after ST-core |
| FU3 map follow-ups | `fix/fu-map` (ws w8Y, was stacked on fu-frame) | build-fu3 | Start-refit follow-up | merge main → gates → merge |
| GM2 Combat gem | `build/gems-combat` | — | waits GM1 + ST-core | — |

ID ranges (maxima on 2026-10-20 + per-track blocks; briefs `%TEMP%/pocket-plane/briefs/spec-s7-*.md`):
- GM: GEM FR 01-40 / OQ 04-20; CAMP FR 38-45 / OQ 33-36; DICE FR 62-71 / OQ 41-44; DICEX FR 59-62 / OQ 49-50; CBT FR 126-135 / OQ 85-88; CHARX FR 71-80 / OQ 37-40; MOD FR 64-67 / OQ 47-48; SHELL FR 98-100 / OQ 61-62; NOTE FR 52-54 / OQ 30-31.
- ST: STATS FR 01-40 / OQ 01-20; DICE FR 72-76 / OQ 45-47; CBT FR 136-140 / OQ 89-91; SHELL FR 93-97 / OQ 58-60; NOTE FR 48-51 / OQ 28-29; MAP FR 98-100 / OQ 65-66; CHARX FR 86-88 / OQ 43.
- FU: SHELL FR 77-92 / OQ 52-57; MAP FR 88-97 / OQ 61-64; CBT FR 141-160 / OQ 92-99; CBTX FR 59-64 / OQ 30-32; CHARX FR 81-85 / OQ 41-42; NOTE FR 44-47 / OQ 26-27; ENT FR 42-45 / OQ 38-39; PARTY FR 49-53 / OQ 29-30; LOOT FR 29-31 / OQ 21; DICE FR 77-79 / OQ 48-49; DICEX FR 63-65 / OQ 51; MOD FR 68-70 / OQ 49; CMP FR 57-59 / OQ 45.

## Shared-file locks

- Schema lane: free. Apply path: GM1 first, ST-core rebases, then GM2.
- Canvas lock: FU3. Play-shell frame: free (FU1 merged).

## Pending DM decisions

- None.

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
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
