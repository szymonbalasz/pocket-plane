# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 2 — Skeleton build (Foundation) + Scenes specs (spec / review)

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Skeleton build | build-skeleton (`w17:p2`) | `w17` / `build/skeleton` | working | — |
| Spec scenes-map | spec-scenes-map (`w18:p2`) | `w18` / `spec/scenes-map` | working | — |
| Review assets-pipeline | review-assets-pipeline (`wR:p9`) | `main` (read-only) | working | — |
| Review entities | review-entities (`wR:pA`) | `main` (read-only) | working | — |
| Review play-shell | — | — | queued | slot |
| Spec assets-pipeline, entities, play-shell | — (ended) | merged to `main` | in-review | reviews → DM gate |

## Risks

- Skeleton owns every shared file; no other `build/*` until it merges (AGENTS §9.9).

## Resolved locally (report at gate)

- ADR to-dos in 0002/0008/0017 point to AGENTS.md §9.
- Foundation consolidation conflicts CON-01–17 resolved (#118); CON-03: pipeline core against a test-only kind, entities adds the table.
