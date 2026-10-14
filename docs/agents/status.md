# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 1 (post-MVP, #177). **Spec gate passed (#178, all picks)**; specs merged, ADRs 0034–0036 accepted. **Build phase** per #179 order.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| P R1 map fit | `fix/polish-map-fit` | build-polish-map-fit | Starting | Walkthrough MAP 12 |
| P R3 game log | `fix/polish-game-log` | build-polish-game-log | Starting | Walkthrough DICE 12 |
| P R2/R4/R5 combat | `fix/polish-combat` | — | Waits for map-fit (noteAppearance) | Before any D build |
| S core (schema, entities, events) | `fix/charx-core` | build-charx-core | Starting | Then `fix/cbtx-core` |
| D core | `fix/cbtx-core` | — | Waits for charx-core + polish-combat | — |
| S build / D build / S combat routes | — | — | Queued (#179 order) | — |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- None.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
