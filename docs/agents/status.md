# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** feedback builds. Merged: fixes (#153), party-loot (#156), feedback-core (#157), entities + play-shell (#158), character-sheet + scenes-map (#159). Left: combat-tracker feedback, polish, session-sim regression.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Combat-tracker feedback (multi-target, undo per apply, overlays, movedFt, turn alert, rollAbility, shims) | `build/combat-tracker-feedback` (slot 0) | `build-combat-fb` | building | walkthrough → merge → session-sim regression |
| Polish (AssetPicker submit, alert toast style, loot Move empty state) | `fix/polish` (slot 2) | `build-polish` | building | merge |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | after feedback + session-sim regression (DM go) |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish, party-loot).

## Shared-file locks

- `AlertLayer.tsx` / `ShellContext.tsx` (toast styling) → `fix/polish`.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
