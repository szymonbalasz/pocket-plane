# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 5 accepted: playtest ready (#169). Waiting for the DM playtest.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Phase 5 MVP acceptance | `main` | — | **PLAYTEST READY** (#169) | DM playtest ([playtest-mvp](playtest-mvp.md)); glitches G1–G12 → one `fix/*` (DM's call: before or after the playtest) |

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
