# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** Sprint 1 complete (#186). **Sprint 2 planned, not started** (#187, #188): [sprint-2](sprint-2.md). Phase 1 = DM playtest notes + glitches (Q, P2a, P2b, M), then phase 2 = F fog of war + B props / structure. Next: phase 1 spec agents + `fix/asset-cache`.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Q: token art cache bug (N2) | `fix/asset-cache` | — | Not started | Builder (root cause first) |
| P2a: combat notes + glitches | `spec/polish-2a` | — | Not started | Spec agent |
| P2b: sheet + shell notes + glitches | `spec/polish-2b` | — | Not started | Spec agent |
| M: effect modifiers (N9) | `spec/effect-modifiers` | — | Not started | Spec agent |
| F: fog of war (phase 2) | `spec/fog-of-war` | — | After phase 1 | — |
| B: props + structure (phase 2) | `spec/scene-tools` | — | After phase 1 | — |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-14-evening)). Briefs in `briefs\`. Evidence: `verify-*\` (session-sim-3 evidence only in the main checkout: `.verify/20261014-131140-session-sim-3/`; the `%TEMP%` copy was cleared).

## Shared-file locks

- None.

## Pending DM decisions

- None now. At DM gate 1: N1 (minimise), N9 / M scope and timing, G2 (map size when fitting), plus every other pick.

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
