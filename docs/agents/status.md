# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 2 — Skeleton merged; **DM gate: run the skeleton** ([demo-skeleton](demo-skeleton.md))

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6).

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| Skeleton (Foundation build) | — (ended) | merged to `main` (`f0592c1`) | check 96 tests, build, e2e green; walkthroughs 8/8, 9/9, 15/15 | DM run |
| `fix/scenes-core` (ADR-0026 signals, CON-22 scene filter on live events, CON-23 active-scene hook, CON-18–33 doc cleanup, reconnect cap 1.5 s #131) | — | — | queued | DM gate |
| Scenes builds: play-shell → assets-pipeline → entities → scenes-map | — | — | queued | `fix/scenes-core` |
| Combat specs (character-sheet, dice-roll-log, notifications, combat-tracker) | — | — | queued | DM go |

Walkthrough evidence archived outside the repo: `%TEMP%\opencode\verify-skeleton\`.

## Pending DM decisions

- None (reconnect cap decided, #131; built in `fix/scenes-core`).

## Resolved locally (report at gate)

- Walkthrough fixes: clean-exit lock removal (server now runs as a supervised child), favicon, `not_found` for records the caller can't see, reconnect on focus/online, `.playwright-mcp/` ignored.
- Test-agent servers run in Herdr panes (agent shells hang on Windows) — AGENTS §9.6.
