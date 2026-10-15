# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 1 complete (#186). **Sprint 2 planned, not started** (#187): [sprint-2](sprint-2.md): P2 glitch polish, F fog of war (FOG), B props + structure (SCN), all in parallel. Next: spec phase, three spec agents.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| P2: glitch polish (session-sim-4) | `spec/polish-2` | — | Not started | Spec agent |
| F: fog of war, `fog-of-war` (FOG) | `spec/fog-of-war` | — | Not started | Spec agent |
| B: props + structure, `scene-tools` (SCN) | `spec/scene-tools` | — | Not started | Spec agent |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- None.

## Pending DM decisions

- None now. At the sprint-2 spec gate: F / B scope, picks, P2 G2 (map size when fitting).

## Resolved locally (report at gate)

- Sprint 1: CON-44 headroom is tight (heavy DM snapshot 746 KB vs 768 KiB after cbtx-core). D build: snapshot only active effects; never raise a ceiling without a look.
- Sprint 1 nit (not a FAIL): Notifications window opens ~250 px tall vs spec §7 360×480 (test-polish-notes).

- Known flake: `snapshot-size.test.ts` (CON-44) fails with SQLITE_BUSY when several worktrees run the suite at once; passes alone and on re-run. Builders re-run before treating it as real.

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
