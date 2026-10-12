---
title: Scenes and map
prefix: MAP
status: complete
owner: spec-scenes-map
wave: 3
---

# Scenes and map

## 1. Summary

- A **scene** is a map image, a grid and tokens on a react-konva canvas ([ADR-0001](../architecture/adr/0001-tech-stack.md)): the base layer of the play page ([play-shell](play-shell.md)). The DM preps scenes in the UI and can view any scene (#122); players see the one **active scene**.
- **Tokens** are instances of a creature definition ([ADR-0009](../architecture/adr/0009-entity-content-model.md)). Players never see monster definitions (#120), so a token carries its display name (instance state) and read-only copies of image and size, refreshed inside the definition edit's transaction ([FR-ENT-19](entities.md#6-functional-requirements)).

## 2. Scope

- MVP = tier S ([feature tiers §1, §7](../feature-tiers.md#1-map-and-tokens)) plus background prep (#122). **Scene list** window: folders, create (name + map from [assets-pipeline](assets-pipeline.md)), rename, move to a folder, duplicate, delete *(proposed)*. "Show to players" activates a scene; players follow it.
- **Map and grid:** set the map; grid calibration (cell size, offset; visible, colour, opacity) with live preview; lock map; pan/zoom.
- **Tokens:** drop from the Creatures window ([entities](entities.md)); snap on drop; Large+ span several cells; labels. Owlbear-style free drag: DM moves any token, a player moves own tokens any time. Ctrl-D duplicate + rename; token art from uploads; hide/reveal; DM reassigns owner; delete. **Tools:** ruler (local), ping + DM pull view, laser pointer (right-drag off a token).

## 3. Goals

- The DM preps the town and the battlemap (upload, calibrate, place, hide) entirely in the UI, while players watch another scene. Later layers and token windows plug in without changing scene or token code.
- **Zero leakage:** no player frame reveals a hidden token, a non-active scene, a folder, a scene name or a monster definition id; image IDs reach players only on records they see ([FR-ASSET-12](assets-pipeline.md#6-functional-requirements)). A drop reaches other clients ≤ 1 s after commit *(proposed)*. Positions, hidden flags and the active scene survive a hard kill ([ADR-0006](../architecture/adr/0006-persistence.md)).

## 4. Non-goals

- Fog, AoE props, layers UI, walls, HP rings, condition icons (→ [scene-tools](post-mvp/scene-tools.md)); current-turn highlight, path measurement, keyboard shortcuts other than Ctrl-D (tier B); token art library (tier A); location ↔ scene ([world-builder](post-mvp/world-builder.md)).
- Per-token size or stat editing (#120); live drag preview, shared ruler, multi-select, rotation, lighting, freehand, touch ([ADR-0007](../architecture/adr/0007-product-scope.md)); undo ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)); server-side signal rate limit (post-MVP).

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
| FR-MAP-05 | *(proposed, OQ-MAP-19)* DM deletes a non-active scene (active → `conflict`); its tokens go with it. A token referenced by another feature follows that feature's FK; any rewritten row must be in the event's `changes`. | combat-tracker (§14) |
| FR-MAP-06 | `map.activateScene`: ≤ 1 active scene per campaign (`Scene.active` + partial unique index *(proposed, OQ-MAP-18)*); one transaction flips both flags. After commit, before listeners run, the active-scene cache is updated; then every player connection of the campaign is resynced ([FR-SYNC-11](live-sync.md#6-functional-requirements)). Token visibility changes from activation reach players via that snapshot (ADR-0021 C), not via `changes`. | |
| FR-MAP-07 | Creating a scene never activates it. No active scene → player base layer = play-shell's empty state ([FR-SHELL-02](play-shell.md#6-functional-requirements)). | |
| FR-MAP-08 | The DM canvas shows the DM's **viewed scene** (#122): any scene in its snapshot, picked in the Scenes window; client-only. Default: the active scene; none active → first scene in list order; no scenes → shell empty state. While viewed ≠ active, a badge reads "Not shown to players" and ping, pull and laser are off. | |
| FR-MAP-09 | `map.setSceneMap {sceneId, mapAssetId}` replaces the map and its stored size; tokens keep their cells. | |
| FR-MAP-10 | `map.setGrid {sceneId, cellSize, offsetX, offsetY, visible, color, opacity}`: cellSize 8–512 (2 decimals); 0 ≤ offset < cellSize; `#rrggbb`; opacity 0.1–1. Edits preview locally (inputs, ±1 / ±0.1 nudges); Save sends one intent, Cancel restores. Grid space = map `display` px *(proposed, OQ-MAP-15)*. | |
| FR-MAP-11 | `map.setLocked {sceneId, locked}`. Locked: DM map and grid controls disabled; `setSceneMap` / `setGrid` → `conflict`. | |
| FR-MAP-12 | Pan/zoom per client, never sent. Wheel zooms about the pointer, 10–400 % *(proposed, OQ-MAP-20)*. Left-drag on empty canvas, or on a token the user can't move, pans. Opening a scene fits the map to the viewport. | |
| FR-MAP-13 | Place (DM): the canvas accepts an HTML5 drop, MIME `application/x-pp-definition`, data `{definitionId}` ([FR-ENT-18](entities.md#6-functional-requirements), FR-SHELL-13); the pointer cell becomes the footprint's top-left. Sends `map.placeToken {sceneId, definitionId, col, row}`; definition via `resolveDefinition` ([FR-ENT-12](entities.md#6-functional-requirements)). Sets name = definition name, numbered (FR-MAP-16); image = portrait or none; size = `statBlock.size`; owner = the character's owner, else none (#124); visible. Optional `name, imageAssetId, ownerPlayerId, hidden` (fixtures); never size. | |
| FR-MAP-14 | Position = top-left cell (`col`, `row`), integers. Footprint: tiny/small/medium 1×1, large 2×2, huge 3×3, gargantuan 4×4. Valid iff the footprint overlaps the map rectangle, else `invalid`. ≤ 200 tokens per scene, ≤ 1,000 per campaign *(proposed, OQ-MAP-20)*, else `conflict`. | |
| FR-MAP-15 | Move *(proposed, OQ-MAP-04: drop-only)*: while dragging, the token follows the pointer and shows the target cell and distance (FR-MAP-22); nothing is sent. On drop `col = round((left − offsetX) / cellSize)` for the token's top-left corner, same for `row`; one `map.moveToken {tokenId, col, row}`. **Optimistic:** the new position is an overlay, cleared on that intent's `ack` / `reject` or any snapshot; events update the state underneath (server wins); `reject` → revert + Toast. | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) E |
| FR-MAP-16 | Token name: trimmed, 1–40 chars, no control chars; instance state, never changed by a definition edit. Base `B` = name minus a trailing ` <N>`. On place and duplicate, if the scene has tokens named `B` (counts as 1) or `B N`, the new name is `B <max N + 1>`, else unchanged; `B` cut so the result ≤ 40. Every token a client sees shows its name as a label below it. | "Goblin" → "Goblin 2" |
| FR-MAP-17 | Ctrl-D (DM, canvas focused, one token selected): `map.duplicateToken` → same definition, image, size, owner, hidden flag; numbered name; at `col + footprint` same row if valid, else `col − footprint`, else the source cell. The copy is selected. Browser shortcut suppressed; keys inside windows never trigger it ([FR-SHELL-13](play-shell.md#6-functional-requirements)). | |
| FR-MAP-18 | Token menu (DM, right-click a token): rename, image (asset picker; `assets.require`), owner (a player of the campaign or none, #124), hide/reveal, duplicate, delete (no confirm). No size entry (#120). | `map.updateToken`, `map.deleteToken` |
| FR-MAP-19 | Hide/reveal (`map.setTokenHidden`, menu). DM sees a hidden token with `visibility.hidden` styling + eye-off icon; players get a `delete` ≤ 1 s. Reveal sends players an `upsert`, so the token's image ID reaches them then (FR-ASSET-12). | |
| FR-MAP-20 | Definition-changed hook (FR-ENT-19), registered by scenes-map, runs inside `entities.update`'s transaction: every token of that definition gets the new `statBlock.size` if it changed; if the portrait changed, tokens whose image is the old portrait get the new one *(proposed, OQ-MAP-14)*. Names untouched. Changed tokens are returned as record changes and land in `EntityUpdated.changes`. Cells kept, even if a larger footprint overhangs the map. | #120, ADR-0016 |
| FR-MAP-21 | A player may move a token iff `ownerPlayerId = ctx.playerId`, it is not hidden and is on the active scene. Token the player can't see → `not_found` (as unknown); visible but not theirs → `forbidden`. Every other `map.*` intent and route is DM only. DM moves any token on any scene. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-MAP-22 | Ruler (both): drag cell to cell → line + `max(abs Δcol, abs Δrow) × 5 ft` (#124). Local only *(proposed, OQ-MAP-05)*; cleared on release. | |
| FR-MAP-23 | Ping tool (both): click sends `map.ping {sceneId, x, y}`; others show a 2 s pulse. DM Shift+click sends `map.pull {sceneId, x, y}`: pulse + player cameras centre on the point, zoom unchanged; players may pan away *(proposed, OQ-MAP-08)*. | |
| FR-MAP-24 | Laser (both): right-button drag starting off any token sends `map.laser {sceneId, points, end?}` (≤ 20 sends/s, ≤ 32 points each); others draw a trail fading 1 s after the last point. Right-click on a token: DM → menu; player → nothing. Browser context menu suppressed on the canvas. | |
| FR-MAP-25 | Signals ([ADR-0026](../architecture/adr/0026-signal-routing.md)): zod `x, y` finite, abs ≤ 16384; roles ping/laser DM + player, pull DM only. The hub forwards to every other connection of the campaign with a server-stamped `from {role, playerId?}`. A receiver draws a signal only if its `sceneId` is the scene it shows (player: active; DM: viewed). No DB, log, snapshot or `seq` ([FR-SYNC-22](live-sync.md#6-functional-requirements)). | |
| FR-MAP-26 | Visibility per §9: `scene` redacted for players *(proposed, OQ-MAP-17)*; `scene-folder` DM only; `token` hidden from players while `hidden`, else without `definitionId`. | Leak scan §13 |
| FR-MAP-27 | Every command commits row(s) + an event-log entry in one transaction, except `TokenMoved` (not logged). Nothing undoable. IDs and time only from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)); `seq` assigned by the DB at insert (insertion order, as the event log; CON-20). | |
| FR-MAP-28 | While not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)): drag, menus, grid, scene-list actions and signals disabled; pan, zoom, ruler and switching the viewed scene still work. A drag in progress when the connection drops snaps back, unsent. | |
| FR-MAP-29 | Canvas layers come from an ordered client registry: map < grid < *(reserved: props, fog)* < tokens < pointers (ruler, ping, laser). Token menu entries and token double-click come from a client registry; in MVP only this spec registers. | Design for later |

## 7. UI/UX notes

- Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, map is the hero, semantic tokens only. Answers [OQ-SHELL-05](play-shell.md#15-open-questions): scenes-map exports the base-layer canvas (DM: viewed scene; player: active) and the tool-rail content; play-shell owns the empty state. Window `map.scenes`: DM only, open by default, top-left, default 300×480, min 240×240, launcher "Scenes". **Tool rail** (ToggleGroup + Tooltip): Select, Ruler, Ping (both); DM: Grid (Popover: number inputs with nudges, Switch, colour input, Slider, Save/Cancel), Lock, "Show to players" (when viewed ≠ active).
- **Scenes window:** collapsible folders; row = name, "Live" Badge on the active scene, DropdownMenu (rename, duplicate, move to…, delete). "New scene" Dialog: name + asset picker; "New folder". Clicking a row views the scene (FR-MAP-08). **Canvas:** grid drawn as one shape. Larger tokens below smaller, then by `seq`. No image → circle with initials. Drag: target cell highlighted, distance shown. Ping = expanding ring, laser = fading line, in a semantic accent token per role (names per [theme-system](post-mvp/theme-system.md)).
- **States:** empty = shell empty state; loading = image placeholder ([assets-pipeline §7](assets-pipeline.md#7-uiux-notes)); error = broken-image placeholder, grid and tokens still render; disconnected = FR-MAP-28 + live-sync banner. **DM view:** any scene, hidden tokens styled, menus, grid/lock, scene list. **Player view:** active scene, visible tokens, grab cursor on own tokens, ruler, ping, laser; no menus.
- **Test IDs:** `map-canvas`, `map-tool-<select|ruler|ping|grid|lock>`, `map-show-to-players`, `map-not-shown-badge`, `map-scenes`, `map-scene-row` / `map-folder-row` + `data-record-id`, `map-scene-live`, `map-scene-menu-<rename|duplicate|move|delete>`, `map-scene-new`, `map-folder-new`, `map-grid-<cell|offset-x|offset-y|visible|color|opacity|save|cancel>`, `map-token-menu-<rename|image|owner|hide|duplicate|delete>`. Konva: name `map-token` (id = token id), `map-ping`, `map-laser`, `map-ruler-label`.

## 8. Data model

No JSON leaf fields. All rows per campaign ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)); `seq` = monotonic insertion order per table, assigned by the DB (CON-20); timestamps from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Scene | id, campaignId, folderId, seq, name; mapAssetId; mapWidth, mapHeight | ID, ID → Campaign, ID → SceneFolder \| null, int, text 1–60; ID → Asset (**asset reference**); int ×2 | Map same campaign ([FR-ASSET-15](assets-pipeline.md#6-functional-requirements)); `display` px copied at set |
| | gridCellSize, gridOffsetX, gridOffsetY, gridVisible, gridColor, gridOpacity; mapLocked, active; createdAt, updatedAt | real ×3, bool, `#rrggbb`, real; bool ×2; timestamp ×2 | Display px; `active` partial unique per campaign |
| SceneFolder | id, campaignId, seq, name, createdAt, updatedAt | ID, ID, int, text 1–40, timestamp ×2 | One level |
| Token | id, campaignId, sceneId, definitionId, seq | ID, ID, ID → Scene (cascade), ID → Entity, int | Per scene (#124); definition global or same campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md)) |
| | name; imageAssetId; size; col, row, ownerPlayerId, hidden; createdAt, updatedAt | text 1–40; ID → Asset \| null (**asset reference**); tiny…gargantuan; int ×2, ID → Player \| null, bool; timestamp ×2 | Name = instance state. Image, size = display copies written at place / duplicate and by FR-MAP-20; size never per-token editable (#120). Top-left cell; one owner (#124) |

- **Relations:** Campaign 1—* Scene, SceneFolder; SceneFolder 1—* Scene; Scene 1—* Token; Token → Entity (definition), Player (owner), Asset. Combatant → Token: [combat-tracker](combat-tracker.md). **Derived:** footprint (FR-MAP-14); cell → px = offset + index × cellSize; ruler distance; name suffix; active-scene cache (rebuilt at boot, [live-sync §8](live-sync.md#8-data-model)). Client only: camera, viewed scene, selection, ruler, move overlay. **Persisted runtime state:** token position, hidden, owner; `Scene.active`. Signals: none.

## 9. API & events

Envelopes, rejects, close codes: [live-sync](live-sync.md). Per ADR-0021 D, scene-list CRUD is REST; canvas actions are WS. **REST (Hono RPC), DM only** (prefix per [OQ-CAMP-15](campaign-management.md#15-open-questions)): `POST /api/scenes` (FR-MAP-01); `PATCH`, `DELETE /api/scenes/:id` (03, 05); `POST /api/scenes/:id/duplicate` (04); `POST /api/scene-folders`, `PATCH`, `DELETE /api/scene-folders/:id` (02). Campaign = `ctx.campaignId`, fixed at authentication ([FR-CAMP-11](campaign-management.md#6-functional-requirements)). POST `201 {scene | sceneFolder}`, PATCH `200`, DELETE `204`, duplicate `201 {scene}`. Errors `{code, message, issues?}` → 400/403/404/409 (protocol CON-09).

| WS intent (default DM only) | Who | Validation / ownership |
|---|---|---|
| `map.activateScene {sceneId}`; `map.setSceneMap` / `setGrid` / `setLocked` | DM | Scene in `ctx.campaignId`; FR-MAP-09–11; locked → `conflict` |
| `map.placeToken {sceneId, definitionId, col, row, name?, imageAssetId?, ownerPlayerId?, hidden?}` | DM | `resolveDefinition`, `assets.require`, owner ∈ campaign, FR-MAP-14 |
| `map.moveToken {tokenId, col, row}` | DM, player | FR-MAP-14, FR-MAP-21. **Optimistic** |
| `map.updateToken {tokenId, name?, imageAssetId?, ownerPlayerId?}` / `setTokenHidden {tokenId, hidden}` / `duplicateToken {tokenId}` → `{tokenId}` / `deleteToken {tokenId}` | DM | Token in `ctx.campaignId` |

| Record type | Scope | Player visibility (DM always `full`) | Snapshot |
|---|---|---|---|
| `scene` | scene, `sceneOf = id` | Redacted to `{id, mapAssetId, mapWidth, mapHeight, grid*, active}` (no name, folder, lock, `seq`) | DM: all; player: active |
| `scene-folder` | campaign | Hidden | Campaign's folders |
| `token` | scene, `sceneOf = sceneId` | `hidden` → hidden; else all fields but `definitionId` | DM: all; player: active scene's |

**Signals** (FR-MAP-25; [ADR-0026](../architecture/adr/0026-signal-routing.md)): `map.ping {sceneId, x, y}` and `map.laser {sceneId, points [x, y][] ≤ 32, end?}` (DM, player); `map.pull {sceneId, x, y}` (DM). Visibility: every other connection of the campaign, with server-stamped `from`.

**Domain events** (FR-MAP-27; none transient or undoable)

| Event | Changes | Logged | After commit |
|---|---|---|---|
| `SceneCreated` / `Updated` / `Duplicated` / `Deleted`; `SceneFolderCreated` / `Renamed` / `Deleted` | `scene` / `scene-folder` upsert or delete; duplicate and delete include the scene's `token`s; folder delete the moved `scene`s | yes | — |
| `SceneActivated {sceneId, previousSceneId}` | both `scene` upserts | yes | Cache updated by a commit hook, before listeners ([CON-23](../protocol/README.md#11-conflicts-log)); resync players |
| `TokenPlaced` / `Updated` / `Duplicated` / `Deleted` / `Hidden` / `Revealed` | `token` upsert / delete (players per [FR-SYNC-19](live-sync.md#6-functional-requirements)) | yes | — |

Command → event (CON-31): `POST /api/scenes` → `SceneCreated`; `PATCH /api/scenes/:id` (rename, move), `map.setSceneMap`, `map.setGrid`, `map.setLocked` → `SceneUpdated`; duplicate → `SceneDuplicated`; `DELETE` → `SceneDeleted`; folder routes → `SceneFolderCreated` / `Renamed` / `Deleted`; `map.activateScene` → `SceneActivated`; `map.placeToken` → `TokenPlaced`; `map.updateToken` → `TokenUpdated`; `map.duplicateToken` → `TokenDuplicated`; `map.deleteToken` → `TokenDeleted`; `map.setTokenHidden` → `TokenHidden` (`hidden: true`) / `TokenRevealed` (`false`); `map.moveToken` → `TokenMoved`.
| `TokenMoved {tokenId, sceneId, col, row}` | `token` upsert | **no** | — |
| entities' `EntityUpdated` | + `token` upserts from FR-MAP-20 | yes (entities) | — |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Scene list, map, grid, lock, activate; place / edit / hide / duplicate / delete token | ✓ | ✗ | DM credential; default-DM intents |
| Move token | any, any scene | own, visible, active scene | FR-MAP-21 |
| Ping, laser / pull (pan, zoom, ruler: client only) | ✓ / ✓ | ✓ / ✗ | Signal roles (FR-MAP-25) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** last view + banner; a drag in progress snaps back unsent. Reconnect → snapshot; scene switched meanwhile → the player lands on the new scene. **DM disconnect / reconnect:** players unaffected. Viewed scene kept if it still exists, else FR-MAP-08 default. A campaign switch resets it.
- **Server crash mid-action:** uncommitted → no event, no `ack`; the overlay drops on the snapshot. Committed → in the snapshot. A definition edit and its token refresh commit together or not at all. Signals in flight are lost (accepted).
- **Concurrent edits:** last commit wins (DM and player move one token; two DM tabs set the grid). Token hidden mid-drag → it disappears for the player; the move → `not_found`. Owner changed mid-drag → `forbidden`, revert. Scene deleted while another DM tab views it → FR-MAP-08 default. Character renamed or re-owned → tokens keep name and owner; the DM edits them. Recalibration or a size increase may leave tokens off the map: still rendered and draggable. **Scene switch while a player loads:** the resync replaces the store; stale image loads are dropped, a 404 for the old map is ignored.
- **Invalid / malicious input:** strict zod; IDs of another campaign → `not_found`; names rendered as text; spoofed `from` ignored (server stamps it). Players see `cause TokenHidden` on a hide, so they can tell a token was hidden (accepted).

## 12. Performance & bandwidth

- Moves are drop-only: ≤ a few intents/s, ≤ 400 B per event. Laser ≤ 20 frames/s × ≤ 600 B per sender ≈ 72 KB/s fan-out to 6 players over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)). Map `display` ≤ 4096 px, 1–3 MB once per browser ([assets-pipeline §12](assets-pipeline.md#12-performance--bandwidth)).
- Snapshot: token ≈ 300 B, scene ≈ 400 B; 30 scenes × 30 tokens ≈ 280 KB. Shared DM budget: scenes ≤ 300 KB of live-sync's 512 KB (1,000-token cap). Players get one scene. **Review check:** Chrome trace of a 10 s pan on Cellar (4096 px map, grid on): median frame ≤ 20 ms.

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:` DB, temp asset dir, port 0; walkthroughs on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests named after FRs. Canonical names: [fixtures-adapters §8](fixtures-adapters.md#8-data-model); images from `images` / `image-large` ([assets-pipeline §13](assets-pipeline.md#13-test-plan)); setups run as DM (FR-FIX-13).

| Key | Contents | Requires | `session-sim` |
|---|---|---|---|
| `town` | Scene "Town", map `town`, 70 px grid. Mira (`char-mira`, owner `player-1`, image `token-mira`) at (5, 5). Activated | `images`, `char-mira` | yes |
| `battlemap` | Scene "Goblin Ambush", map `battlemap` (20 × 14 at 70 px), inactive. Mira (2, 7); Goblin (`enemy-1`, `token-goblin`) (12, 6); **hidden**: Wolf (`enemy-2`, `token-wolf`) (14, 4), Elite Goblin Warrior (`enemy-custom`, `token-elite`) (15, 8) | `town`, `enemy-1`, `enemy-2`, `enemy-custom` | yes |
| `scenes-extras` *(new)* | Folder "Act 1" holding both scenes. Thorn (`char-thorn`, owner `player-2`) on Town (4, 5) and Goblin Ambush (2, 9). Custom monster "Cave Ogre" (`enemy-2`'s block, size large) on Goblin Ambush (9, 10), visible. Root scene "Cellar": `map-large`, cell 50, offset (25, 10), `#ffffff` 0.3, locked, Goblin (40, 27) | `battlemap`, `char-thorn`, `image-large` | no |

- **Bundle `scenes`** = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `enemy-2` + `enemy-custom` + `images` + `image-large` + `town` + `battlemap` + `scenes-extras`.
- **Leak strings** (player frames): "Elite Goblin Warrior", "Ambush", "Cellar", "Act 1", hidden tokens' IDs, `token-elite`'s asset ID (until step 5), every monster `definitionId`; "Wolf" and `token-wolf`'s ID only while revealed; after step 7 also "Act 2", "Tavern".

| Level | What | Fixtures |
|---|---|---|
| Unit | Distance; footprint; overlap validity; px ↔ cell with offset; drop rounding; numbering (FR-MAP-16 incl. "Goblin 2" → "Goblin 3", 40-char cut); grid bounds; visibility matrix (scene / folder / token × DM / owner / other player × hidden); signal schemas; receiver scene filter; move overlay (`ack` keeps server position, `reject` reverts + Toast, snapshot drops it); list order with equal `createdAt`; layer registry with a test layer | In-code |
| Integration | Each command: rows + log + event, IDs from `ctx`; `TokenMoved` adds no log row; rollback → nothing. Ownership: `player-1` moves Mira ✓, Goblin `forbidden`, Wolf `not_found`. Owner reassignment. Hide/reveal → delete/upsert. Activate → after it each player store equals a fresh snapshot; second active impossible. Locked → `conflict`; delete active → `conflict`. Duplicate scene copies tokens + hidden flags. **Hook:** Cave Ogre large → huge resizes its token in the same commit, listed in `EntityUpdated.changes`; portrait change: tokens with the old portrait follow, custom art and names kept. Signals: ping reaches DM + `player-2`, not the sender, with `from`; player `map.pull` reaches nobody; no DB/log. Leak scan; restart → identical snapshots | `scenes` |
| E2E (thin) | Playwright, DM + `player-1`: player drags Mira, DM sees it; DM reveals Wolf; DM activates the battlemap; reload | `scenes` |

**Browser walkthrough.** `PP_TEST_MODE=1` (AGENTS §9.2); `bun run build`, `fixtures:reset-load scenes --profile verify`, `start --profile verify`. Contexts **A** DM, **B** `player-1`, **C** `player-2`. Evidence and teardown per AGENTS §9.6. Also runs [assets-pipeline walkthrough B](assets-pipeline.md#13-test-plan).

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | B, C open links | A: "Act 1" (Town *Live*, Goblin Ambush), Cellar; Town with Mira, Thorn labelled. B, C: same Town; no scene list or menus |
| 2 | — | B drags Mira 3 cells right; C drags Mira | B sees "15 ft" while dragging; A, C see Mira at (8, 5) ≤ 1 s. C's drag pans, sends nothing |
| 3 | View Goblin Ambush; then "Show to players" | — | First: "Not shown to players"; Wolf, Elite styled hidden; Cave Ogre 2 × 2; B, C still on Town. Then B, C switch: Mira, Thorn, Goblin, Cave Ogre; no Wolf, Elite or scene name |
| 4 | Reveal Wolf, then hide it | B ruler (2, 7) → (5, 9) | Wolf appears, then disappears for B, C ≤ 1 s. B reads "15 ft"; A sees no ruler |
| 5 | Select Goblin, Ctrl-D; rename copy "Goblin Chief", image `token-elite`; set Thorn's owner to Player 1 | B drags Thorn; C tries | "Goblin 2" at (13, 6), then renamed with new art for B, C. B's Thorn move sticks; C's drag pans |
| 6 | Ping tool: Shift+click a far corner; right-drag empty canvas; right-click Goblin | B: Ping click, then pans away; right-clicks Goblin | B, C recentre, see pulse and laser; A, C see B's ping; A gets the menu, no laser; B gets nothing |
| 7 | View Cellar: grid disabled; unlock, cell 50 → 52, Save. New folder "Act 2"; duplicate Goblin Ambush, move the copy to "Act 2"; new scene "Tavern" from an existing upload | — | Grid redraws while editing. Copy in Act 2 has all tokens (Wolf, Elite hidden), inactive; Tavern at root. B, C unaffected |
| 8 | Move Mira while B is dropped (Probes window "drop connection"); then reload all; hard-kill + restart | B back | B: banner, drag disabled, then Mira moved, no reload. All rejoin; Goblin Ambush live; steps 2–7 intact; Wolf hidden. Throughout: no leak string in B, C frames; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | `scene` scope gate (`sceneOf(record)` at registration, CON-22), commit hook for the active-scene cache (CON-23), resync on activation, optimistic intents; signal routing ([ADR-0026](../architecture/adr/0026-signal-routing.md)) | complete; ADR accepted (#125); built in fix/scenes-core |
| [assets-pipeline](assets-pipeline.md) | `assets.require`, asset-reference fields, picker, `useAssetImage`, `display` size; OQ-ASSET-07 answered by OQ-MAP-15 | in-review |
| [entities](entities.md) | `resolveDefinition`, drag payload (FR-ENT-18), `statBlock.size`, portrait, definition-changed hooks (FR-ENT-19; registry per OQ-ENT-14), `entities.create` for Cave Ogre. [ADR-0024](../architecture/adr/0024-definition-visibility.md) refines ADR-0009: token holds name, image and size copies, owner (#120) | in-review; ADR decided |
| [play-shell](play-shell.md) | Base layer + tool-rail slot (FR-SHELL-01 order), window `map.scenes`, empty state, key routing + window drops (FR-SHELL-13) | in-review |
| [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | `player` records for the owner picker; `town`, `battlemap` as §13; add `scenes-extras` + bundle `scenes` to FIX §8 at merge (integrator) | complete |
| [combat-tracker](combat-tracker.md) | Combatant → token; token-delete rule (#124; suggest restrict → `conflict` "Token is in an encounter"); hidden combatant follows its token (in-transaction); damage-card target = selected token id in the client store ([OQ-CBT-07](combat-tracker.md#15-open-questions)) | Combat phase |

## 15. Open questions

**Bold** option = suggested pick unless the row says Decided.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-MAP-01, 02, 03~~ | ~~Diagonal rule; token owner; tokens per scene~~ | **Decided (#124):** 5 ft per diagonal square; one `ownerPlayerId` per token, defaulted from the character's owner, DM reassigns; tokens per scene, combatant-on-token-delete rule owned by combat-tracker | — | — |
| OQ-MAP-04, 05, 12, 15, 18 | Spec-local picks | **Drop-only moves + local ruler; numeric grid calibration with nudges (box tool later); grid in `display` px (answers OQ-ASSET-07); `Scene.active` + partial unique index (mirrors `Campaign.active`)** / live drag preview; shared ruler; box tool now; original px + scale; `Campaign.activeSceneId` | no · owner: spec-scenes-map | live-sync, assets-pipeline, campaign-management |
| OQ-MAP-08, 17, 19, 20 | DM product picks: pull; player-visible scene fields; scene list extras; numbers and gestures | **08: forced recentre, player can pan away** / suggestion Toast. **17: redacted, no name, folder, lock** (names spoil) / full. **19: delete non-active scenes; one folder level; folder delete → root** / no delete / nested. **20: 1 s, 200 tokens/scene, 1,000/campaign, 20 laser sends/s, zoom 10–400 %, grid defaults, Shift+click pull** / DM sets | no · owner: DM | notifications, play-shell |
| ~~OQ-MAP-13~~ | ~~DM views non-active scenes?~~ | **Decided (#122):** yes, client-only viewed scene (FR-MAP-08); integrator amends ADR-0014's deferred row | — | — |
| OQ-MAP-14 | Token image after a portrait edit (size always follows, #120) | **Tokens still showing the old portrait follow; custom art kept** / always overwrite / never refresh | no · owner: spec-scenes-map | entities |
| ~~OQ-MAP-16~~ | ~~Signal hooks in live-sync~~ | **Decided (integrator ruling, gate Scenes):** server stamps `from`; DM-only `map.pull`; receivers filter by scene; no server scene check or rate limit. [ADR-0026](../architecture/adr/0026-signal-routing.md) accepted (#125); built in fix/scenes-core before scenes-map builds | no (build-sequenced) · owner: orchestrator | live-sync, protocol |
| ~~OQ-MAP-22~~ | ~~Glossary: add **Ping**, **Pull**, **Laser pointer**, **Scene folder**, **Token owner**, **Viewed scene**; reword **Token**~~ | **Decided (integrator, Scenes consolidation):** added; Token = "instance of a creature definition" ([glossary](../glossary.md)) | — | — |

## 16. Out of scope

- See §4. Notes from tokens → [world-builder](post-mvp/world-builder.md); combatants → [combat-tracker](combat-tracker.md).
