# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 6 ([sprint-6](sprint-6.md)), **Phase B** (builds) since 2026-10-20. Gate 1 passed (#288); specs merged and complete; ADR-0056 (companion visibility), ADR-0057 (free player colour).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Merged | IM-0 #290, IM-1 #291, WF1 #292, PF0 #293 | — | — | — |
| WF4 Initiative rows | `fix/init-rows-s6` | build-init-rows-s6 | walkthrough 15 / 16 (fixture name) + AC / HP fix; branch gates running | merge → unblocks CP2 |
| CP0 companions core | `fix/cp-core` | build-cp-core | ready; main merged; gates queued after WF4 | merge → CP1, CP2, CP4 |
| IM-2 + IM-3 image picker + wiring | `build/im-picker` | build-im-picker, test-im-picker | walkthrough IM1–IM12 running | merge |
| WF3 Fit | `fix/fit-s6` | build-fit-s6 | building — **canvas + free-area lock** | walkthrough F6–F9 (+ F1–F4 recheck) |
| WF2 pending toast | `fix/pending-toast-home` | build-pending-toast-home | building | walkthrough F5 |
| PF1 + PF3 Preferences + loot Subtract | `build/prefs-window` | build-prefs-window | building | walkthrough P-steps |
| Queue | — | — | WF5 tray Roll, WF6 template label; CP1 pets, CP2 turns (after WF4 + CP0), CP4 card, CP3 summon (after CP2), PF2 colour picker (after PF1 + WF5), CP5 marker (after WF3) | — |

ID ranges per track (sprint 6): CP ENT FR 31–40 / OQ 31–36, CBT FR 105–124 / OQ 77–84, CHARX FR 59–70 / OQ 31–36, PARTY FR 41–46 / OQ 24–27, MAP FR 74–79 / OQ 54–56, NOTE FR 52–54 / OQ 30. WF SHELL FR 56–69 / OQ 41–46, MAP FR 80–85 / OQ 57–59, CBTX FR 57–62 / OQ 30–32, CBT FR 125–129 / OQ 85–86, DICEX FR 53–56 / OQ 46–47, SCN FR 52–54 / OQ 42–43, NOTE FR 42–45 / OQ 25–26. PF SHELL FR 70–79 / OQ 47–51, CAMP FR 30–37 / OQ 28–32, NOTE FR 46–51 / OQ 27–29, DICEX FR 57–60 / OQ 48–49, LOOT FR 25–28 / OQ 19–20. IM ASSET FR 39–52 / OQ 21–26, CMP FR 54–58 / OQ 43–45, ENT FR 41–43 / OQ 37–38, MAP FR 86–89 / OQ 60–61, SCN FR 55–58 / OQ 44–45, PARTY FR 47–49 / OQ 28–29. Proposed ADRs `proposed-s6-<cp|wf|pf|im>-<slug>.md`.

## Shared-file locks

- Canvas lock (`MapCanvas.tsx`, `TokensLayer.tsx`, `LabelsLayer.tsx`, `canvas-icons.ts`): free (WF3 merged #302); next CP5 `fix/cp-tokens`.
- Schema lane (`src/server/db/`): `fix/im-core` first, then `fix/cp-core` / PF0 in either order.

## Pending DM decisions

- None (gate 1 passed, #288).

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
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
