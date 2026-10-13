# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3 built (Scenes + Combat on `main`). DM ran the demos and gave feedback ([feedback-phase3](feedback-phase3.md), #145–#146). Session handed over (#147): see [continue-session](continue-session.md).

**Herdr:** orchestrator workspace was `wR` (IDs can change; check `herdr pane current --current`). No worktrees, no agents running.

| Task | State | Next |
|---|---|---|
| Foundation, Scenes, Combat builds | merged; 535 tests, build + e2e green; every spec walkthrough PASS; session-sim integration 15/15 | — |
| DM feedback F1–F9 | captured, tiers **proposed** (feature-tiers §8) | DM confirms tiers + [proposed-ui-sounds](../architecture/adr/proposed-ui-sounds.md) |
| F2 diagonal 5/10/5 | decided (#145) | `fix/diagonal-rule` |
| F9 "players type rolls" | click-to-roll is built; suspect Physical dice toggle | test agent repro |
| party-loot spec | revised draft on `main`; DM answered (#146) | revision agent applies #146 → DM sets complete → consolidate → build |
| Phase 4 hardening (crash-recovery pass) | not started | after feedback pass + party-loot |
| Phase 5 MVP acceptance | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (skeleton, scenes-core, play-shell, assets, entities, scenes-map, notifications, dice, char, combat, session, layout).

## Shared-file locks

- None.

## Pending DM decisions

- Confirm proposed tiers F1, F3–F8 (feature-tiers §8) and accept proposed-ui-sounds (amends ADR-0007).

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
