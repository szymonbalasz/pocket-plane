# Orchestrator status

Scratch, overwritten as things change. Not history ([orchestrator prompt §4](orchestrator-prompt.md#4-context-management)).

**Phase:** 3 built + fixes merged (#153). Feedback specs complete + merged (#154, #155). Now: party-loot walkthrough → merge → `fix/feedback-core` → feedback builds (plan: protocol §28).

**Herdr:** orchestrator workspace `wR`. Agents: `--kind claude -- --permission-mode auto` (+ `--strict-mcp-config` except test agents).

| Task | Branch / worktree | Agent | State | Next |
|---|---|---|---|---|
| party-loot | `build/party-loot` (slot 4) | `build-party-loot` + `test-party-loot` | walkthrough running | merge (protocol §28 clash: party-loot section → §29) |
| Play-shell feedback (alert, sound, FR-SHELL-28) | `build/play-shell-feedback` (slot 0) | `build-play-shell-fb` | building | walkthrough → merge |
| `fix/feedback-core` (4 columns, events, token-overlays.ts, per-kind cap) | — | — | waits for party-loot merge (schema lock) | then entities ∥ scenes-map → character-sheet → combat-tracker |
| Phase 4 hardening (crash-recovery pass) | — | — | not started | after feedback builds + party-loot (DM go) |
| Phase 5 MVP acceptance | — | — | not started | — |

Evidence archived: `%TEMP%\opencode\verify-*\` (… layout, f9, polish).

## Shared-file locks

- play-shell frame files (`PlayFrame.tsx`, `ShellContext.tsx`, `test-windows.tsx`, top bar) + `GameLog.tsx` → `build/play-shell-feedback`.
- `src/server/db/` (loot_entry), `src/shared/events/` (loot events), party-loot rows in data-model + protocol → `build/party-loot`. Feedback core waits and rebases.

## Pending DM decisions

- None.

## Resolved locally (report at gate)

- Integrator picks #142–#144 (badge, snapshot ceilings, registry-driven shell tests, reconnect probe 204, lazy Konva, window layout).
- DM secret kept in browser storage (`pocket-plane.dmSecret`) — check against campaign-management in Phase 4.
- Feedback spec pass runs as **one** agent across five specs (F3, F7 span several).
- FR-MAP-22 wording for #145 edited on `main` by the integrator.
- Physical-dice popover gets a one-off "Roll for me" action (F9 polish).
- Server start ~10 s was mathjs via the dice library (#151), not load; fixed by `fix/dice-engine`.
