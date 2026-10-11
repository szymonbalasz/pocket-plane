---
title: Scenes and map
prefix: MAP
status: unclaimed
owner: —
wave: 3
---

# Scenes and map

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- MVP: a **town scene** and a **battlemap scene**; DM switches between them ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- react-konva canvas ([ADR-0001](../architecture/adr/0001-tech-stack.md)); state survives crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- Fog, AoE props, hidden tokens → [scene-tools](post-mvp/scene-tools.md). Location ↔ scenes → [world-builder](post-mvp/world-builder.md).

## 2. Scope

- Map image per scene (via [assets-pipeline](assets-pipeline.md)).
- Grid calibration.
- Pan/zoom.
- Tokens bound to entities (and combatants during combat).
- Snap to grid; token sizes (Large/Huge span squares); token labels.
- DM moves/controls any token and can reassign token ownership; player moves own.
- Lock map/background.
- Ruler with 5e diagonals.
- Ping (flash a spot for all); DM can pull everyone's view to it.
- Laser pointer: right-click drag on empty canvas (right-click on a token is reserved for its menu), Owlbear-style, visible to all.
- Measured movement along drag path *(tier B — MVP timing open, [feature tiers](../feature-tiers.md))*.
- See [feature tiers](../feature-tiers.md#1-map-and-tokens) for ranking.
- Active scene: DM switches; all players follow.
- **Scene list** with folders; duplicate a scene (tier S).
- **DM undo/redo** (strict LIFO) of DM token moves and scene edits ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Players don't undo; they move the token back.
- Preparing a non-active scene while players see another is tier A — likely near-free given active-scene model.
- Create/edit scenes in UI *(proposed; fixtures may be enough)*.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- Fog, AoE props, hidden tokens (→ [scene-tools](post-mvp/scene-tools.md)).
- Linking scenes to locations (→ [world-builder](post-mvp/world-builder.md)).
- Lighting, freehand drawing, touch ([ADR-0007](../architecture/adr/0007-product-scope.md)).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-MAP-NN.

## 7. UI/UX notes

> TODO (spec phase): canvas layout, DM toolbar (scene switcher, tokens, ruler, grid), player toolbar (ruler). Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): scene, grid, token. Relations to asset, entity, combatant. Active scene per campaign.

## 9. API & events

> TODO (spec phase). Visibility rule per event (inactive scenes, scene switch).

## 10. Permissions

> TODO (spec phase): player moves own token only (server ownership check).

## 11. Edge cases & failure modes

> TODO (spec phase): drag during disconnect, scene switch while player loading, crash mid-drag, very large map images.

## 12. Performance & bandwidth

> TODO (spec phase): drag event rate/coalescing, map image size over DM upload.

## 13. Test plan

> TODO (spec phase): fixtures `town` and `battlemap` scenes with tokens for `player-1` and `enemy-1`. Ruler/diagonal unit tests. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [assets-pipeline](assets-pipeline.md) | Map/token images | open |
| [entities](entities.md) | Token → entity binding | open |
| [combat-tracker](combat-tracker.md) | Token ↔ combatant binding | open |
| [live-sync](live-sync.md) | Events, snapshot on scene switch | open |
| [fixtures-adapters](fixtures-adapters.md) | Scene fixtures | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-MAP-01 | 5e diagonal rule | **5 ft per square (PHB default)**; 5/10/5 as campaign setting later / 5/10/5 only | yes | — |
| OQ-MAP-02 | Token ownership: who counts as "own"? | **Tokens bound to the player's character** / explicit owner list | yes | character-sheet |
| OQ-MAP-03 | Are tokens per scene, or does a character's token follow across scenes? | **Per scene (town token and battlemap token are separate)** / one token moves between scenes | yes | combat-tracker |
| OQ-MAP-04 | Live drag broadcasts vs drop-only | **Drop-only in MVP** / throttled live preview | no | live-sync |
| OQ-MAP-05 | Is the ruler visible to others? | **Local only in MVP** / broadcast | no | live-sync |
| OQ-MAP-09 | Movement model | **Owlbear-style free drag, snaps to grid on drop; no speed/turn enforcement; distance shown while dragging** / strict (speed limits, turn-gated, path rules) | yes | combat-tracker |
| OQ-MAP-10 | Can players move their token outside their turn in combat? | **Yes (table etiquette, not enforced)** / own turn only | no | combat-tracker |
| OQ-MAP-07 | Ping/laser are ephemeral: persisted or broadcast-only? | **Broadcast-only, not persisted (exception to ADR-0006 for transient pointers)** / persisted | yes | live-sync |
| OQ-MAP-08 | DM "pull view": forced or suggested? | **Forced recentre, player can pan away after** / suggestion toast | no | notifications |
| OQ-MAP-06 | Scene creation in UI or fixtures only? | **Upload map + calibrate grid in UI; tokens by drag from entity list** / fixtures only | no | fixtures-adapters |

## 16. Out of scope

- See §4 Non-goals.
