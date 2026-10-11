# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 1 — waiting on DM gate ([gate-phase1](gate-phase1.md))

| Task | Agent | Worktree / branch | State | Blockers |
|---|---|---|---|---|
| Spec live-sync | — (ended) | merged to `main` | in-review, reviewed | DM D1, D4 |
| Spec campaign-management | — (ended) | merged to `main` | in-review, reviewed | DM D1, D2, D4 |
| Spec fixtures-adapters | — (ended) | merged to `main` | in-review, reviewed | DM D4 |
| Build conventions (AGENTS.md §9) | — (ended) | `spec/build-conventions` (wW, unmerged) | reviewed | DM D3 |

Next: revision agents apply decisions + review findings → DM sets complete → consolidation → Phase 2.

## Risks

- `opencode-claude-auth: Proactive token refresh failed` shown in sub-agent panes; may need `claude` re-auth before long build runs.

## Resolved locally (report at gate)

- Decisions log #36 annotated as superseded by #55/#76; spec index regrouped by build phase (#107).
- Orchestrator builder brief: event-log order matches ADR-0016.
