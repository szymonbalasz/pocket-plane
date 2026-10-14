# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** playtest feedback pass (MVP polish). Specs complete and merged (#172, `4c45af3`); builds per [protocol §30](../protocol/README.md#30-playtest-pass-to-build). Work list: [feedback-playtest](feedback-playtest.md).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| P1 tooltip delay | — | — | **Merged** `85cf681` (walkthrough PASS after a focus-return fix; evidence `verify-tooltip-delay`) | — |
| ADR-0033 signal audience | — | — | **Merged** `36f0bf6` (738 tests) | — |
| Scenes-map (P2, P3, G1) | — | — | **Merged** `efbae2e` (walkthrough PASS; evidence `verify-scenes-map-playtest`) | — |
| Combat + sheet + dice (P4, P5, G4–G9, G12) | `build/combat-playtest` (ws `w10`, slot 2) | `build-combat-playtest` | **Building** (not the initiative-window defaultSize line) | Walkthrough → merge → session-sim regression → **pause, recap with DM** |
| Glitches (G2, G3, G10, G11) | `fix/playtest-glitches` (ws `w1Z`, slot 0) | `build-playtest-glitches` | **Building** | Walkthrough play-shell 15, 15b, 16 → merge |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-13-evening)). Briefs `briefs\build-*.md`; spec summary `spec-playtest.md`. Evidence: `verify-*\` (… layout, f9, polish, party-loot, *-fb feature walkthroughs, session-sim-2, crash, mvp-acceptance).

## Shared-file locks

- Play-shell frame (`geometry.ts`, `ShellWindow.tsx`, `storage.ts`, `manager.ts`), `src/shared/play-shell/layout.ts` (WindowState `area`, granted on request), `src/client/dm/features/play-shell/DmPlayPage.tsx` (PresenceBadge only, granted), `src/client/common/sync/{store,connection}.ts`, combat DM `initiative-window.tsx` defaultSize line (combat build branches after this merges) → `fix/playtest-glitches`

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
