# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 4 hardening (DM go #162). Feedback pass merged (#145–#161); session-sim regression 12/12.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Playtest polish (regression glitches + #161 follow-ups + map-first layout #162) | `fix/playtest-polish` (slot 0) | `test-playtest-polish` | walkthrough running | merge |
| Phase 4 hardening fixes (#163) | `fix/hardening` (slot 2) | `build-hardening` | building (holds server core, db, ws, commands, config lock) | merge → crash walkthrough (12 steps, audit §5) |
| Phase 5 MVP acceptance | — | — | not started | after Phase 4; then DM playtest |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish, party-loot).

## Shared-file locks

- `src/server/{config.ts,server.ts,commands,events,ws,db}/` + items in #163 → `fix/hardening`.
- play-shell frame files, window registrations (`src/client/{dm,player}/windows.ts` + feature window defs), protocol §24 → `fix/playtest-polish`.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
