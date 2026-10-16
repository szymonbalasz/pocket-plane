# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 3 Phase A (specs) started 2026-10-16 (#201–#205): [sprint-3](sprint-3.md). all five specs drafted; seams ruling `.verify/sprint3/seams.md` (main checkout), seams applied (no pushbacks); reviews done (a: 1/11/17, b: 1/11/35 blocker/major/minor); rulings `.verify/sprint3/rulings.md`; rulings applied by all five; **waiting on DM gate 1** (`%TEMP%\pocket-plane\gate-sprint3.md`, copy `.verify/sprint3/gate.md`); backlog only during downtime, not near the sprint's end ([orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill), [backlog](backlog.md)).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| V: fog v2 + vision + walls | `spec/vision` (w3D, slot 0) | — | Spec in-review, rulings applied | DM gate 1 |
| D: dice extras | `spec/dice-extras` (w3E, slot 2) | — | Spec in-review, rulings applied | DM gate 1 |
| R: modifiers tiers 1–3 + triggers | `spec/rule-triggers` (w3F, slot 3) | — | Spec in-review, rulings applied | DM gate 1 |
| P: party board + handouts | `spec/party-board` (w3G, slot 4) | — | Spec in-review, rulings applied | DM gate 1 |
| C: compendium | `spec/compendium` (w3H, slot 5) | — | Spec in-review, rulings applied | DM gate 1 |
| Backfill (BL-02): Start round 1 reason | `fix/bl-02-start-round-reason` (w3K, slot 6) | build-bl-02 | Working | Merge (thin e2e) |
| Backlog (BL-nn), downtime only | `fix/bl-<nn>-<slug>` | — | BL-06 merged (#206) | Per §3a |

## Shared-file locks

- None.

## Pending DM decisions

- Sprint-3 gate 1 (G1–G33): dependency three + cannon-es, snapshot guard re-baseline, five ADRs, picks per track, cut order. File `%TEMP%\pocket-plane\gate-sprint3.md`.

## Resolved locally (report at gate)

- Sprint 2 phase 1 seams S1–S7 + review rulings: `.verify/review-phase1/{seams,rulings}.md` (main checkout). N7 kinds: `toHit` / `spellToHit` new, `attack` keeps Attack + damage. Token gets a `characterId` display copy (ADR-0021/0024-safe) for FR-CBTX-50. Build plan = the reviewer's graph (`review.md` "Build order").

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
