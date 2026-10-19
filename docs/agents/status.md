# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 5 **Phase B (builds)**, gate 1 passed (#256). Plan + build order: [sprint-5](sprint-5.md), `.verify/sprint5/gate.md`. DM check bundle: `session-sim-9`.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Specs (all six) | merged, complete | — | done (#256); ADRs 0051–0055 | — |
| P0 party core, R0 combat core | merged | — | done (#257, #258) | — |
| K1 template menu | fix/tpl-menu (w6W) | build-tpl-menu, test-tpl-menu | walkthrough (port 4123) | merge (canvas holder #1) |
| W1 window layout | fix/window-layout (w6X) | build-window-layout | building (frame + toast lock) | walkthrough |
| D8 dice landing | build/dice-landing (w6Y) | build-dice-landing, test-dice-landing | walkthrough (port 4133) | merge after W1 |
| P1 image attach | build/image-attach (w6Z) | build-image-attach, test-image-attach | walkthrough (port 4143) | merge |
| Queue | — | — | P2 present UI, C5 core, R1 late damage, R4 ally UI (after W4), K0 colours core, D12, W4, P3, P4 | as slots free |

## Shared-file locks

- Schema: lane 1 P0 → C5 core; lane 2 R0 → K0; merge order P0 → R0 → C5 core → K0 (seams S1).
- Canvas: K1 → W2 → R3 → K3 (S10). Play-shell frame + toast region: W1 (S2). `GameLog.tsx`: W1 → D8 → D9 → K4 (S15). `src/server/app.ts`: D12 (S11).
- Protocol / data-model section numbers: assigned at merge (`resolve_docs.py`).

## Pending DM decisions

- None (sprint 5 starts with the kickoff prompt).

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
