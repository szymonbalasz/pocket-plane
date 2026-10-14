# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 1 (post-MVP, #177). **Spec gate passed (#178, all picks)**; specs merged, ADRs 0034–0036 accepted. **Build phase** per #179 order.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| P R1 map fit | — | — | **Merged** (walkthrough 23/23) | — |
| S core | — | — | **Merged** (core, no walkthrough) | — |
| P R3 game log | `fix/polish-game-log` (ws w26, slot 2) | build-polish-game-log | Fixed FR-DICE-21 after walkthrough FAIL; retest running (test-game-log-2) | Merge |
| P R2/R4/R5 combat | `fix/polish-combat` (ws w28, slot 4) | build-polish-combat | Building | Walkthrough CBT 3/8/9a/9b/14, NOTE 12 |
| D core | `fix/cbtx-core` (ws w29, slot 0) | build-cbtx-core | Building | Merge, then D + S builds |
| S build / D build / S combat routes | — | — | Queued (#179 order) | — |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- `fix/polish-combat`: notifications server files (`kind.ts`, `helpers.ts`, `index.ts`), combat-tracker server `attack.ts` / `hp.ts` / `lifecycle.ts` / `card-kind.ts`, `@shared/combat-tracker/log-kinds.ts`.
- `fix/cbtx-core`: `src/server/db/`, `src/shared/events/`, `src/shared/entities/`, entities `records.ts`, `@shared/combat-tracker/schemas.ts`, scenes-map overlay files (`token-overlays.ts`, `decorations.ts`, `layers/TokensLayer.tsx`), snapshot-size files.

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
