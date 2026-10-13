# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3 built (Scenes + Combat on `main`). DM batch done (#148): feedback tiers confirmed, ADR-0030 accepted, targeting stays DM-only, sub-agents run as Claude Code (`--kind claude --permission-mode auto`). Now: feedback spec pass + small fixes in parallel.

**Herdr:** orchestrator workspace `wR` (check `herdr pane current --current`).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| F2 diagonal 5/10/5 | `fix/diagonal-rule` | `build-diagonal` | starting | ruler + drag label + tests → walkthrough |
| F9 "players type rolls" | `main` (no branch) | `test-f9` | starting | repro; if Physical dice → small `fix/*` badge |
| party-loot revision (#146) | `spec/party-loot` | `spec-party-loot` | starting | → DM sets complete → consolidate → build |
| Feedback spec pass (F1, F3, F4, F6, F7, F7.1, F8) | `spec/feedback` | `spec-feedback` | starting | scenes-map, combat-tracker, entities, character-sheet, play-shell → review → consolidation |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | after feedback builds + party-loot (DM go) |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (skeleton, scenes-core, play-shell, assets, entities, scenes-map, notifications, dice, char, combat, session, layout).

## Shared-file locks

- None.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across the five specs (F3 and F7 span several specs; one coherent design beats cross-spec open questions).
- FR-MAP-22 wording for #145 edited on `main` by the integrator so `fix/diagonal-rule` and `spec/feedback` don't collide.
