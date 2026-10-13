# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** feedback builds (#157). Merged: fixes (#153), party-loot (#156), feedback-core (#157). Plan: protocol §28.

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| Play-shell feedback (alert, sound, FR-SHELL-28) | `build/play-shell-feedback` (slot 0) | `test-play-shell-fb` | walkthrough running | merge |
| Entities feedback (speed, scores, saves, tokenShape, down, fixtures) | `build/entities-feedback` (slot 2) | `build-entities-fb` | building | walkthrough → merge (before character-sheet) |
| Scenes-map feedback (selection, box, overlays, shape, speed, movement label, ADR-0031 hooks) | `build/scenes-map-feedback` (slot 3) | `build-scenes-map-fb` | building | walkthrough → merge |
| Character-sheet feedback (speed, checks + saves, FR-CBT-45 route) | `build/character-sheet-feedback` (slot 4) | `build-char-sheet-fb` | building | merge after entities → walkthrough |
| Combat-tracker feedback | — | — | waits for play-shell, scenes-map, character-sheet | then session-sim regression |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | after feedback builds + party-loot (DM go) |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish, party-loot).

## Shared-file locks

- play-shell frame files (`PlayFrame.tsx`, `ShellContext.tsx`, `test-windows.tsx`, top bar) + `GameLog.tsx` → `build/play-shell-feedback`.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
