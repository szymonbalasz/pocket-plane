---
title: Play shell
prefix: SHELL
status: unclaimed
owner: —
wave: 2
---

# Play shell

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The one play page (Roll20-style): scene canvas as the base, **floating windows** over it ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- Replaces the DM's six-window setup ([vision](../vision.md#the-table-today)).
- Hosts every feature's UI as a window; features don't own pages.

## 2. Scope

- Landing: player opens their link → play page on the **active scene**; "waiting for DM" if none.
- DM client and player client shells (two clients, [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)).
- Floating windows: open, close, move, resize, bring to front, minimise.
- Window registry: features register window types (character sheet, initiative, game log, notifications, party loot, encounter builder…).
- **Per-player persisted layout/preferences** (which windows open, position, size).
- Launcher (toolbar / bottom bar) to open windows.
- Connection state indicator ([live-sync](live-sync.md)).
- **Later (tiered):** pause/intermission screen (A), keyboard shortcuts (B), DM "view as player" (C) — [feature tiers](../feature-tiers.md#5-dm-tools). (token → notes), multiple windows of one type (several NPC notes), **command palette** (Obsidian / VS Code style: search everything + run commands; tier A–B).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- BG2 styling, portrait strip (→ [theme-system](post-mvp/theme-system.md); tiers in [feature tiers](../feature-tiers.md#3-character-sheet-and-dice)).
- Mobile/touch layouts ([ADR-0007](../architecture/adr/0007-product-scope.md)).
- Popping windows out into separate browser windows.

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-SHELL-NN.

## 7. UI/UX notes

> TODO (spec phase): window chrome, launcher placement, default layouts for DM and player. shadcn primitives per [visual-direction](../design/visual-direction.md); BG2 "bottom action bar" motif is a candidate for the launcher later.

## 8. Data model

> TODO (spec phase): layout preference per player (and DM): window type, instance key, position, size, open/minimised. Server-persisted vs browser-local is OQ-SHELL-01.

## 9. API & events

> TODO (spec phase). Layout changes are private to the owner (visibility rule).

## 10. Permissions

> TODO (spec phase): which window types exist in the player client.

## 11. Edge cases & failure modes

> TODO (spec phase): window off-screen after resolution change, saved layout references a removed window type, reconnect restores layout, same player on two browsers.

## 12. Performance & bandwidth

> TODO (spec phase): canvas stays smooth with N windows open.

## 13. Test plan

> TODO (spec phase): fixture `session-sim`; E2E: player lands on active scene, opens sheet, reload restores layout. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Snapshot, connection state | open |
| [campaign-management](campaign-management.md) | Player identity for preferences | open |
| [scenes-map](scenes-map.md) | Canvas as base layer | open |
| All window-providing specs | Their window contents | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SHELL-01 | Where is layout persisted? | **Server, per player (survives browser switch)** / browser localStorage | yes | live-sync |
| OQ-SHELL-02 | Can the DM push a window to players (e.g. open initiative for all on combat start)? | **Yes, as a suggestion players can close** / no | no | combat-tracker, notifications |
| OQ-SHELL-03 | Docked panels as well as floating? | **Floating only in MVP** / dock to edges | no | — |

## 16. Out of scope

- See §4 Non-goals.
