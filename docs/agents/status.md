# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 4 done (hardening #163–#164, crash walkthrough 12/12 #166). Next: Phase 5 MVP acceptance (DM gate).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Reconnect toasts (FR-NOTE-15 after reconnect; REST "Failed to fetch" wording) | `fix/reconnect-toasts` (slot 0) | `build-reconnect-toasts` | building | merge |
| Phase 5 MVP acceptance | — | — | waiting for DM go | fresh `test-mvp`: full session simulation + crash test; then DM playtest |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish, party-loot, *-fb feature walkthroughs, session-sim-2, crash).

## Shared-file locks


## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
