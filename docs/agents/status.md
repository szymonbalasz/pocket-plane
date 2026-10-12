# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3 starting. Skeleton gate passed (#132). `fix/scenes-core` building; Combat specs being written.

**Herdr:** orchestrator workspace `wR` (pane `wR:p1`). Always `herdr worktree create --workspace wR …` ([prompt §3](orchestrator-prompt.md#3-herdr)). Clean up worktrees after merge. Test agents get a dedicated server pane (AGENTS §9.6).

| Task | Agent | Workspace / branch | State | Blockers |
|---|---|---|---|---|
| `fix/scenes-core` (ADR-0026 signals, CON-22 scene filter on live events, CON-23 active-scene hook, CON-18–33 doc cleanup, reconnect cap 1.5 s #131) | `build-scenes-core` (`wS:p2`) | `wS`, `fix/scenes-core`, slot 0 | building | — |
| Spec character-sheet | `spec-character-sheet` (`wT:p2`) | `wT`, `spec/character-sheet` | writing | — |
| Spec dice-roll-log | `spec-dice-roll-log` (`wV:p3`) | `wV`, `spec/dice-roll-log` | writing | — |
| Spec notifications | `spec-notifications` (`wW:p2`) | `wW`, `spec/notifications` | writing | — |
| Spec combat-tracker | — | — | queued | free agent slot (cap 4) |
| Scenes builds: play-shell → assets-pipeline → entities → scenes-map | — | — | queued | `fix/scenes-core` merge |

Walkthrough evidence archived outside the repo: `%TEMP%\opencode\verify-skeleton\`.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Walkthrough fixes: clean-exit lock removal (server now runs as a supervised child), favicon, `not_found` for records the caller can't see, reconnect on focus/online, `.playwright-mcp/` ignored.
- Test-agent servers run in Herdr panes (agent shells hang on Windows) — AGENTS §9.6.
- `fix/scenes-core` also gets the doc fixes CON-18–32 (specs wording, data-model, protocol, AGENTS §9.3 CON-19 row) as assigned paths.
