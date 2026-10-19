# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 5 **Phase B (builds)**, gate 1 passed (#256). Plan + build order: [sprint-5](sprint-5.md), `.verify/sprint5/gate.md`. DM check bundle: `session-sim-9`.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Specs D, R, P, C | merged | — | done | — |
| Spec W (DM changes #256) | spec/s5-windows (w6G) | spec-windows | applying OQ-SHELL-32 C + tool-bar push | merge → W1 |
| Spec K | spec/s5-colours (w6N) | spec-colours | merging main (conflicts) | merge → K1 |
| P0 party core | build/party-s5-core (w6T) | build-party-s5-core | building | walkthrough → merge (schema lane 1, first) |
| R0 combat core | fix/s5-combat-core (w6V) | build-s5-combat-core | building | merge after P0 (schema lane 2) |
| Queue | — | — | W1, K1 (after their specs), D8, D12, W4, P3, P4 | as slots free (≤ 4 working) |

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
