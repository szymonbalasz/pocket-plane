# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 2 — Skeleton build (slice 4/7: WS hub); Scenes spec revisions after DM gate (#120–124)

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Skeleton build | build-skeleton (`w17:p2`) | `w17` / `build/skeleton` | working (client slices) | — |
| Revise assets-pipeline | spec-assets-pipeline (`w19:p2`) | `w19` / `spec/assets-pipeline` | working | — |
| Revise entities | spec-entities (`w1A:p2`) | `w1A` / `spec/entities` | working | — |
| Revise play-shell | spec-play-shell (`w1B:p2`) | `w1B` / `spec/play-shell` | working | — |
| Revise scenes-map | — | — | queued | slot |

## Pending integrator notes for the skeleton builder (next stop)

- Player REST credential, if any, must not share the DM's `Authorization: Bearer` scheme (unknown link token must not count toward the DM login throttle).

## Risks

- Skeleton owns every shared file; no other `build/*` until it merges (AGENTS §9.9).
- Scenes needs a live-sync change (signal stamping / scene filter) after the skeleton merges.

## Resolved locally (report at gate)

- Foundation consolidation conflicts CON-01–17 (#118). Skeleton deps approved (#119).
- Rejected a reviewer's request to read another worktree (out of brief).
