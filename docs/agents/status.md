# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 4 hardening (DM go #162). Feedback pass merged (#145–#161); session-sim regression 12/12.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Playtest polish (regression glitches 1-11 + #161 follow-ups + map-first layout #162) | `fix/playtest-polish` (slot 0) | `build-playtest-polish` | building (holds play-shell frame + window registrations lock) | walkthrough → merge |
| Phase 4 audit (crash safety per command, DM secret, snapshot sizes, crash walkthrough plan) | `main` (read-only) | `review-hardening` | running | → `fix/hardening` + crash walkthroughs |
| Phase 5 MVP acceptance | — | — | not started | after Phase 4; then DM playtest |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish, party-loot).

## Shared-file locks

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
