# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 2 — consolidation (foundation) + Scenes specs; skeleton build next

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Consolidate foundation (data model + protocol) | review-consolidate (`w13:p2`) | `w13` / `spec/consolidate-foundation` | working | — |
| Spec assets-pipeline | spec-assets-pipeline (`w14:p2`) | `w14` / `spec/assets-pipeline` | working | — |
| Spec entities | spec-entities (`w15:p2`) | `w15` / `spec/entities` | working | — |
| Spec play-shell | spec-play-shell (`w16:p2`) | `w16` / `spec/play-shell` | working | — |
| Skeleton build | — | `build/skeleton` (not created) | queued | consolidation merged |
| Spec scenes-map | — | — | queued | assets, entities, play-shell drafts |

## Risks

- Skeleton owns every shared file; no other `build/*` until it merges (AGENTS §9.9).

## Resolved locally (report at gate)

- ADR to-dos in 0002/0008/0017 now point to AGENTS.md §9.
