# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 1 — final DM gate (approve conventions, set foundation specs complete)

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)).

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| live-sync, campaign-management, fixtures-adapters | — (ended) | revision 2 on `main`; consistency pass on `spec/build-conventions` | in-review, 0 blocking OQs | DM: complete |
| Build conventions (AGENTS.md §9) + glossary | — (ended) | `spec/build-conventions` (`wW`, unmerged) | revised, cross-checked | DM: approve |
| Proposed ADRs ×4 | — | same branch | decisions filled in | DM: accept → I number 0019–0022 |

Next on "go": merge `spec/build-conventions` → number ADRs → specs `complete` → `review-consolidate` (data model + protocol) → Phase 2 skeleton (`build/skeleton`), and start Scenes specs in parallel.

## Risks

- Claude token refresh rate limit interrupted 3 agents once; resumed fine.

## Resolved locally (report at gate)

- Decisions log #36 annotated; spec index by build phase (#107); builder brief event order; `--workspace` rule after a wrong-repo mix-up.
- 30-item cross-spec consistency pass (timings, FR refs, fixture compositions, stale deps, glossary: 13 terms added, 3 reworded).
- Gate defaults logged as #114.
