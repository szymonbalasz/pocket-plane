# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 1 — revision round after DM gate ([gate-phase1](gate-phase1.md))

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)).

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Revise live-sync | spec-live-sync (`w0:p2`) | `w0` / `spec/live-sync` | working | — |
| Revise campaign-management | spec-campaign-management (`w11:p2`) | `w11` / `spec/campaign-management` | working | — |
| Revise fixtures-adapters | spec-fixtures-adapters (`w12:p2`) | `w12` / `spec/fixtures-adapters` | working | — |
| Revise build conventions | spec-conventions (`wW:p4`) | `wW` / `spec/build-conventions` | working | — |

Next: re-check → merge → DM sets complete → number proposed ADRs, glossary → consolidation → Phase 2.

## Risks

- None open. (Claude auth refreshed by DM.)

## Resolved locally (report at gate)

- Decisions log #36 annotated as superseded by #55/#76; spec index regrouped by build phase (#107).
- Orchestrator builder brief: event-log order matches ADR-0016.
- Worktrees accidentally created in another repo (missing `--workspace`); removed, branches deleted, no changes there. Prompt §3 now requires `--workspace`.
