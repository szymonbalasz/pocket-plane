---
title: Scenes and map
prefix: MAP
status: in-review
owner: spec-scenes-map
wave: 3
---

# Scenes and map

## 1. Summary

- A **scene** is a map image, a grid and tokens on a react-konva canvas ([ADR-0001](../architecture/adr/0001-tech-stack.md)): the base layer of the play page ([play-shell](play-shell.md)). The DM preps scenes in the UI and can view any scene (#122); players see the one **active scene**.
- **Tokens** are instances of a creature definition ([ADR-0009](../architecture/adr/0009-entity-content-model.md)). Players never see monster definitions (#120), so a token carries its display name (instance state) and read-only copies of image and size, refreshed inside the definition edit's transaction ([FR-ENT-19](entities.md#6-functional-requirements)).
- **Feedback pass** (#145, #148; FR-MAP-31–38): token shape; speed copy + drag movement indicator; DM selection with Ctrl/Shift-click and box select, exposed to features (combat targeting); a token overlay registry for other features' token decorations (combat: out, down, target).

## 2. Scope

- MVP = tier S ([feature tiers §1, §7](../feature-tiers.md#1-map-and-tokens)) plus background prep (#122). **Scene list** window: folders, create (name + map from [assets-pipeline](assets-pipeline.md)), rename, move to a folder, duplicate, delete *(proposed)*. "Show to players" activates a scene; players follow it.
- **Map and grid:** set the map; grid calibration (cell size, offset; visible, colour, opacity) with live preview; lock map; pan/zoom.
- **Tokens:** drop from the Creatures window ([entities](entities.md)); snap on drop; Large+ span several cells; labels. Owlbear-style free drag: DM moves any token, a player moves own tokens any time. Ctrl-D duplicate + rename; token art from uploads; hide/reveal; DM reassigns owner; delete. **Tools:** ruler (local), ping + DM pull view, laser pointer (right-drag off a token).
- **Feedback pass (tier S):** token shape round / square / none; movement indicator while dragging (vs speed; in combat vs movement used this turn); DM selection (click, Ctrl/Shift-click, box) + selection / targeting API for features; token overlay registry.

## 3. Goals

- The DM preps the town and the battlemap (upload, calibrate, place, hide) entirely in the UI, while players watch another scene. Later layers and token windows plug in without changing scene or token code.
- **Zero leakage:** no player frame reveals a hidden token, a non-active scene, a folder, a scene name or a monster definition id; image IDs reach players only on records they see ([FR-ASSET-12](assets-pipeline.md#6-functional-requirements)). A drop reaches other clients ≤ 1 s after commit *(proposed)*. Positions, hidden flags and the active scene survive a hard kill ([ADR-0006](../architecture/adr/0006-persistence.md)).

## 4. Non-goals

- Fog, AoE props, layers UI, walls, HP rings, condition icons (→ [scene-tools](post-mvp/scene-tools.md)); current-turn highlight, path measurement, keyboard shortcuts other than Ctrl-D (tier B); token art library (tier A); location ↔ scene ([world-builder](post-mvp/world-builder.md)).
- Per-token size or stat editing (#120); live drag preview, shared ruler, ~~multi-select~~ (selection + box select are in, #148), rotation, lighting, freehand, touch ([ADR-0007](../architecture/adr/0007-product-scope.md)); undo ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)); server-side signal rate limit (post-MVP).
- Group move of a selection, dragging images / props onto the map (tier A, #148); movement blocking or server speed checks (indicators only, #145); player selection or targeting (#134).

## 5. User stories

- **DM:** As the DM, I want to prep the battlemap with enemies hidden while players are still in town, reveal them with one click, and pull everyone's view to a spot, so that the ambush lands.
- **Player:** As a player, I want to land on the map, drag my own token, measure, ping and laser-point, so that I can play my turn and show what I mean.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-MAP-01 | DM creates a scene `{name, mapAssetId, folderId?}`: name trimmed, 1–60 chars, no control chars, not unique; map via `assets.require`, its `display` size copied onto the scene. Grid defaults *(proposed, OQ-MAP-20)*: 70 px, offset 0, visible, `#000000`, 0.5. Unlocked, **inactive**. | |
| FR-MAP-02 | *(proposed, OQ-MAP-19)* Folders: create, rename (1–40 chars), delete; one level. Folder delete moves its scenes to the root in the same transaction. List order: folders, then scenes, each by name (case-insensitive), tiebreak `seq`. | |
| FR-MAP-03 | DM renames a scene or moves it into a folder / to the root. | |
| FR-MAP-04 | Duplicate → new inactive scene "‹name› (copy)" (cut to 60) in the same folder, same map, grid, lock; every token copied with all fields, new IDs and `seq`. One transaction, one event. | |
| FR-MAP-05 | *(proposed, OQ-MAP-19)* DM deletes a non-active scene (active → `conflict`); its tokens go with it. Each token first runs the token-changed hooks (FR-MAP-30): a hook may refuse (combat: token bound to a running encounter → `conflict`, nothing deleted) or rewrite referencing rows (combat: `tokenId` → null); rewritten rows are in the event's `changes`. | ADR-0028, combat-tracker (§14) |
| FR-MAP-06 | `map.activateScene`: ≤ 1 active scene per campaign (`Scene.active` + partial unique index *(proposed, OQ-MAP-18)*); one transaction flips both flags. After commit, before listeners run, the active-scene cache is updated; then every player connection of the campaign is resynced ([FR-SYNC-11](live-sync.md#6-functional-requirements)). Token visibility changes from activation reach players via that snapshot (ADR-0021 C), not via `changes`. | |
| FR-MAP-07 | Creating a scene never activates it. No active scene → player base layer = play-shell's empty state ([FR-SHELL-02](play-shell.md#6-functional-requirements)). | |
| FR-MAP-08 | The DM canvas shows the DM's **viewed scene** (#122): any scene in its snapshot, picked in the Scenes window; client-only. Default: the active scene; none active → first scene in list order; no scenes → shell empty state. While viewed ≠ active, a badge reads "Not shown to players" and ping, pull and laser are off. | |
| FR-MAP-09 | `map.setSceneMap {sceneId, mapAssetId}` replaces the map and its stored size; tokens keep their cells. | |
| FR-MAP-10 | `map.setGrid {sceneId, cellSize, offsetX, offsetY, visible, color, opacity}`: cellSize 8–512 (2 decimals); 0 ≤ offset < cellSize; `#rrggbb`; opacity 0.1–1. Edits preview locally (inputs, ±1 / ±0.1 nudges); Save sends one intent, Cancel restores. Grid space = map `display` px *(proposed, OQ-MAP-15)*. | |
| FR-MAP-11 | `map.setLocked {sceneId, locked}`. Locked: DM map and grid controls disabled; `setSceneMap` / `setGrid` → `conflict`. | |
| FR-MAP-12 | Pan/zoom per client, never sent. Wheel zooms about the pointer, 10–400 % *(proposed, OQ-MAP-20)*. Left-drag on empty canvas, or on a token the user can't move, pans (DM Ctrl/Shift + drag on empty canvas box-selects instead, FR-MAP-32). Opening a scene fits the map to the viewport. | |
| FR-MAP-13 | Place (DM): the canvas accepts an HTML5 drop, MIME `application/x-pp-definition`, data `{definitionId}` ([FR-ENT-18](entities.md#6-functional-requirements), FR-SHELL-13); the pointer cell becomes the footprint's top-left. Sends `map.placeToken {sceneId, definitionId, col, row}`; definition via `resolveDefinition` ([FR-ENT-12](entities.md#6-functional-requirements)). Sets name = definition name, numbered (FR-MAP-16); image = portrait or none; size = `statBlock.size`; shape = definition `tokenShape`, else `round` (FR-MAP-35); speed = `statBlock.speed`, else null (FR-MAP-36); owner = the character's owner, else none (#124); visible. Optional `name, imageAssetId, ownerPlayerId, hidden, shape` (fixtures); never size or speed. | |
| FR-MAP-14 | Position = top-left cell (`col`, `row`), integers. Footprint: tiny/small/medium 1×1, large 2×2, huge 3×3, gargantuan 4×4. Valid iff the footprint overlaps the map rectangle, else `invalid`. ≤ 200 tokens per scene, ≤ 1,000 per campaign *(proposed, OQ-MAP-20)*, else `conflict`. | |
| FR-MAP-15 | Move *(proposed, OQ-MAP-04: drop-only)*: while dragging, the token follows the pointer and shows the target cell and distance (FR-MAP-22; movement indicator FR-MAP-37); nothing is sent. On drop `col = round((left − offsetX) / cellSize)` for the token's top-left corner, same for `row`; one `map.moveToken {tokenId, col, row}`. **Optimistic:** the new position is an overlay, cleared on that intent's `ack` / `reject` or any snapshot; events update the state underneath (server wins); `reject` → revert + Toast. | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) E |
| FR-MAP-16 | Token name: trimmed, 1–40 chars, no control chars; instance state, never changed by a definition edit. Base `B` = name minus a trailing ` <N>`. On place and duplicate, if the scene has tokens named `B` (counts as 1) or `B N`, the new name is `B <max N + 1>`, else unchanged; `B` cut so the result ≤ 40. Every token a client sees shows its name as a label below it. | "Goblin" → "Goblin 2" |
| FR-MAP-17 | Ctrl-D (DM, canvas focused, exactly one token selected, FR-MAP-31): `map.duplicateToken` → same definition, image, size, shape, speed, owner, hidden flag; numbered name; at `col + footprint` same row if valid, else `col − footprint`, else the source cell. The copy is selected. Browser shortcut suppressed; keys inside windows never trigger it ([FR-SHELL-13](play-shell.md#6-functional-requirements)). | |
| FR-MAP-18 | Token menu (DM, right-click a token): rename, image (asset picker; `assets.require`), shape (Round / Square / None, FR-MAP-35), owner (a player of the campaign or none, #124), hide/reveal, duplicate, delete (no confirm). No size entry (#120). | `map.updateToken`, `map.deleteToken`; hooks FR-MAP-30 |
| FR-MAP-19 | Hide/reveal (`map.setTokenHidden`, menu). DM sees a hidden token with `visibility.hidden` styling + eye-off icon; players get a `delete` ≤ 1 s. Reveal sends players an `upsert`, so the token's image ID reaches them then (FR-ASSET-12). | Hooks FR-MAP-30 |
| FR-MAP-20 | Definition-changed hook (FR-ENT-19), registered by scenes-map, runs inside `entities.update`'s transaction: every token of that definition gets the new `statBlock.size` and `statBlock.speed` (FR-MAP-36) if they changed; `tokenShape` never propagates (FR-MAP-35); if the portrait changed, tokens whose image is the old portrait get the new one *(proposed, OQ-MAP-14)*. Names untouched. Changed tokens are returned as record changes and land in `EntityUpdated.changes`. Cells kept, even if a larger footprint overhangs the map. Runs no token-changed hooks (FR-MAP-30): instances bound to these tokens follow via their own definition-changed hook (combat: [FR-CBT-06](combat-tracker.md#6-functional-requirements)). | #120, ADR-0016, ADR-0028 |
| FR-MAP-21 | A player may move a token iff `ownerPlayerId = ctx.playerId`, it is not hidden and is on the active scene. Token the player can't see → `not_found` (as unknown); visible but not theirs → `forbidden`. Every other `map.*` intent and route is DM only. DM moves any token on any scene. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-MAP-22 | Ruler (both): drag cell to cell → line + distance `5 × (max(dx, dy) + floor(min(dx, dy) / 2))` ft with `dx = abs Δcol`, `dy = abs Δrow`: every second diagonal costs 10 ft (5/10/5, #145; supersedes #124). The drag label (FR-MAP-15) uses the same rule. Local only *(proposed, OQ-MAP-05)*; cleared on release. | |
| FR-MAP-23 | Ping tool (both): click sends `map.ping {sceneId, x, y}`; others show a 2 s pulse. DM Shift+click sends `map.pull {sceneId, x, y}`: pulse + player cameras centre on the point, zoom unchanged; players may pan away *(proposed, OQ-MAP-08)*. | |
| FR-MAP-24 | Laser (both): right-button drag starting off any token sends `map.laser {sceneId, points, end?}` (≤ 20 sends/s, ≤ 32 points each); others draw a trail fading 1 s after the last point. Right-click on a token: DM → menu; player → nothing. Browser context menu suppressed on the canvas. | |
| FR-MAP-25 | Signals ([ADR-0026](../architecture/adr/0026-signal-routing.md)): zod `x, y` finite, abs ≤ 16384; roles ping/laser DM + player, pull DM only. The hub forwards to every other connection of the campaign with a server-stamped `from {role, playerId?}`. A receiver draws a signal only if its `sceneId` is the scene it shows (player: active; DM: viewed). No DB, log, snapshot or `seq` ([FR-SYNC-22](live-sync.md#6-functional-requirements)). | |
| FR-MAP-26 | Visibility per §9: `scene` redacted for players *(proposed, OQ-MAP-17)*; `scene-folder` DM only; `token` hidden from players while `hidden`, else without `definitionId`, and without `speed` unless `ownerPlayerId = ctx.playerId` (FR-MAP-36). | Leak scan §13 |
| FR-MAP-27 | Every command commits row(s) + an event-log entry in one transaction, except `TokenMoved` (not logged). Nothing undoable. IDs and time only from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)); `seq` assigned by the DB at insert (insertion order, as the event log; CON-20). | |
| FR-MAP-28 | While not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)): drag, menus, grid, scene-list actions and signals disabled; pan, zoom, ruler, selection (FR-MAP-31/32) and switching the viewed scene still work. A drag in progress when the connection drops snaps back, unsent. | |
| FR-MAP-29 | Canvas layers come from an ordered client registry: map < grid < *(reserved: props, fog)* < tokens < pointers (ruler, ping, laser). Token menu entries and token double-click come from a client registry; in MVP scenes-map and combat-tracker (token menu, [FR-CBT-30](combat-tracker.md#6-functional-requirements)) register. Token decorations: FR-MAP-34. | Design for later; AGENTS §9.9 |
| FR-MAP-30 | Token-changed hooks: `map.updateToken`, `map.setTokenHidden`, `map.deleteToken` and scene delete (per token) run every registered hook `(env, before, after \| null) → RecordChange[]` in their own transaction; returned rows go into the event's `changes`; a hook error or reject (e.g. combat: token bound to a running encounter → `conflict`) rolls back the command. ~~Moves,~~ placement and duplicate run none; **moves: FR-MAP-38** (supersedes, pending the proposed ADR). No hook registered → no behaviour change. Server registry, append-only, created by this spec's build. | [ADR-0028](../architecture/adr/0028-token-changed-hooks.md), #134 |
| **Feedback pass** | | |
| FR-MAP-31 | **Selection** (DM, Select tool): a client-only set of token ids on the viewed scene, empty at start. Click a token → selection = that token; Ctrl- or Shift-click → toggle it; click empty canvas (pointer moved < 4 px) or Esc (canvas focused) → clear. Hidden tokens selectable. Changing the viewed scene clears it; ids that leave the store drop out; never persisted or sent. Every selected token shows the selection ring. A drag moves only the dragged token (group move: tier A). Players: no selection. | F7, F7.1 |
| FR-MAP-32 | **Box select** (DM, Select tool): Ctrl- or Shift- + left-drag starting on empty canvas draws a rectangle; on release every token whose footprint centre lies inside joins the selection (adds; clear first to replace) *(proposed, OQ-MAP-23)*. Plain left-drag still pans. < 4 px = a click; Esc mid-drag cancels. | F7.1 |
| FR-MAP-33 | **Selection API** (DM client, `@dm/features/scenes-map/selection`): `useMapSelection() → {sceneId, tokenIds}`, `setMapSelection(ids)`, `toggleMapSelection(id)`, `setTargeting(on)`. While targeting is on (combat's attack popup, [FR-CBT-33](combat-tracker.md#6-functional-requirements)): tool forced to Select (restored when off), crosshair cursor, token drag off; click, Ctrl/Shift-click and box still edit the selection; pan, zoom and the token menu work. | F7 |
| FR-MAP-34 | **Token overlays** (both clients): append-only registry `tokenOverlays` (`src/client/common/features/scenes-map/token-overlays.ts`, created empty by this build; OQ-MAP-26) of `{id, decorate?(token, store, view) → {dim?, badges?, ring?} \| null, movedFt?(token, store) → int \| null}`, `view = {client, selected, targeting}`. scenes-map draws results inside the token's group (they move with a drag), merged in registry order: `dim` → opacity × 0.5; `badges [{id, icon, tone, label}]` in a row on the footprint's bottom edge (Konva `name` = the badge's test id, `id` = token id); `ring: "target"` replaces the selection ring. Pure functions; a throw is logged once and ignored (token drawn plain). | F6, F7, F8 |
| FR-MAP-35 | **Token shape** `round` \| `square` \| `none`, default `round`; token-owned like the name (#126): set at placement from the definition's `tokenShape` ([FR-ENT-22](entities.md#6-functional-requirements)), copied by duplicate, never changed by a definition edit; the DM sets it in the token menu (`map.updateToken {shape}`). Draw: round = circular crop + ring (as built); square = image cover-fitted to the footprint, square border; none = image contain-fitted, alpha kept, no border or backdrop. Selection, target and hidden outlines follow the shape (none: square). No image: initials in a circle (round) or rounded square. | F4 |
| FR-MAP-36 | **Speed copy:** token `speed` (int \| null) = the definition's `statBlock.speed` ([FR-ENT-21](entities.md#6-functional-requirements)), written at place / duplicate and by FR-MAP-20, never per-token editable. Players receive it only on tokens they own (`ownerPlayerId = ctx.playerId`) *(proposed, OQ-MAP-24)*: a monster's speed is a stat (#120). | F3 |
| FR-MAP-37 | **Movement indicator** (DM, token owner; local only): while dragging token T, `move` = FR-MAP-22 distance from T's start cell to the target cell; `used` = first non-null `movedFt(T)` from FR-MAP-34 (combat: movement used this turn, [FR-CBT-39](combat-tracker.md#6-functional-requirements)), else 0 (outside combat this move alone counts). With `T.speed` known: total = used + move; ≤ speed normal; ≤ 2 × speed **amber** (dash); > 2 × speed **red**. Label "15 ft" (no speed), "15 / 30 ft" (outside combat), "move 15 · 35 / 30 ft" (in combat). Never blocks: the drop always sends (FR-MAP-15); the server checks no speed. | F3, #145 |
| FR-MAP-38 | **Move hooks:** `map.moveToken` also runs the token-changed hooks in its transaction ([ADR-0031](../architecture/adr/0031-token-move-hooks.md), amends ADR-0028; OQ-MAP-25); their rows go into `TokenMoved`'s `changes`; `TokenMoved` stays unlogged. A hook must not reject a move (indicators never block); a throw → `internal`, move rolled back, overlay reverts. Placement and duplicate still run none. | F3 |

## 7. UI/UX notes

- Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, map is the hero, semantic tokens only. Answers [OQ-SHELL-05](play-shell.md#15-open-questions): scenes-map exports the base-layer canvas (DM: viewed scene; player: active) and the tool-rail content; play-shell owns the empty state. Window `map.scenes`: DM only, open by default, top-left, default 300×480, min 240×240, launcher "Scenes". **Tool rail** (ToggleGroup + Tooltip): Select, Ruler, Ping (both); DM: Grid (Popover: number inputs with nudges, Switch, colour input, Slider, Save/Cancel), Lock, "Show to players" (when viewed ≠ active).
- **Scenes window:** collapsible folders; row = name, "Live" Badge on the active scene, DropdownMenu (rename, duplicate, move to…, delete). "New scene" Dialog: name + asset picker; "New folder". Clicking a row views the scene (FR-MAP-08). **Canvas:** grid drawn as one shape. Larger tokens below smaller, then by `seq`. No image → circle with initials. Drag: target cell highlighted, distance shown. Ping = expanding ring, laser = fading line, in a semantic accent token per role (names per [theme-system](post-mvp/theme-system.md)).
- **States:** empty = shell empty state; loading = image placeholder ([assets-pipeline §7](assets-pipeline.md#7-uiux-notes)); error = broken-image placeholder, grid and tokens still render; disconnected = FR-MAP-28 + live-sync banner. **DM view:** any scene, hidden tokens styled, menus, grid/lock, scene list. **Player view:** active scene, visible tokens, grab cursor on own tokens, ruler, ping, laser; no menus.
- **Feedback pass:** DM selection ring and box (`border.frame`-style accent), crosshair cursor while targeting. Movement label in the drag label's place, tone colours: normal = foreground, dash = `hp.bloodied`, over = `hp.down` (OQ-MAP-27). Token menu "Shape" submenu with a check on the current shape. **DM view:** selection, box, shapes, overlay badges, own and monster speed. **Player view:** shapes, overlay badges per the owning feature's visibility, movement label on own tokens.
- **Test IDs:** `map-canvas`, `map-tool-<select|ruler|ping|grid|lock>`, `map-show-to-players`, `map-not-shown-badge`, `map-scenes`, `map-scene-row` / `map-folder-row` + `data-record-id`, `map-scene-live`, `map-scene-menu-<rename|duplicate|move|delete>`, `map-scene-new`, `map-folder-new`, `map-grid-<cell|offset-x|offset-y|visible|color|opacity|save|cancel>`, `map-token-menu-<rename|image|shape|owner|hide|duplicate|delete>` (shape items `data-value`). Konva: name `map-token` (id = token id, attr `shape`), `map-token-ring` (attr `state` = `selected` \| `target`), `map-select-box`, `map-move-label` (attr `tone` = `none` \| `normal` \| `dash` \| `over`), `map-ping`, `map-laser`, `map-ruler-label`; overlay badges per FR-MAP-34.

## 8. Data model

No JSON leaf fields. All rows per campaign ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)); `seq` = monotonic insertion order per table, assigned by the DB (CON-20); timestamps from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Scene | id, campaignId, folderId, seq, name; mapAssetId; mapWidth, mapHeight | ID, ID → Campaign, ID → SceneFolder \| null, int, text 1–60; ID → Asset (**asset reference**); int ×2 | Map same campaign ([FR-ASSET-15](assets-pipeline.md#6-functional-requirements)); `display` px copied at set |
| | gridCellSize, gridOffsetX, gridOffsetY, gridVisible, gridColor, gridOpacity; mapLocked, active; createdAt, updatedAt | real ×3, bool, `#rrggbb`, real; bool ×2; timestamp ×2 | Display px; `active` partial unique per campaign |
| SceneFolder | id, campaignId, seq, name, createdAt, updatedAt | ID, ID, int, text 1–40, timestamp ×2 | One level |
| Token | id, campaignId, sceneId, definitionId, seq | ID, ID, ID → Scene (cascade), ID → Entity, int | Per scene (#124); definition global or same campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md)) |
| | name; imageAssetId; size; col, row, ownerPlayerId, hidden; createdAt, updatedAt | text 1–40; ID → Asset \| null (**asset reference**); tiny…gargantuan; int ×2, ID → Player \| null, bool; timestamp ×2 | Name = instance state. Image, size = display copies written at place / duplicate and by FR-MAP-20; size never per-token editable (#120). Top-left cell; one owner (#124) |
| | shape; speed | `round` \| `square` \| `none` (default `round`); int \| null | Shape = instance state (FR-MAP-35). Speed = display copy like size (FR-MAP-36); players: own tokens only |

- **Relations:** Campaign 1—* Scene, SceneFolder; SceneFolder 1—* Scene; Scene 1—* Token; Token → Entity (definition), Player (owner), Asset. Combatant → Token: [combat-tracker](combat-tracker.md). **Derived:** footprint (FR-MAP-14); cell → px = offset + index × cellSize; ruler distance; name suffix; movement total and tone (FR-MAP-37); active-scene cache (rebuilt at boot, [live-sync §8](live-sync.md#8-data-model)). Client only: camera, viewed scene, selection set + targeting flag (FR-MAP-31–33), ruler, move overlay. **Persisted runtime state:** token position, hidden, owner; `Scene.active`. Signals: none.

## 9. API & events

Envelopes, rejects, close codes: [live-sync](live-sync.md). Per ADR-0021 D, scene-list CRUD is REST; canvas actions are WS. **REST (Hono RPC), DM only** (prefix per [OQ-CAMP-15](campaign-management.md#15-open-questions)): `POST /api/scenes` (FR-MAP-01); `PATCH`, `DELETE /api/scenes/:id` (03, 05); `POST /api/scenes/:id/duplicate` (04); `POST /api/scene-folders`, `PATCH`, `DELETE /api/scene-folders/:id` (02). Campaign = `ctx.campaignId`, fixed at authentication ([FR-CAMP-11](campaign-management.md#6-functional-requirements)). POST `201 {scene | sceneFolder}`, PATCH `200`, DELETE `204`, duplicate `201 {scene}`. Errors `{code, message, issues?}` → 400/403/404/409 (protocol CON-09).

| WS intent (default DM only) | Who | Validation / ownership |
|---|---|---|
| `map.activateScene {sceneId}`; `map.setSceneMap` / `setGrid` / `setLocked` | DM | Scene in `ctx.campaignId`; FR-MAP-09–11; locked → `conflict` |
| `map.placeToken {sceneId, definitionId, col, row, name?, imageAssetId?, ownerPlayerId?, hidden?, shape?}` | DM | `resolveDefinition`, `assets.require`, owner ∈ campaign, FR-MAP-14 |
| `map.moveToken {tokenId, col, row}` | DM, player | FR-MAP-14, FR-MAP-21; runs token-changed hooks (FR-MAP-38). **Optimistic** |
| `map.updateToken {tokenId, name?, imageAssetId?, ownerPlayerId?, shape?}` / `setTokenHidden {tokenId, hidden}` / `duplicateToken {tokenId}` → `{tokenId}` / `deleteToken {tokenId}` | DM | Token in `ctx.campaignId` |

| Record type | Scope | Player visibility (DM always `full`) | Snapshot |
|---|---|---|---|
| `scene` | scene, `sceneOf = id` | Redacted to `{id, mapAssetId, mapWidth, mapHeight, grid*, active}` (no name, folder, lock, `seq`) | DM: all; player: active |
| `scene-folder` | campaign | Hidden | Campaign's folders |
| `token` | scene, `sceneOf = sceneId` | `hidden` → hidden; else all fields but `definitionId`, and `speed` only if `ownerPlayerId = ctx.playerId` | DM: all; player: active scene's |

**Signals** (FR-MAP-25; [ADR-0026](../architecture/adr/0026-signal-routing.md)): `map.ping {sceneId, x, y}` and `map.laser {sceneId, points [x, y][] ≤ 32, end?}` (DM, player); `map.pull {sceneId, x, y}` (DM). Visibility: every other connection of the campaign, with server-stamped `from`.

**Domain events** (FR-MAP-27; none transient or undoable)

| Event | Changes | Logged | After commit |
|---|---|---|---|
| `SceneCreated` / `Updated` / `Duplicated` / `Deleted`; `SceneFolderCreated` / `Renamed` / `Deleted` | `scene` / `scene-folder` upsert or delete; duplicate and delete include the scene's `token`s; folder delete the moved `scene`s; `SceneDeleted` + rows from token-changed hooks (FR-MAP-30) | yes | — |
| `SceneActivated {sceneId, previousSceneId}` | both `scene` upserts | yes | Cache updated by a commit hook, before listeners ([CON-23](../protocol/README.md#11-conflicts-log)); resync players |
| `TokenPlaced` / `Updated` / `Duplicated` / `Deleted` / `Hidden` / `Revealed` | `token` upsert / delete (players per [FR-SYNC-19](live-sync.md#6-functional-requirements)); `Updated` / `Deleted` / `Hidden` / `Revealed` + rows from token-changed hooks (FR-MAP-30; combat: `combatant`, `encounter`) | yes | — |
| `TokenMoved {tokenId, sceneId, col, row}` | `token` upsert + rows from token-changed hooks (FR-MAP-38; combat: `combatant` movement) | **no** | — |
| entities' `EntityUpdated` | + `token` upserts from FR-MAP-20 | yes (entities) | — |

Command → event (CON-31): `POST /api/scenes` → `SceneCreated`; `PATCH /api/scenes/:id` (rename, move), `map.setSceneMap`, `map.setGrid`, `map.setLocked` → `SceneUpdated`; duplicate → `SceneDuplicated`; `DELETE` → `SceneDeleted`; folder routes → `SceneFolderCreated` / `Renamed` / `Deleted`; `map.activateScene` → `SceneActivated`; `map.placeToken` → `TokenPlaced`; `map.updateToken` → `TokenUpdated`; `map.duplicateToken` → `TokenDuplicated`; `map.deleteToken` → `TokenDeleted`; `map.setTokenHidden` → `TokenHidden` (`hidden: true`) / `TokenRevealed` (`false`); `map.moveToken` → `TokenMoved`.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Scene list, map, grid, lock, activate; place / edit (incl. shape) / hide / duplicate / delete token | ✓ | ✗ | DM credential; default-DM intents |
| Select, box select, targeting | ✓ | ✗ | Client only; nothing sent |
| Move token | any, any scene | own, visible, active scene | FR-MAP-21 |
| Ping, laser / pull (pan, zoom, ruler: client only) | ✓ / ✓ | ✓ / ✗ | Signal roles (FR-MAP-25) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** last view + banner; a drag in progress snaps back unsent. Reconnect → snapshot; scene switched meanwhile → the player lands on the new scene. **DM disconnect / reconnect:** players unaffected. Viewed scene kept if it still exists, else FR-MAP-08 default. A campaign switch resets it.
- **Server crash mid-action:** uncommitted → no event, no `ack`; the overlay drops on the snapshot. Committed → in the snapshot. A definition edit and its token refresh commit together or not at all; so do a move and its hook rows (FR-MAP-38). Signals in flight are lost (accepted). Selection and targeting are client memory: a reload clears them; a reconnect snapshot keeps the selection minus ids no longer in the store.
- **Concurrent edits:** last commit wins (DM and player move one token; two DM tabs set the grid). Token hidden mid-drag → it disappears for the player; the move → `not_found`. Owner changed mid-drag → `forbidden`, revert. Scene deleted while another DM tab views it → FR-MAP-08 default. Character renamed or re-owned → tokens keep name and owner; the DM edits them. Recalibration or a size increase may leave tokens off the map: still rendered and draggable. **Scene switch while a player loads:** the resync replaces the store; stale image loads are dropped, a 404 for the old map is ignored.
- **Invalid / malicious input:** strict zod; IDs of another campaign → `not_found`; names rendered as text; spoofed `from` ignored (server stamps it); `shape` outside the enum → `invalid`; a player sending `speed` or `shape` anywhere → `invalid` (not in their schemas). Players see `cause TokenHidden` on a hide, so they can tell a token was hidden (accepted).
- **Feedback pass:** a selected token that is deleted or leaves the viewed scene drops out; one revealed or hidden stays selected (DM sees both). Speed edited mid-drag: the label uses the store value at render. Owner reassigned → that player gains or loses the token's `speed` with the upsert. Combat's `movedFt` arriving after a drop updates the next drag's label.

## 12. Performance & bandwidth

- Moves are drop-only: ≤ a few intents/s, ≤ 400 B per event. Laser ≤ 20 frames/s × ≤ 600 B per sender ≈ 72 KB/s fan-out to 6 players over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)). Map `display` ≤ 4096 px, 1–3 MB once per browser ([assets-pipeline §12](assets-pipeline.md#12-performance--bandwidth)).
- Feedback pass: overlay fns run per token per render (≤ 200 tokens, O(1) store lookups); box select is one pass over the scene's tokens; a move adds one indexed lookup per hook (combat: `combatant.tokenId`) and, in combat, one ≤ 300 B `combatant` upsert. Token +2 fields ≈ +20 B.
- Snapshot: token ≈ 300 B, scene ≈ 400 B; 30 scenes × 30 tokens ≈ 280 KB. Shared DM budget: scenes ≤ 300 KB of live-sync's 512 KB (1,000-token cap). Players get one scene. **Review check:** Chrome trace of a 10 s pan on Cellar (4096 px map, grid on): median frame ≤ 20 ms.

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:` DB, temp asset dir, port 0; walkthroughs on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests named after FRs. Canonical names: [fixtures-adapters §8](fixtures-adapters.md#8-data-model); images from `images` / `image-large` ([assets-pipeline §13](assets-pipeline.md#13-test-plan)); setups run as DM (FR-FIX-13).

| Key | Contents | Requires | `session-sim` |
|---|---|---|---|
| `town` | Scene "Town", map `town`, 70 px grid. Mira (`char-mira`, owner `player-1`, image `token-mira`) at (5, 5). Activated | `images`, `char-mira` | yes |
| `battlemap` | Scene "Goblin Ambush", map `battlemap` (20 × 14 at 70 px), inactive. Mira (2, 7); Goblin (`enemy-1`, `token-goblin`) (12, 6); **hidden**: Wolf (`enemy-2`, `token-wolf`) (14, 4), Elite Goblin Warrior (`enemy-custom`, `token-elite`) (15, 8) | `town`, `enemy-1`, `enemy-2`, `enemy-custom` | yes |
| `scenes-extras` *(new)* | Folder "Act 1" holding both scenes. Thorn (`char-thorn`, owner `player-2`) on Town (4, 5) and Goblin Ambush (2, 9). Custom monster "Cave Ogre" (`enemy-2`'s block, size large, speed 40, `tokenShape` none) on Goblin Ambush (9, 10), visible. Root scene "Cellar": `map-large`, cell 50, offset (25, 10), `#ffffff` 0.3, locked, Goblin (40, 27) | `battlemap`, `char-thorn`, `image-large` | no |

- **Bundle `scenes`** = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `enemy-2` + `enemy-custom` + `images` + `image-large` + `town` + `battlemap` + `scenes-extras`.
- **Leak strings** (player frames): "Elite Goblin Warrior", "Ambush", "Cellar", "Act 1", hidden tokens' IDs, `token-elite`'s asset ID (until step 6), every monster `definitionId`; "Wolf" and `token-wolf`'s ID only while revealed; after step 8 also "Act 2", "Tavern". **Leak property:** no `token` a player receives has `speed` unless that player owns it.

| Level | What | Fixtures |
|---|---|---|
| Unit | Distance (5/10/5); footprint; overlap validity; px ↔ cell with offset; drop rounding; numbering (FR-MAP-16 incl. "Goblin 2" → "Goblin 3", 40-char cut); grid bounds; visibility matrix (scene / folder / token × DM / owner / other player × hidden; `speed` owner-only); signal schemas; receiver scene filter; move overlay (`ack` keeps server position, `reject` reverts + Toast, snapshot drops it); list order with equal `createdAt`; layer registry with a test layer. **Feedback:** selection reducer (click, Ctrl/Shift toggle, empty click, Esc, scene change, dropped ids); box hit (centre inside, < 4 px = click, adds); overlay merge (order, throw ignored, first non-null `movedFt`); movement tone (= speed normal, +5 dash, = 2× dash, > 2× over, speed 0, no speed → none; in-combat `used`); shape fit per shape and initials shape | In-code |
| Integration (feedback) | Place copies `tokenShape` (Cave Ogre none, Goblin round) and speed; definition edit refreshes speed, never shape; `updateToken {shape}`; duplicate copies both. Move runs a test-registered hook: its rows in `TokenMoved.changes`, no log row, a throw rolls back; place / duplicate run none | `scenes` |
| Integration | Each command: rows + log + event, IDs from `ctx`; `TokenMoved` adds no log row; rollback → nothing. Ownership: `player-1` moves Mira ✓, Goblin `forbidden`, Wolf `not_found`. Owner reassignment. Hide/reveal → delete/upsert. Activate → after it each player store equals a fresh snapshot; second active impossible. Locked → `conflict`; delete active → `conflict`. Duplicate scene copies tokens + hidden flags. **Hook:** Cave Ogre large → huge resizes its token in the same commit, listed in `EntityUpdated.changes`; portrait change: tokens with the old portrait follow, custom art and names kept. **Token-changed hooks (FR-MAP-30)** with a test-registered hook: runs in `updateToken`, `setTokenHidden`, `deleteToken` and scene delete (per token), its rows in the event's `changes`; its throw rolls back the command; move, place, duplicate run none. Signals: ping reaches DM + `player-2`, not the sender, with `from`; player `map.pull` reaches nobody; no DB/log. Leak scan; restart → identical snapshots | `scenes` |
| E2E (thin) | Playwright, DM + `player-1`: player drags Mira, DM sees it; DM reveals Wolf; DM activates the battlemap; reload | `scenes` |

**Browser walkthrough.** `PP_TEST_MODE=1` (AGENTS §9.2); `bun run build`, `fixtures:reset-load scenes --profile verify`, `start --profile verify`. Contexts **A** DM, **B** `player-1`, **C** `player-2`. Evidence and teardown per AGENTS §9.6. Also runs [assets-pipeline walkthrough B](assets-pipeline.md#13-test-plan).

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | B, C open links | A: "Act 1" (Town *Live*, Goblin Ambush), Cellar; Town with Mira, Thorn labelled. B, C: same Town; no scene list or menus |
| 2 | — | B drags Mira 3 cells right; C drags Mira | B sees "15 ft" while dragging; A, C see Mira at (8, 5) ≤ 1 s. C's drag pans, sends nothing |
| 3 | View Goblin Ambush; then "Show to players" | — | First: "Not shown to players"; Wolf, Elite styled hidden; Cave Ogre 2 × 2; B, C still on Town. Then B, C switch: Mira, Thorn, Goblin, Cave Ogre; no Wolf, Elite or scene name |
| 4 | Reveal Wolf, then hide it | B ruler (2, 7) → (5, 9) | Wolf appears, then disappears for B, C ≤ 1 s. B reads "20 ft" (5/10/5, #145); A sees no ruler |
| 5 | Goblin's menu → Shape → Square. Shift+drag a box around Goblin and Cave Ogre; Ctrl+click Goblin; click empty canvas | B drags Mira from (2, 7): holds over (9, 7), then (15, 7); drops at (9, 7) | B, C: Goblin square, Cave Ogre uncropped (shape none from its definition). A: two selection rings, then Cave Ogre only, then none. B's label "35 / 30 ft" amber, then "65 / 30 ft" red; drop accepted, A, C see Mira at (9, 7). C's frames: `speed` only on Thorn |
| 6 | Select Goblin, Ctrl-D; rename copy "Goblin Chief", image `token-elite`; set Thorn's owner to Player 1 | B drags Thorn; C tries | "Goblin 2" at (13, 6), square (copied), then renamed with new art for B, C. B's Thorn move sticks; C's drag pans; B's frames now carry Thorn's `speed`, C's no longer |
| 7 | Ping tool: Shift+click a far corner; right-drag empty canvas; right-click Goblin | B: Ping click, then pans away; right-clicks Goblin | B, C recentre, see pulse and laser; A, C see B's ping; A gets the menu, no laser; B gets nothing |
| 8 | View Cellar: grid disabled; unlock, cell 50 → 52, Save. New folder "Act 2"; duplicate Goblin Ambush, move the copy to "Act 2"; new scene "Tavern" from an existing upload | — | Grid redraws while editing. Copy in Act 2 has all tokens (Wolf, Elite hidden; shapes kept), inactive; Tavern at root. B, C unaffected |
| 9 | Move Mira while B is dropped (Probes window "drop connection"); then reload all; hard-kill + restart | B back | B: banner, drag disabled, then Mira moved, no reload. All rejoin; Goblin Ambush live; steps 2–8 intact (shapes, owners); Wolf hidden. Throughout: no leak string in B, C frames; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | `scene` scope gate (`sceneOf(record)` at registration, CON-22), commit hook for the active-scene cache (CON-23), resync on activation, optimistic intents; signal routing ([ADR-0026](../architecture/adr/0026-signal-routing.md)) | complete; ADR accepted (#125); built in fix/scenes-core |
| [assets-pipeline](assets-pipeline.md) | `assets.require`, asset-reference fields, picker, `useAssetImage`, `display` size; OQ-ASSET-07 answered by OQ-MAP-15 | in-review |
| [entities](entities.md) | `resolveDefinition`, drag payload (FR-ENT-18), `statBlock.size`, portrait, definition-changed hooks (FR-ENT-19; registry per OQ-ENT-14), `entities.create` for Cave Ogre. [ADR-0024](../architecture/adr/0024-definition-visibility.md) refines ADR-0009: token holds name, image and size copies, owner (#120) | in-review; ADR decided |
| [play-shell](play-shell.md) | Base layer + tool-rail slot (FR-SHELL-01 order), window `map.scenes`, empty state, key routing + window drops (FR-SHELL-13) | in-review |
| [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | `player` records for the owner picker; `town`, `battlemap` as §13; add `scenes-extras` + bundle `scenes` to FIX §8 at merge (integrator) | complete |
| [combat-tracker](combat-tracker.md) | Combatant → token; token-changed hook ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)): copies name / image / hidden, token bound to a running encounter → `conflict` on delete (#124, #134); token menu entries (FR-MAP-29); ~~the DM picks card targets in combat's popup, no click-select change (#134)~~ → the popup preselects the map selection (FR-MAP-33, #148; still DM only). Feedback: overlay lines (out, down, target ring, `movedFt`) and the move hook ([FR-CBT-37–39](combat-tracker.md#6-functional-requirements)) | in-review |
| [entities](entities.md) (feedback) | `statBlock.speed`, `tokenShape` ([FR-ENT-21/22](entities.md#6-functional-requirements)) | in-review |

**Shared changes** (feedback pass; the consolidation agent writes data-model / protocol; builders report `shared change needed:` per AGENTS §9.9):
- `src/server/db/` — `token.shape` text not null default `round`; `token.speed` int null.
- Token visibility fn (record-type registry line, scenes-map's): strip `speed` unless owner. Intent zod (`@shared/scenes-map`): `shape?` on `map.placeToken` / `map.updateToken`.
- Token-changed hooks run in `map.moveToken` (`src/server/features/scenes-map/`) — needs the [ADR-0031](../architecture/adr/0031-token-move-hooks.md) accepted. `src/shared/events/scenes-map.ts`: payloads unchanged.
- New append-only client registry `src/client/common/features/scenes-map/token-overlays.ts` (created empty here; add to AGENTS §9.9, OQ-MAP-26). Selection API `@dm/features/scenes-map/selection` (scenes-map's file, not a registry).
- Docs: protocol §12 (token row), §13 (`shape?`), §16 (`TokenMoved` changes), §18 / §26 (registry), §25 (hooks on move); data model §12 (token columns); glossary (OQ-MAP-28); FIX §8 `scenes-extras` (Cave Ogre speed + shape). F2 (5/10/5) is already decided and ships as `fix/diagonal-rule`.

## 15. Open questions

**Bold** option = suggested pick unless the row says Decided.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-MAP-01, 02, 03~~ | ~~Diagonal rule; token owner; tokens per scene~~ | **Decided (#124):** ~~5 ft per diagonal square~~ → 5/10/5 diagonals (#145); one `ownerPlayerId` per token, defaulted from the character's owner, DM reassigns; tokens per scene, combatant-on-token-delete rule owned by combat-tracker | — | — |
| OQ-MAP-04, 05, 12, 15, 18 | Spec-local picks | **Drop-only moves + local ruler; numeric grid calibration with nudges (box tool later); grid in `display` px (answers OQ-ASSET-07); `Scene.active` + partial unique index (mirrors `Campaign.active`)** / live drag preview; shared ruler; box tool now; original px + scale; `Campaign.activeSceneId` | no · owner: spec-scenes-map | live-sync, assets-pipeline, campaign-management |
| OQ-MAP-08, 17, 19, 20 | DM product picks: pull; player-visible scene fields; scene list extras; numbers and gestures | **08: forced recentre, player can pan away** / suggestion Toast. **17: redacted, no name, folder, lock** (names spoil) / full. **19: delete non-active scenes; one folder level; folder delete → root** / no delete / nested. **20: 1 s, 200 tokens/scene, 1,000/campaign, 20 laser sends/s, zoom 10–400 %, grid defaults, Shift+click pull** / DM sets | no · owner: DM | notifications, play-shell |
| ~~OQ-MAP-13~~ | ~~DM views non-active scenes?~~ | **Decided (#122):** yes, client-only viewed scene (FR-MAP-08); integrator amends ADR-0014's deferred row | — | — |
| OQ-MAP-14 | Token image after a portrait edit (size always follows, #120) | **Tokens still showing the old portrait follow; custom art kept** / always overwrite / never refresh | no · owner: spec-scenes-map | entities |
| ~~OQ-MAP-16~~ | ~~Signal hooks in live-sync~~ | **Decided (integrator ruling, gate Scenes):** server stamps `from`; DM-only `map.pull`; receivers filter by scene; no server scene check or rate limit. [ADR-0026](../architecture/adr/0026-signal-routing.md) accepted (#125); built in fix/scenes-core before scenes-map builds | no (build-sequenced) · owner: orchestrator | live-sync, protocol |
| ~~OQ-MAP-22~~ | ~~Glossary: add **Ping**, **Pull**, **Laser pointer**, **Scene folder**, **Token owner**, **Viewed scene**; reword **Token**~~ | **Decided (integrator, Scenes consolidation):** added; Token = "instance of a creature definition" ([glossary](../glossary.md)) | — | — |
| OQ-MAP-23 | Box select gesture (F7.1) | **Ctrl/Shift + left-drag on empty canvas, adds; footprint centre inside; plain drag keeps panning** / plain drag = box, pan moves to middle- or Space-drag (Roll20-like, breaks the DM's habit) / any footprint overlap counts (grabs edge tokens) | no · owner: DM | — |
| OQ-MAP-24 | Where a player's drag gets the speed (F3) | **Token display copy `speed`, sent to the owner only** (one column; owner-only keeps monster stats private) / client lookup from the own character (players can't map a token to a character outside combat: no `definitionId`) | no · owner: spec-feedback | entities, combat-tracker |
| OQ-MAP-25 | Movement used in combat must change with each move (F3) | **Token-changed hooks also run in `map.moveToken`** ([ADR-0031](../architecture/adr/0031-token-move-hooks.md), amends ADR-0028) / client-only tracking (not shared, lost on reload) / client sends `cbt.recordMove` after the drop (two commits, racy) | **yes** (ADR acceptance) · owner: DM | combat-tracker, protocol §25 |
| OQ-MAP-26 | AGENTS §9.9: add `token-overlays.ts` to the append-only registries | **Add** (combat adds lines; scenes-map draws) / scenes-map hard-codes combat's decorations (cross-feature edits) / a combat canvas layer above tokens (badges lag a drag) | no · owner: integrator | AGENTS, combat-tracker |
| OQ-MAP-27 | Movement colours | **Reuse `hp.bloodied` (amber) and `hp.down` (red) until theme-system names `move.*`** / new placeholder tokens now | no · owner: spec-feedback | visual-direction |
| OQ-MAP-28 | Glossary: add **Selection** (DM's client-only set of selected tokens), **Box select**, **Token shape**, **Movement indicator**; **Ruler** "5e diagonal rules" → "5/10/5 diagonals" | **Add as worded** | no · owner: integrator | glossary |

## 16. Out of scope

- See §4. Notes from tokens → [world-builder](post-mvp/world-builder.md); combatants → [combat-tracker](combat-tracker.md).
