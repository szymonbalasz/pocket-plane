# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** playtest feedback pass (MVP polish). Specs complete and merged (#172, `4c45af3`); builds per [protocol §30](../protocol/README.md#30-playtest-pass-to-build). Work list: [feedback-playtest](feedback-playtest.md).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| P1 tooltip delay | `fix/tooltip-delay` (ws `w1W`, slot 0) | `build-tooltip-delay` | **Building** | Walkthrough play-shell 16, char-sheet 11 → merge |
| ADR-0033 signal audience | `fix/signal-audience` (ws `w1X`, slot 2) | `build-signal-audience` | **Building** | Merge → `build/scenes-map-playtest` |
| Scenes-map (P2, P3, G1) | — | — | Waits on `fix/signal-audience` | |
| Combat + sheet + dice (P4, P5, G4–G9) | — | — | Waits on tooltip + scenes-map | |
| Glitches (G2, G3, G10, G11) | — | — | Waits on tooltip | |

Helpers in [`tools/`](tools/); scratch + evidence archive in `%TEMP%\pocket-plane\` ([continue-session §1](continue-session.md#1-where-we-are-2026-10-13-evening)). Briefs `briefs\build-*.md`; spec summary `spec-playtest.md`. Evidence: `verify-*\` (… layout, f9, polish, party-loot, *-fb feature walkthroughs, session-sim-2, crash, mvp-acceptance).

## Shared-file locks

- `src/client/common/components/ui/overlays.tsx` (+ `menus.tsx` / `controls.tsx` if needed), `src/client/{dm,player}/main.tsx` → `fix/tooltip-delay`
- `src/server/ws/signals.ts`, `src/server/ws/hub.ts` → `fix/signal-audience`

## Pending DM decisions

- None. (Playtest spec gate passed, #172.)

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
