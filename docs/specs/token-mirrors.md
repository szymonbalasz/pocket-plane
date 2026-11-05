---
title: Token mirrors
prefix: MIR
status: complete
owner: build-token-mirrors
phase: post-mvp
---

# Token mirrors

> Five-minute read. Decided by the DM in conversation, 2026-10-31 / 11-01 ([ADR-0077](../architecture/adr/0077-token-mirrors.md)).

## 1. Summary

- A battle on several floors is **one map**: the DM lays the floors side by side in an image editor, walls keep them apart, and Teleport moves tokens between them.
- A **mirror** shows a token in a second place on that map: a yard goblin also appears around the roof, for whoever stands on the roof.
- A mirror is display only. It has no sight, no HP, no combat row, and nothing can target it.

## 2. Scope

- Create, drag, delete a mirror; as many per token as the DM wants.
- Four display modes per mirror: Hidden, Visible, Transparent, Shadow.
- A mirror follows its token's moves, name, art and size.
- Larger map images, so a sheet of floors stays sharp ([FR-ASSET-02, -05](assets-pipeline.md#6-functional-requirements)).

## 3. Goals

- Players see what they could see from where they stand, without the app modelling height.
- The DM stays in control with one small menu; no new geometry, no levels model.

## 4. Non-goals

- Levels or elevation as data. The server doesn't know what a floor is.
- Automatic hiding when a token walks indoors: the DM sets Hidden by hand (it's rare).
- Height in rulers, or spell templates that reach across floors: the DM rules on those.
- Moving a player's camera after a teleport.

## 5. User stories

**DM**
- As the DM, I want a goblin in the yard to show on the roof area, so the roof player sees it without me narrating.
- As the DM, I want an enemy upstairs to show faintly to the party below, or as a shape they can't identify, as I judge fit.

**Player**
- As a player on the roof, I want to see the yard's creatures around me, on my own part of the map.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-MIR-01 | The DM's token menu has **Mirror**: the Teleport cell pick (hint panel, target footprint), then `mir.create {tokenId, col, row, mode?}` on the token's scene. Mode defaults to Visible. Players have no entry and the intent refuses them. | FR-MAP-121 |
| FR-MIR-02 | Any number of mirrors per token, up to the cap. | |
| FR-MIR-03 | A mirror's footprint must overlap the map when placed; off the map → `invalid`. | |
| FR-MIR-04 | A mirror does nothing: never a vision source, combatant, target, or selectable token, and players can't move it. It is not a `token` row, so token code never meets it. | |
| FR-MIR-05 | ≤ 200 per scene and ≤ 2,000 per campaign → `conflict`. | Props' caps |
| FR-MIR-06 | **Modes.** Hidden: no player. Visible (a normal look), Transparent and Shadow: only players whose sight reaches the mirror's cells (walls and fog apply, per player, party vision included). The modes differ in look only. *(Amended 2026-11-05, [#443](../decisions-log.md): Transparent and Shadow used to ignore walls and fog.)* | §7 |
| FR-MIR-07 | A player's copy never carries the source token's id, `seenBy`, `fogged`, `suppressed` or the campaign. A Shadow also carries no name, art or creature type. | Checked on snapshot and live |
| FR-MIR-08 | When the token moves, each mirror moves by the same step, in the same transaction and event. Name, art, creature type, size and shape follow it. A mirror moves on the drop, not during a drag. | Token-changed hook |
| FR-MIR-09 | While the token is hidden or Invisible, or the mirror has no cell on the map, no player gets it (`suppressed`), and it returns by itself when that ends. Its mode is unchanged. A mirror is otherwise independent of whether players see the token. | Stops a mirror giving away a hidden enemy |
| FR-MIR-10 | A **teleport** of the token sets its mirrors to Hidden and leaves them where they are: the old distance means nothing after a jump. The DM drags them and picks a mode again. | FR-MAP-121 |
| FR-MIR-11 | Deleting a token, or its scene, deletes its mirrors. | |
| FR-MIR-12 | With the Select tool the DM drags a mirror to a new cell (`mir.move`); its distance to the token is whatever that leaves. | |
| FR-MIR-13 | The menu's Delete removes the mirror only (`mir.delete`). | |
| FR-MIR-14 | A scene copy keeps its mirrors, on the copied tokens. | FR-MAP-04 |
| FR-MIR-15 | Drawn under the tokens, in the Konva objects layer (above fog). See §7. | |
| FR-MIR-16 | The DM's right-click on a mirror opens its menu: Visible, Transparent, Shadow, Hidden (the current one marked and off), Delete mirror. A token on the same cell keeps its own menu. | FR-MAP-71 step 4 |

## 7. UI/UX notes

Reference [visual-direction](../design/visual-direction.md). Uses the token's art, the canvas colours and the shadcn menu; nothing new but the shadow's black.

| Mode | Player sees | DM sees |
|---|---|---|
| Visible | The token's art, full strength, name pill | The same + dashed outline + `Mirror · Goblin · Visible` |
| Shown, no player has sight (#443) | Nothing | As its mode + `· Fog`, e.g. `Mirror · Goblin · Transparent · Fog` |
| Transparent | Art at 45 %, name pill | The same + outline + `Mirror · Goblin · Transparent` |
| Shadow | A dark shape at 60 %, the token's size and shape, no name | The same + outline + `Mirror · Goblin · Shadow` |
| Hidden | Nothing | Art at 30 % + outline + `Mirror · Goblin · Hidden` |
| Held back (FR-MIR-09) | Nothing | Art at 30 % + outline + `Mirror · Goblin · Hidden with its token` |

- **Disconnected:** menu items disabled, drag off (the Select tool needs `live`).
- **Empty:** no mirrors, no change anywhere.
- The "DM-only items" Layers switch off hides mirrors no player can see, like hidden tokens.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| TokenMirror | id, campaignId, sceneId, tokenId | ids | Goes with its token and scene |
| | seq | int | Drawing order |
| | col, row | int | Top-left; may be off the map after a step (FR-MIR-09) |
| | mode | `hidden` \| `visible` \| `transparent` \| `shadow` | |
| | name, imageAssetId, creatureType, size, shape | copies | Of the token, so visibility reads only the record ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md)) |
| | suppressed | bool, derived | Token hidden or Invisible, or off the map |
| | fogged, seenBy | derived | Fog subject at its own cells; `seenBy` never on a wire |

## 9. Sync

| Intent (DM only) | Event | Logged |
|---|---|---|
| `mir.create {tokenId, col, row, mode?}` → `{mirrorId}` | `MirrorCreated` | yes |
| `mir.move {mirrorId, col, row}` | `MirrorMoved` | yes |
| `mir.setMode {mirrorId, mode}` | `MirrorModeSet` | yes |
| `mir.delete {mirrorId}` | `MirrorDeleted` | yes |

- Record type `token-mirror`, scope `scene`, `dmWindow: "active-scene"`. **Visibility:** the DM all (no `seenBy`); a player per FR-MIR-06, -07, -09, active scene only.
- A followed mirror's change joins the token's own event.

## 10. Permissions

- Every intent DM only. Players only ever read.

## 11. Disconnect, reconnect, crash

- Reconnect: the snapshot holds the stored state; live and fresh copies are equal (tested).
- Crash: a mirror writes in its command's transaction, so it never separates from its token's move.

## 12. Performance

- A move costs one row per mirror of that token. Sight is one more fog subject per mirror (cheap; not separately benchmarked). A player's copy is about 150 B, so the 200 cap is about 30 KB at worst.

## 13. Test plan

- **Fixtures:** `mir-goblin`. **Bundle:** `token-mirrors`.
- **Server:** `token-mirrors.test.ts`, real socket, DM + two players, one named test per requirement.
- **Browser:** `e2e/token-mirrors.e2e.ts`. **Walkthrough:** `fixtures:reset-load token-mirrors --profile verify`; the fixture's mirror starts out of sight (`· Fog`, nothing for the player) and shows once dragged into sight; mirror Mira, switch modes with a player window open, drag it, teleport the token and see it go Hidden.
- Runs isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)).

## 14. Dependencies

- Scenes-map (token hooks, cell pick, scene copy), fog (scene re-derive), assets-pipeline (limits).

## 15. Open questions

None. ~~Decided by the DM: Transparent and Shadow show to every player, also one who pans to that part of the map ("fog of war is enough control").~~ Reversed by the DM 2026-11-05 ([#443](../decisions-log.md)): every shown mode is foggable.
