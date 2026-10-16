# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 3 Phase A (specs) started 2026-10-16 (#201–#205): [sprint-3](sprint-3.md). V, D, R, P spec agents working; C when a slot frees; backlog only during downtime, not near the sprint's end ([orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill), [backlog](backlog.md)).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| V: fog v2 + vision + walls | `spec/vision` (w3D, slot 0) | spec-vision | Working | Report → seams |
| D: dice extras | `spec/dice-extras` (w3E, slot 2) | spec-dice-extras | Working | Report → seams |
| R: modifiers tiers 1–3 + triggers | `spec/rule-triggers` (w3F, slot 3) | spec-rule-triggers | Working | Report → seams |
| P: party board + handouts | `spec/party-board` (w3G, slot 4) | spec-party-board | Working | Report → seams |
| C: compendium | `spec/compendium` | — | Not started | Spec agent when a slot frees |
| Backlog (BL-nn), downtime only | `fix/bl-<nn>-<slug>` | — | None | Per §3a |

## Shared-file locks

- None.

## Pending DM decisions

- None now. Sprint-3 gate 1: picks per track, dependencies (3D dice / physics, geometry), ADRs (dynamic vision, rule triggers), build order.

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
