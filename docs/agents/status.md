# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 5 Phase A (specs), [sprint-5](sprint-5.md). Kickoff 2026-10-18.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Sprint 4 | merged | — | Done (#243–#251) | — |
| W windows + layout | spec/s5-windows (w6G) | spec-windows | Phase A spec | report → seams |
| D dice polish | spec/s5-dice (w6H) | spec-dice | spec drafted, idle | seams |
| R late damage + log + ally side (#252) | spec/s5-combat (w6J) | spec-combat | drafted; adding ally side | report → seams |
| P party + uploads | spec/s5-party (w6K) | spec-party | spec drafted, idle | seams |
| C compendium images | spec/s5-cmpimg (w6M) | spec-cmpimg | Phase A spec | report → seams |
| K player colours + template delete [1] | spec/s5-colours (w6N) | spec-colours | Phase A spec | report → seams |
| backfill (BL-28) load-tolerant bench gate | fix/bl-28-bench-tolerant (w6P) | fix-bl-28 | building | merge |
| backfill (BL-16) stable useRecords array | fix/bl-16-stable-records (w6Q) | fix-bl-16 | building; holds `src/client/common/sync/store.ts` | merge |

New ID ranges per track (parallel edits of shared specs): in the briefs `%TEMP%/pocket-plane/briefs/spec-s5-*.md`.

## Shared-file locks

- None (all sprint-4 branches merged).
- Order: schema V6 → R0 → Mc → C-art core; canvas V7 → V8 → M2 → M5 → C-art; sheet V6 → R weapon rows → R negative uses; toast region M4 → D7; log D5 → R Fury line; creature form R weapon rows → C-art.
- Protocol / data-model section numbers: assigned at merge (parallel branches collide; `resolve_docs.py` in the scratch dir renumbers the later one).

## Pending DM decisions

- None (sprint 5 starts with the kickoff prompt).

## Resolved locally (report at gate)

- Sprint 2 phase 1 seams S1–S7 + review rulings: `.verify/review-phase1/{seams,rulings}.md` (main checkout). N7 kinds: `toHit` / `spellToHit` new, `attack` keeps Attack + damage. Token gets a `characterId` display copy (ADR-0021/0024-safe) for FR-CBTX-50. Build plan = the reviewer's graph (`review.md` "Build order").

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `e2e/weapon-combat.e2e.ts` (Flame Tongue line count) under a loaded full run; passes alone.
- Known flake: `vision-s4.bench.test.ts` party move ≤ 30 ms fails only under parallel load (32 ms with 4 suites running; 11 ms alone). Re-run alone before treating it as real.
- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
