# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 2 complete (#200). **Sprint 3 planned, not started** (#201–#204): [sprint-3](sprint-3.md). Next: four spec agents (V, D, R, P), C when a slot frees; backfill rule active ([orchestrator-prompt §3a](orchestrator-prompt.md#3a-keep-the-agents-busy-backfill), [backlog](backlog.md)).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| V: fog v2 + vision + walls | `spec/vision` | — | Not started | Spec agent |
| D: dice extras | `spec/dice-extras` | — | Not started | Spec agent |
| R: modifiers tiers 1–3 + triggers | `spec/rule-triggers` | — | Not started | Spec agent |
| P: party board + handouts | `spec/party-board` | — | Not started | Spec agent |
| C: compendium | `spec/compendium` | — | Not started | Spec agent when a slot frees |
| Backfill (BL-nn) | `fix/bl-<nn>-<slug>` | — | None | Per §3a |

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
