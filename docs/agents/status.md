# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 8 **Phase B** (builds), gate 1 passed (#335) ([sprint-8](sprint-8.md)).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| WF1 placer core + replay harness | merged | — | done | main gates running |
| WF3 map refits | `fix/wf-refits` (w9G) | build-wf3 | building | walkthrough F9, F10 |
| TT4 pause screen | `build/tt-pause` (w9H) | build-tt4 | building | walkthrough T9–T12, T17 |
| TT0 table-tools core | merged (walkthrough 6/6) | — | done | main gates running |
| TT3 alert sounds | merged (walkthrough 15/15) | — | done | main gates running |
| TT1+TT2 macros + roll requests | `build/tt-dice` (w9E) | build-tt12 | part-1 walkthrough running; window + toast parts wait for WF1 / WF4 | part 2: T7, T16 |
| SB0 stats tier-B core | `build/sb-core` (w9A, slot 3) | build-sb0 | walkthrough 10/10; main merged in; gates after main's | merge |
| WF4 toast policy + Stats / card sizes | `fix/wf-sizes-toasts` (w9F) | build-wf4 | building (FR-NOTE-53 waits for WF1) | walkthrough F8, F9, F13 |
| CB0 combat core | merged (walkthrough all PASS) | — | done | main gates running |
| CB1 drag reorder | merged (walkthrough 14/14) | — | done | main gates after WF1 merge |

Queue (seams build plan, `.verify/sprint8/seams.md`): wave 2 WF4, TT1+2, TT3, CB1 · wave 3 WF2, WF3, TT4, SB1+2, CB3 · wave 4 CB2. Slice defs: `%TEMP%/pocket-plane/slices.json` (`wf1`, `tt0`, `sb0`, `cb0`).

## Shared-file locks

- Canvas (MapCanvas, camera, TokensLayer, LabelsLayer) + `free-area.ts`: `fix/wf-refits` (then CB2).
- `PlayFrame.tsx` (top-bar item width): `build/tt-pause`; frame files otherwise free (next: WF2, after TT4).
- Schema lane: free (TT0, CB0 merged).
- `TrayWindow.tsx`, `GameLog.tsx`, `char.roll` server file: `build/tt-dice`.
- Notifications `keep-out.ts`, `ToastRuntime.tsx`: `fix/wf-sizes-toasts` (then TT2's `restoreToast`).
- `combat-tracker/hp.ts` + `log-kinds.ts` (`fell`): `build/sb-core`.

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
