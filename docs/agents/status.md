# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 6 ([sprint-6](sprint-6.md)), **Phase B** (builds) since 2026-10-20. Gate 1 passed (#288); specs merged and complete; ADR-0056 (companion visibility), ADR-0057 (free player colour).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| WF1 window reopen + footprints + layout tests | `fix/window-reopen` | build-window-reopen (w7Y) | building — **frame lock** | walkthrough → merge; then WF3, PF1 / CP4 merges |
| IM-0 shared matcher | `fix/im-matcher` | build-im-matcher (w7Z) | building | merge (no walkthrough: refactor) |
| IM-1 image tags core | `fix/im-core` | build-im-core (w70) | building — **schema lane 1st** | walkthrough-lite → merge; creates `session-sim-10` |
| CP0 companions core | `fix/cp-core` | build-cp-core (w81) | building — schema lane after IM-1 | merge after IM-1 |
| Queue | — | — | WF2, WF4, WF5, WF6, PF0 (lane after IM-1), PF3, PF1 (merges after WF1) as slots free; then IM-2 → IM-3, CP1, CP2 (after WF4), CP4, CP3, PF2, WF3, CP5 | — |

ID ranges per track (sprint 6): CP ENT FR 31–40 / OQ 31–36, CBT FR 105–124 / OQ 77–84, CHARX FR 59–70 / OQ 31–36, PARTY FR 41–46 / OQ 24–27, MAP FR 74–79 / OQ 54–56, NOTE FR 52–54 / OQ 30. WF SHELL FR 56–69 / OQ 41–46, MAP FR 80–85 / OQ 57–59, CBTX FR 57–62 / OQ 30–32, CBT FR 125–129 / OQ 85–86, DICEX FR 53–56 / OQ 46–47, SCN FR 52–54 / OQ 42–43, NOTE FR 42–45 / OQ 25–26. PF SHELL FR 70–79 / OQ 47–51, CAMP FR 30–37 / OQ 28–32, NOTE FR 46–51 / OQ 27–29, DICEX FR 57–60 / OQ 48–49, LOOT FR 25–28 / OQ 19–20. IM ASSET FR 39–52 / OQ 21–26, CMP FR 54–58 / OQ 43–45, ENT FR 41–43 / OQ 37–38, MAP FR 86–89 / OQ 60–61, SCN FR 55–58 / OQ 44–45, PARTY FR 47–49 / OQ 28–29. Proposed ADRs `proposed-s6-<cp|wf|pf|im>-<slug>.md`.

## Shared-file locks

- Play-shell frame (`manager.ts`, `placement.ts`, `token-boxes.ts`, `ShellWindow.tsx`, `toast-region.ts`, `ShellToaster.tsx`, `free-area.ts`): `fix/window-reopen` (WF1).
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
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
