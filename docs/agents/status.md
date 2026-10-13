# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** DM feedback pass fully built and merged (#145–#161). Now: session-sim regression on `main`, then the Phase 4 gate.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Session-sim regression (all features) | `main` (slot 1, port 4113) | `test-session-2` | running | follow-up `fix/*` for glitches → DM gate for Phase 4 |
| Follow-ups (#161: form test IDs, pending toast over Encounters close, Save submenu hover) | — | — | queued | one `fix/*` with the regression findings |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | needs DM go |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish, party-loot).

## Shared-file locks

- None.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
