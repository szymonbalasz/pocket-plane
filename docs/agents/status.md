# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** playtest feedback pass (MVP polish). P1–P5 tier S confirmed (#171); spec revisions running. Work list: [feedback-playtest](feedback-playtest.md).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Playtest spec pass (P1–P5, G-verdicts) | `spec/playtest-feedback` | `spec-playtest` | **Finalising** (gate #172: ADR-0033, P4 amended, picks accepted) | Specs `complete` + data-model/protocol consolidated → merge → `fix/tooltip-delay`, `fix/signal-audience` |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-13-evening)). Brief: `briefs\spec-playtest.md`; summary will be `spec-playtest.md`. Evidence: `verify-*\` (… layout, f9, polish, party-loot, *-fb feature walkthroughs, session-sim-2, crash, mvp-acceptance).

## Shared-file locks


## Pending DM decisions

- None. (Playtest spec gate passed, #172.)

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
