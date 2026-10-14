# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** playtest feedback pass **done** (#171–#176, `main` @ `e29e704`+docs). **Paused for a recap + planning session with the DM** before any new work.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Playtest pass builds (P1–P5, G1–G12, ADR-0033, test flakes) | — | — | **All merged** (#173–#175; `e29e704`) | — |
| Session-sim regression on final `main` | — | — | **PASS 9/9** + reload, reconnect, leak scan, identical digest across a hard kill; 9 usability glitches ranked (evidence `verify-session-sim-3`) | Recap with the DM |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-13-evening)). Briefs `briefs\build-*.md`; spec summary `spec-playtest.md`. Evidence: `verify-*\` (… layout, f9, polish, party-loot, *-fb feature walkthroughs, session-sim-2, crash, mvp-acceptance).

## Shared-file locks

- None.

## Pending DM decisions

- **Recap + plan with the DM (now).** Agenda: (1) mid-fight add (summons, reinforcements) tier A → S?; (2) regression glitches R1–R9 (session-sim-3 report): which to fix; (3) what's next: second table playtest vs post-MVP (fog of war first; compendium; tier A backlog).

## Resolved locally (report at gate)

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
