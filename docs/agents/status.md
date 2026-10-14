# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** MVP done (#176). **Sprint 1 (post-MVP) spec phase running** (#177): [sprint-1](sprint-1.md): tracks P polish R1–R5, D combat depth (CBTX), S player-owned sheets (CHARX), all in parallel. Specs written, D/S seam settled, reviewed (review-sprint1, fixes applied). **Waiting on the DM spec gate** (`%TEMP%\pocket-plane\gate-sprint1.md`).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| P: polish R1–R5 spec revisions | `spec/polish-r` (ws w22) | spec-polish-r | In review, fixes applied | DM gate |
| D: combat depth, `combat-extras` (CBTX) | `spec/combat-extras` (ws w23) | spec-combat-extras | In review, fixes applied | DM gate |
| S: player-owned sheets, `character-sheet-full` (CHARX) | `spec/character-sheet-full` (ws w24) | spec-character-sheet-full | In review, fixes applied | DM gate |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- None.

## Pending DM decisions

- Sprint-1 spec gate: G1–G7 + scope + bulk picks, in `%TEMP%\pocket-plane\gate-sprint1.md` (input staged in `.verify/review-sprint1/`).

## Resolved locally (report at gate)

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
