# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 2 — Skeleton verification (3 walkthroughs); Scenes specs complete + consolidated

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge.

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Skeleton build | build-skeleton (`w17:p2`) | `w17` / `build/skeleton` | 7 slices done; check, build, e2e green | walkthroughs |
| Walkthrough campaign-management §13 | test-campaign-management (`w17:p3`) | in `build/skeleton`, port 4103, `data/verify-camp` | working | — |
| Walkthrough live-sync §13 | test-live-sync (`w17:p4`) | port 4104, `data/verify-sync`, test mode | working | — |
| Walkthrough fixtures-adapters §13 | test-fixtures-adapters (`w17:p5`) | port 4105, `data/verify-fix` | working | — |

Next: fix failures (build-skeleton) → merge skeleton → DM demo → `fix/scenes-core` (ADR-0026 signals, CON-22 scene filter on live events, CON-23 active-scene hook, CON-24/25 doc cleanup) → Scenes builders in order: play-shell → assets-pipeline → entities → scenes-map.

## Risks

- CON-22 (scene-scoped records leaking to players on inactive scenes) must land before scenes-map builds.
- Orchestrator session must be restarted to load Playwright MCP itself (sub-agents get it on start).

## Resolved locally (report at gate)

- Playwright MCP in repo `opencode.json` (#128); skeleton builder picks (#129).
- CON-26: ADR links broken by my renumbering script, fixed.
