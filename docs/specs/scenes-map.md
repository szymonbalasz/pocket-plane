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

- Replaces Owlbear Rodeo. react-konva canvas ([ADR-0001](../architecture/adr/0001-tech-stack.md)).
- Scenes: map image + grid + tokens + fog + AoE props.
- DM controls what players see; state survives crash ([ADR-0006](../architecture/adr/0006-persistence.md)).

## 2. Scope

- Map upload (via [assets-pipeline](assets-pipeline.md)).
- Grid calibration.
- Pan/zoom.
- Tokens bound to entities and combatants.
- DM moves any token; player moves own.
- Ruler with 5e diagonals.
- Polygon fog.
- Hidden tokens.
- AoE props.
- Asset preload with player-ready indicator.
- Active scene selection (what players see). *(proposed)*

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-MAP-NN.

## 7. UI/UX notes

> TODO (spec phase): canvas layout, DM toolbar (fog, tokens, props, ruler), player toolbar, ready indicator, scene switcher. DM vs player view (DM sees fog as translucent?). Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): scene, grid, token, fog region (polygon JSON leaf), AoE prop. Relations to asset, entity, combatant.

## 9. API & events

> TODO (spec phase). Visibility rule per event (hidden tokens, fogged tokens, inactive scenes).

## 10. Permissions

> TODO (spec phase): player moves own token only (server ownership check).

## 11. Edge cases & failure modes

> TODO (spec phase): drag during disconnect, DM switches scene while player loading, token under fog, crash mid-drag, very large maps.

## 12. Performance & bandwidth

> TODO (spec phase): drag event rate/coalescing, map image sizes, preload strategy over DM upload.

## 13. Test plan

> TODO (spec phase): fixture scene (map image, grid, tokens, fog). Ruler/diagonal unit tests. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [assets-pipeline](assets-pipeline.md) | Map/token images, preload | open |
| [entities](entities.md) | Token → entity binding | open |
| [combat-tracker](combat-tracker.md) | Token ↔ combatant binding | open |
| [live-sync](live-sync.md) | Visibility filter, reveal semantics | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-MAP-01 | 5e diagonal rule | **5 ft per square (PHB default), DMG 5/10/5 as campaign setting** / 5/10/5 only | yes | — |
| OQ-MAP-02 | Fog default for new scene | **Fully fogged; DM reveals** / fully clear | no | — |
| OQ-MAP-03 | Is a token under fog hidden from players automatically? | **Yes, filtered server-side** / only if flagged hidden | yes | live-sync |
| OQ-MAP-04 | Token ownership: who counts as "own"? | **Tokens bound to the player's character** / explicit per-token owner list | yes | character-sheet |
| OQ-MAP-05 | Do players see the active scene only, or can DM push different scenes to different players? | **Single active scene for all players** / per-player | no | live-sync |
| OQ-MAP-06 | AoE prop shapes and who can place them | **Cone, sphere, cube, line, cylinder; DM and players** / DM only | no | — |
| OQ-MAP-07 | Does the ready indicator block scene reveal? | **No, informational only** / DM can wait-for-all | no | assets-pipeline |
| OQ-MAP-08 | Live drag broadcasts vs drop-only | **Throttled live drag preview, commit on drop** / drop only | no | live-sync |

## 16. Out of scope

- Dynamic lighting / vision, freehand drawing, touch ([ADR-0007](../architecture/adr/0007-product-scope.md)).
- Region maps → [world-builder-deep](post-mvp/world-builder-deep.md).
