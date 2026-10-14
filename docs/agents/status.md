# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** playtest feedback pass (MVP polish). Specs complete and merged (#172, `4c45af3`); builds per [protocol §30](../protocol/README.md#30-playtest-pass-to-build). Work list: [feedback-playtest](feedback-playtest.md).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Playtest pass builds (P1–P5, G1–G12, ADR-0033, test flakes) | — | — | **All merged** (#173–#175; `e29e704`) | — |
| Session-sim regression on final `main` | `main` (tab `wR` regress, port 4113) | `test-session-3` | **Running** | Then **pause: recap + plan with the DM** |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-13-evening)). Briefs `briefs\build-*.md`; spec summary `spec-playtest.md`. Evidence: `verify-*\` (… layout, f9, polish, party-loot, *-fb feature walkthroughs, session-sim-2, crash, mvp-acceptance).

## Shared-file locks

- None.

## Pending DM decisions

- **DM: after the playtest pass merges, pause and recap together** (what was built, what's next, plan the way forward). Don't start new work beyond the pass.
- Recap agenda item 1: promote "add combatants mid-fight" (summons, reinforcements) from tier A to S? Combat build proceeds as specced (tier A) meanwhile.

## Resolved locally (report at gate)

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
