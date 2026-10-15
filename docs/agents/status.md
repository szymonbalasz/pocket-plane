# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 1 complete (#186). **Sprint 2 phase 1 running** (#187, #188): [sprint-2](sprint-2.md). Q merged (#189 pending log). P2a / P2b / M specs written, seams settled (`.verify/review-phase1/seams.md`), reviewed (1 blocker + 11 major + 31 minor, all applied per `rulings.md`). **Waiting: DM gate 1** (`%TEMP%/pocket-plane/gate-sprint2-phase1.md`).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Q: token art cache bug (N2) | merged a23af22 | — | Done (walkthrough 8/8; main check 1140 + e2e green) | — |
| P2a: combat notes + glitches | `spec/polish-2a` (w2F) | spec-polish-2a | Reviewed, in-review | DM gate 1, then merge + builds |
| P2b: sheet + shell notes + glitches | `spec/polish-2b` (w2G) | spec-polish-2b | Reviewed, in-review | DM gate 1, then merge + builds |
| M: effect modifiers (N9) | `spec/effect-modifiers` (w2H) | spec-effect-modifiers | Reviewed, in-review | DM gate 1, then merge + builds |
| F: fog of war (phase 2) | `spec/fog-of-war` | — | After phase 1 | — |
| B: props + structure (phase 2) | `spec/scene-tools` | — | After phase 1 | — |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- None.

## Pending DM decisions

- DM gate 1: N1, G2, M scope / timing / physical dice / buffing / conditions / CON-44, OQ-CBT-49 / -50 / -54, two proposed ADRs (split-attack-damage, effect-modifiers).

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
