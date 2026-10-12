---
title: Scenes and map
prefix: MAP
status: in-review
owner: spec-scenes-map
wave: 3
---

# Scenes and map

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- A **scene** is a map image, a grid and tokens on a react-konva canvas ([ADR-0001](../architecture/adr/0001-tech-stack.md)): the base layer of the play page ([play-shell](play-shell.md)). The DM preps scenes in the UI; players see the one **active scene**.
- **Tokens** are instances of a creature definition ([ADR-0009](../architecture/adr/0009-entity-content-model.md)). They carry their own display name, image and size, because players never see monster definitions ([OQ-ENT-05](entities.md#15-open-questions) pick).
- Plugs into [live-sync](live-sync.md): record types `scene`, `scene-folder`, `token`; `map.*` intents; signals `map.ping`, `map.laser` ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md)). Token moves are state but are not logged ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).

## 2. Scope

- MVP = tier S only ([feature tiers §1, §5, §7](../feature-tiers.md#1-map-and-tokens)). **Scene list** window: folders, create (name + map from [assets-pipeline](assets-pipeline.md)), rename, move to a folder, duplicate, delete *(proposed)*. "Show to players" activates a scene, and players follow it.
- **Map and grid:** set the map; grid calibration (cell size, offset, settings: visible, colour, opacity *(proposed)*) with a live preview; lock map; pan/zoom.
- **Tokens:** drop from the Creatures list ([entities](entities.md)). Snap to grid on drop; Large/Huge span several cells; labels. Owlbear-style free drag: the DM moves any token, a player moves own tokens at any time. Ctrl-D duplicate + rename; token art from uploads; hide/reveal; the DM reassigns owner; delete.
- **Tools:** ruler (5e diagonals, local only), ping (+ DM pulls everyone's view), laser pointer (right-drag starting off a token). The DM can view any scene without showing it *(proposed, OQ-MAP-13)*.
- **Design for later, no UI:** a canvas layer registry with a slot for props/fog; a token menu + double-click registry for windows such as notes ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).

## 3. Goals

- The DM preps the town and the battlemap (upload, calibrate, place, hide) entirely in the UI. Later layers and token windows plug in without changing scene or token code.
- **Zero leakage:** no player frame or asset fetch reveals a hidden token, a non-active scene, a folder, a scene name or a definition id.
- A drop reaches the other clients ≤ 1 s after commit *(proposed)*. Positions, hidden flags and the active scene survive a hard kill ([ADR-0006](../architecture/adr/0006-persistence.md)).

## 4. Non-goals

- Fog, AoE props, layers UI, walls, HP rings, condition icons (→ [scene-tools](post-mvp/scene-tools.md)); current-turn highlight, path measurement (tier B); token art library (tier A); location ↔ scene ([world-builder](post-mvp/world-builder.md)).
- Live drag preview (OQ-MAP-04), shared ruler (OQ-MAP-05), multi-select, rotation, lighting, freehand, touch ([ADR-0007](../architecture/adr/0007-product-scope.md)); undo of moves or scene edits ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).

## 5. User stories

- **DM:** As the DM, I want to prep the battlemap with enemies hidden, reveal them with one click, and pull everyone's view to a spot, so that the ambush lands without explaining where to look.
- **Player:** As a player, I want to land on the map, drag my own token, measure, ping and laser-point, so that I can play my turn and show what I mean.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-MAP-01 | DM creates a scene (REST) with `{name, mapAssetId, folderId?}`. The name is trimmed, 1–60 chars, no control chars, and need not be unique. The map is checked with `assets.require`, and its `display` size is copied onto the scene. Grid defaults *(proposed)*: 70 px, offset 0, visible, `#000000`, 0.5. Unlocked and **inactive**. | |
| FR-MAP-02 | Folders (DM, REST): create, rename (1–40 chars), delete. One level only. Deleting a folder moves its scenes to the root in the same transaction. List order: folders by name, then scenes by name (case-insensitive; tiebreak `createdAt`, then insertion). | *(proposed)* OQ-MAP-19 |
| FR-MAP-03 | DM renames a scene, or moves it into a folder or back to the root (REST). | |
| FR-MAP-04 | Duplicating a scene creates a new inactive scene "‹name› (copy)" (cut to 60 chars) in the same folder, with the same map, grid and lock. Every token is copied with all its fields and new IDs. One transaction, one event. | |
| FR-MAP-05 | *(proposed)* DM deletes a scene. Only allowed when it is not active (else `conflict`). Its tokens are deleted with it. | OQ-MAP-19; combatant-bound: OQ-MAP-03 |
| FR-MAP-06 | `map.scene.activate`: at most one active scene per campaign (DB-enforced); one transaction flips both flags; the active scene survives a restart. After commit the active-scene cache is updated and every player connection of the campaign is resynced ([FR-SYNC-11](live-sync.md#6-functional-requirements)); the new snapshot holds only the new scene and its visible tokens. | |
| FR-MAP-07 | If there is no active scene, the player base layer shows play-shell's empty state ([FR-SHELL-02](play-shell.md#6-functional-requirements)). Creating the first scene does not activate it. | |
| FR-MAP-08 | *(proposed, OQ-MAP-13)* The DM canvas shows the DM's **viewed scene**: any scene in its snapshot, chosen in the Scenes window. It defaults to the active scene and is client-only. While it isn't the active scene, a badge reads "Not shown to players" and ping/laser are off. | Tier A pulled in |
| FR-MAP-09 | `map.scene.setMap {sceneId, mapAssetId}` replaces the map and updates the stored map size. Tokens keep their cells. | |
| FR-MAP-10 | `map.scene.setGrid {sceneId, cellSize, offsetX, offsetY, visible, color, opacity}`: cellSize 8–512 px (2 decimals); 0 ≤ offset < cellSize; color `#rrggbb`; opacity 0.1–1. Edits are previewed locally as the DM types or uses the nudge buttons; Save sends one intent and Cancel restores the saved grid. Grid space = map `display` pixels (OQ-MAP-15). | |
| FR-MAP-11 | `map.scene.setLocked {sceneId, locked}`. While a scene is locked, the DM UI disables its map and grid controls, and `setMap` / `setGrid` → `conflict`. | |
| FR-MAP-12 | Pan/zoom is per client and never sent to the server. The wheel zooms about the pointer, 10–400 % *(proposed)*. Left-drag on empty canvas, or on a token the user can't move, pans. Opening a scene fits the map to the viewport. | |
| FR-MAP-13 | Place (DM): dropping a Creatures row ([FR-ENT-18](entities.md#6-functional-requirements)) on the viewed scene sends `map.token.create {sceneId, definitionId, col, row}`. The definition is resolved with `resolveDefinition` ([FR-ENT-12](entities.md#6-functional-requirements)). Defaults: name = definition name (FR-MAP-16); image = its portrait or none; size = stat-block size; owner = the character's owner or none; visible. Every default can be overridden (used by fixtures). | |
| FR-MAP-14 | Position = top-left cell (`col`, `row`), integers. Footprint: tiny/small/medium 1×1, large 2×2, huge 3×3, gargantuan 4×4 cells. A position is valid iff the footprint overlaps the map rectangle, else `invalid`. ≤ 200 tokens per scene *(proposed)*, else `conflict`. | |
| FR-MAP-15 | Move: while dragging, the token follows the pointer freely and shows the target cell and the distance from its start (FR-MAP-22). On drop it snaps to the nearest cell and sends one `map.token.move {tokenId, col, row}`. Nothing is sent during the drag. **Optimistic:** the token shows at its new cell at once; on reject it returns to the server position with a Toast. | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) E |
| FR-MAP-16 | Token name: trimmed, 1–40 chars, no control chars. On create and duplicate, if the scene already has a token named `B` or `B N`, the new token is named `B (max N + 1)`, where a bare `B` counts as 1 ("Goblin" → "Goblin 2"). | |
| FR-MAP-17 | Ctrl-D (DM, canvas focused, one token selected): `map.token.duplicate` makes a token with the same definition, image, size, owner and hidden flag, and a numbered name. It goes at `col + footprint` in the same row if valid, else `col − footprint`. The copy becomes selected. The browser shortcut is suppressed; keys inside windows never trigger it ([FR-SHELL-13](play-shell.md#6-functional-requirements)). | |
| FR-MAP-18 | Token menu (DM, right-click on a token): rename, image (asset picker; `assets.require`), size, owner (a player of the campaign, or none), hide/reveal, duplicate, delete. The Delete key also deletes; no confirm. | `map.token.update` / `.delete` |
| FR-MAP-19 | Hide/reveal (`map.token.setHidden`; menu + `H` *(proposed)*). The DM sees a hidden token at 50 % opacity with an eye-off mark; players get a `delete` ≤ 1 s. Reveal sends players an `upsert` and makes the token image fetchable ([FR-ASSET-12](assets-pipeline.md#6-functional-requirements)). | |
| FR-MAP-20 | Every token a client can see shows its name as a label below it, in both clients. | |
| FR-MAP-21 | A player may move a token iff `ownerPlayerId = ctx.playerId`, the token is not hidden, and it is on the active scene. A token the player can't see → `not_found` (same as unknown); visible but not their own → `forbidden`. All other `map.*` intents and routes are DM only. The DM moves any token on any scene. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-MAP-22 | Ruler (both clients): drag from cell to cell to see a line and `max(abs Δcol, abs Δrow) × 5 ft` (OQ-MAP-01). Local only; cleared on release. | |
| FR-MAP-23 | Ping (both clients): Alt+click *(proposed)* sends `map.ping {sceneId, x, y}`. Every other connection of the campaign shows a 2 s pulse at that point. DM Shift+Alt+click adds `pull: true`: player cameras centre on the point with zoom unchanged, and the player can pan away afterwards. | OQ-MAP-08 |
| FR-MAP-24 | Laser (both clients): a right-button drag that starts off any token sends `map.laser {sceneId, points, end?}` (≤ 20 sends/s, ≤ 32 points each). Others draw the trail, fading 1 s after the last point. Right-click on a token opens its menu instead. The browser context menu is suppressed on the canvas. | |
| FR-MAP-25 | Signals use map display px, within the map ± one cell. The server stamps the sender `{role, playerId}` for receivers. A signal is dropped if its `sceneId` ≠ the active scene, if a player sends `pull`, or if a connection exceeds 30 signals/s *(proposed)*. No DB, log, snapshot or `seq` ([FR-SYNC-22](live-sync.md#6-functional-requirements)). | OQ-MAP-16 |
| FR-MAP-26 | Visibility per §9: `scene` is redacted for players; `scene-folder` is DM only; `token` is hidden from players while `hidden`, else redacted (no `definitionId`). | Leak scan §13 |
| FR-MAP-27 | Every command commits row(s) + an event-log entry in one transaction, except `TokenMoved`, which is not logged. Nothing is undoable. IDs and timestamps come only from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). | |
| FR-MAP-28 | While not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)), drag, menus, grid, scene-list actions and signals are disabled; pan, zoom, ruler and switching the viewed scene still work. A drag in progress when the connection drops snaps back and sends nothing. | |
| FR-MAP-29 | Canvas layers come from an ordered client registry: map < grid < *(reserved: props, fog)* < tokens < pointers (ruler, ping, laser). Token menu entries and token double-click come from a client registry; in MVP only this spec registers entries. | Design for later |

## 7. UI/UX notes

- Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, the map is the hero, semantic tokens only. **Placement** (answers [OQ-SHELL-05](play-shell.md#15-open-questions) with its pick): scenes-map exports the base-layer canvas and the active scene; play-shell owns the no-scene state. scenes-map owns a left **tool rail** slot. The scene list is window `map.scenes` (DM only, open by default, top-left).
- **Tool rail** (ToggleGroup + Tooltip): Select, Ruler, Ping (both clients). DM only: Grid (Popover: number inputs with ±1 / ±0.1 nudges, Switch, colour input, Slider, Save/Cancel), Lock, and "Show to players" (shown when the viewed scene ≠ the active scene).
- **Scenes window:** collapsible folders. Each row: name, a "Live" Badge on the active scene, and a DropdownMenu (rename, duplicate, move to…, delete). "New scene" opens a Dialog with a name field and the asset picker; "New folder". Clicking a row views the scene (FR-MAP-08).
- **Canvas:** grid drawn as one shape. Larger tokens draw below smaller ones, then by `createdAt`. A token without an image shows a circle with initials. While dragging, the target cell is highlighted and the distance shown. Ping = expanding ring; laser = fading line; both use the sender's role colour token.
- **States:** empty (DM: "No scenes yet. Create one to upload a map."; player: shell empty state); loading = image placeholder ([assets-pipeline §7](assets-pipeline.md#7-uiux-notes)); error = broken-image placeholder, grid and tokens still render; disconnected = FR-MAP-28 plus the live-sync banner.
- **DM view:** all scenes, hidden tokens translucent, token menu, grid/lock, scene list. **Player view:** active scene only, visible tokens, drag on own tokens only (grab cursor), ruler, ping, laser; no menus.
- **Test IDs:** `map-canvas`, `map-tool-<select|ruler|ping|grid|lock>`, `map-show-to-players`, `map-not-shown-badge`, `map-scenes`, `map-scene-row` / `map-folder-row` + `data-record-id`, `map-scene-live`, `map-scene-menu-<rename|duplicate|move|delete>`, `map-scene-new`, `map-folder-new`, `map-grid-<cell|offset-x|offset-y|visible|color|opacity|save|cancel>`, `map-token-menu-<rename|image|size|owner|hide|duplicate|delete>`. Konva nodes: name `map-token` (id = token id), `map-ping`, `map-laser`, `map-ruler-label`.

## 8. Data model

No JSON leaf fields. All rows per campaign ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)); timestamps from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Scene | id, campaignId, folderId, name | ID, ID → Campaign, ID → SceneFolder \| null, text 1–60 | |
| | mapAssetId; mapWidth, mapHeight | ID → Asset (**asset reference**); int ×2 | Same campaign ([FR-ASSET-15](assets-pipeline.md#6-functional-requirements)); `display` px copied at set |
| | gridCellSize, gridOffsetX, gridOffsetY; gridVisible, gridColor, gridOpacity | real ×3; bool, `#rrggbb`, real | Display px (FR-MAP-10) |
| | mapLocked, active; createdAt, updatedAt | bool ×2; timestamp ×2 | `active`: partial unique index per campaign (OQ-MAP-18) |
| SceneFolder | id, campaignId, name, createdAt, updatedAt | ID, ID, text 1–40, timestamp ×2 | One level |
| Token | id, campaignId, sceneId, definitionId | ID, ID, ID → Scene (cascade), ID → Entity (FK restrict) | Per scene (OQ-MAP-03); definition global or same campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md), [OQ-ENT-07](entities.md#15-open-questions)) |
| | name, imageAssetId, size | text 1–40, ID → Asset \| null (**asset reference**), tiny…gargantuan | Player display data; size copied at placement, then per token (OQ-MAP-14) |
| | col, row, ownerPlayerId, hidden; createdAt, updatedAt | int ×2, ID → Player \| null, bool; timestamp ×2 | Top-left cell; owner per OQ-MAP-02 |

- **Relations:** Campaign 1—* Scene, SceneFolder; SceneFolder 1—* Scene; Scene 1—* Token; Token → Entity (definition), Player (owner), Asset. Combatant → Token: [combat-tracker](combat-tracker.md) (OQ-MAP-03).
- **Derived values:** footprint (FR-MAP-14); cell → px = offset + index × cellSize; ruler distance; token number suffix; the active-scene cache (rebuilt at boot, [live-sync §8](live-sync.md#8-data-model)). Client only, not persisted: camera, viewed scene, selection, ruler.
- **Persisted runtime state:** token position, hidden flag and owner; `Scene.active`. Signals: none.

## 9. API & events

Envelopes, rejects, close codes: [live-sync](live-sync.md). Per ADR-0021 D, scene-list CRUD goes over REST and everything done on the canvas goes over WS.

- **REST (Hono RPC), DM only** (prefix per [OQ-CAMP-15](campaign-management.md#15-open-questions)): `POST /api/scenes` (FR-MAP-01); `PATCH`, `DELETE /api/scenes/:id` (FR-MAP-03, 05); `POST /api/scenes/:id/duplicate` (FR-MAP-04); `POST /api/scene-folders`, `PATCH`, `DELETE /api/scene-folders/:id` (FR-MAP-02).

**WS intents** (default DM only)

| Intent | Who | Validation / ownership |
|---|---|---|
| `map.scene.activate {sceneId}` | DM | Scene in `ctx.campaignId` |
| `map.scene.setMap` / `setGrid` / `setLocked` | DM | FR-MAP-09–11; locked → `conflict` |
| `map.token.create {sceneId, definitionId, col, row, name?, imageAssetId?, size?, ownerPlayerId?, hidden?}` | DM | `resolveDefinition`, `assets.require`, owner ∈ campaign, FR-MAP-14 |
| `map.token.move {tokenId, col, row}` | DM, player | FR-MAP-14, FR-MAP-21. **Optimistic** |
| `map.token.update {tokenId, name?, imageAssetId?, size?, ownerPlayerId?}` / `setHidden {tokenId, hidden}` / `duplicate {tokenId}` → `{tokenId}` / `delete {tokenId}` | DM | Token in `ctx.campaignId` |

**Record types** (generic record changes `{type, id, op, data}` + `cause`)

| Type | Scope | Visibility (DM always `full`) | Snapshot |
|---|---|---|---|
| `scene` | scene (gated by `id`) | Player: redacted to `{id, mapAssetId, mapWidth, mapHeight, grid*, active}` (no name, folder, lock) | DM: all; player: active |
| `scene-folder` | campaign | Player: hidden | Campaign's folders |
| `token` | scene (gated by `sceneId`) | Player: `hidden` → hidden; else redacted (all fields but `definitionId`) | DM: all; player: active scene's |

**Signals** (roles DM, player; FR-MAP-25): `map.ping {sceneId, x, y, pull?}` and `map.laser {sceneId, points [x, y][] ≤ 32, end?}`, each received with a server-stamped `from`. Visibility: every other connection of the campaign; `pull` is honoured from the DM only.

**Domain events** (none transient, none undoable)

| Event | Changes | Logged | After commit |
|---|---|---|---|
| `SceneCreated` / `SceneUpdated` (rename, folder, map, grid, lock); `SceneFolderCreated` / `Renamed` / `Deleted` | `scene` / `scene-folder` upsert or delete (+ moved `scene` upserts) | yes | — |
| `SceneDuplicated` / `SceneDeleted` | `scene` + its `token`s upsert / delete | yes | — |
| `SceneActivated {sceneId, previousSceneId}` | both `scene` upserts | yes | Update active-scene cache; `resync` all player connections |
| `TokenPlaced` / `TokenUpdated` / `TokenDuplicated` / `TokenDeleted` | `token` upsert / delete | yes | — |
| `TokenHidden` / `TokenRevealed` | `token` upsert (players: delete / upsert, [FR-SYNC-19](live-sync.md#6-functional-requirements)) | yes | — |
| `TokenMoved {tokenId, sceneId, col, row}` | `token` upsert | **no** | — |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Scene list, map, grid, lock, activate; place / edit / hide / duplicate / delete token | ✓ | ✗ | DM credential; default-DM intents |
| Move token | any, any scene | own, visible, active scene | FR-MAP-21 |
| Ping / laser (pan/zoom, ruler: client only) | ✓ (+ pull) | ✓ (no pull) | Signal roles; FR-MAP-25 |
| Receive scenes / tokens | full | active scene, redacted; hidden tokens never | §9 visibility fns |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** last view + banner; a drag in progress snaps back unsent (FR-MAP-28). Reconnect → snapshot; if the scene was switched meanwhile, the player lands on the new scene.
- **DM disconnect / reconnect:** players unaffected. The viewed scene is kept if it still exists, else the active scene. A campaign switch resets it to the new campaign's active scene.
- **Server crash mid-action:** uncommitted move/edit → no event, no `ack`; the optimistic token reverts on the snapshot. Committed → in the snapshot. Signals in flight are lost (accepted).
- **Concurrent edits:** last commit wins (DM and player move the same token; two DM tabs set the grid). Hiding a token while a player drags it → the player's token disappears and the move → `not_found`. Owner changed mid-drag → `forbidden`, revert. Scene deleted while another DM tab views it → that tab falls back to the active scene. Definition delete with tokens → blocked ([OQ-ENT-07](entities.md#15-open-questions)).
- **Scene switch while a player is loading:** the resync replaces the store; stale image loads are dropped and a 404 for the old map is ignored. **Recalibration** may leave tokens off the map: they stay rendered and draggable; nothing moves automatically.
- **Invalid / malicious input:** strict zod; IDs of another campaign → `not_found`; names rendered as text; out-of-range signals dropped; spoofed `from` is ignored (server stamps it).

## 12. Performance & bandwidth

- Moves are drop-only: ≤ a few intents/s, ≤ 400 B per event. Laser: ≤ 20 frames/s × ≤ 600 B per sender → ≈ 72 KB/s fan-out to 6 players over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)).
- Snapshot: token ≈ 300 B, scene ≈ 400 B. 30 scenes × 30 tokens ≈ 280 KB for the DM, within live-sync's 512 KB. Players get only one scene.
- Map: `display` ≤ 4096 px, ≈ 1–3 MB once per browser ([assets-pipeline §12](assets-pipeline.md#12-performance--bandwidth)). Canvas *(proposed)*: pan/zoom ≥ 50 fps with a 4096 px map, 100 tokens and the grid as one shape.

## 13. Test plan

Isolated per worktree: `bun test` uses a `:memory:` DB, a temp asset dir and port 0; walkthroughs use the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests are named after FRs.

**Fixtures.** Canonical names come from [fixtures-adapters §8](fixtures-adapters.md#8-data-model). Images are from `images` / `image-large` ([assets-pipeline §13](assets-pipeline.md#13-test-plan)).

| Key | Contents | Requires | `session-sim` |
|---|---|---|---|
| `town` | Scene "Town", map `town`, 70 px grid. Mira (`char-mira`, owner `player-1`, `token-mira`) at (5, 5). Activated | `images`, `char-mira` | yes |
| `battlemap` | Scene "Goblin Ambush", map `battlemap` (20 × 14 at 70 px), inactive. Mira (2, 7); Goblin (`enemy-1`, `token-goblin`) (12, 6); **hidden**: Wolf (`enemy-2`, `token-wolf`) (14, 4), Elite Goblin Warrior (`enemy-custom`, `token-elite`) (15, 8) | `town`, `enemy-1`, `enemy-2`, `enemy-custom` | yes |
| `scenes-extras` *(new)* | Folder "Act 1" holding both scenes. Thorn (`char-thorn`, owner `player-2`) on Town (4, 5) and on Goblin Ambush (2, 9). "Alpha" (`enemy-2`, size large) at (9, 10), visible. Root scene "Cellar": map `map-large`, cell 50, offset (25, 10), `#ffffff` 0.3, locked, Goblin at (40, 27) | `battlemap`, `char-thorn`, `image-large` | no |

- **Bundle `scenes`** = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `enemy-2` + `enemy-custom` + `images` + `image-large` + `town` + `battlemap` + `scenes-extras`.
- **Leak strings** (player frames): "Elite Goblin Warrior", "Ambush", "Cellar", "Act 1", the hidden tokens' IDs, every `definitionId`; "Wolf" only while it is revealed.

| Level | What | Fixtures |
|---|---|---|
| Unit | Distance fn; footprint per size; overlap validity; px ↔ cell with offset; numbering (FR-MAP-16); grid bounds; visibility matrix (scene / folder / token × DM / owner / other player × hidden); signal schemas; layer registry order with a test layer | In-code |
| Integration | Each command: rows + log entry + event, IDs from `ctx`; `TokenMoved` adds no log row; rollback → nothing. Ownership: `player-1` moves Mira ✓, Goblin `forbidden`, Wolf `not_found`. Owner reassignment. Reveal/hide → upsert/delete. Activate → players resynced, snapshot = active scene only; second active impossible. Locked → `conflict`; delete active → `conflict`. Duplicate scene copies tokens + hidden flags. Signals: ping reaches DM + `player-2`, not the sender; player `pull`, wrong scene, > 30/s dropped; no DB/log. Convergence; leak scan; restart → identical snapshots | `scenes` |
| E2E (thin) | Playwright, DM + `player-1`: player drags Mira, DM sees it; DM reveals Wolf; DM activates the battlemap; reload | `scenes` |

**Browser walkthrough.** Steps: `bun run build`, `fixtures:reset-load scenes --profile verify`, `start --profile verify`. Contexts: **A** DM, **B** `player-1`, **C** `player-2`. Evidence and teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | — | Scenes: "Act 1" (Town *Live*, Goblin Ambush), Cellar. Canvas: Town with Mira, Thorn labelled |
| 2 | — | B, C open links | Both see Town, Mira, Thorn; no scene list, no menus |
| 3 | — | B drags Mira 3 cells right; C drags Mira | B sees "15 ft" while dragging; A, C see Mira at (8, 5) ≤ 1 s. C's drag pans and sends nothing |
| 4 | View Goblin Ambush | — | "Not shown to players"; Wolf, Elite translucent; Alpha 2 × 2. B, C still on Town |
| 5 | "Show to players" | — | B, C switch to it: Mira, Thorn, Goblin, Alpha; no Wolf or Elite; no scene name |
| 6 | Reveal Wolf, then hide it | B ruler (2, 7) → (5, 9) | Wolf appears, then disappears for B, C ≤ 1 s. B reads "15 ft"; A sees no ruler |
| 7 | Select Goblin, Ctrl-D; rename the copy "Goblin Chief"; set its image to `token-elite` | — | "Goblin 2" at (13, 6), then renamed with new art for B, C |
| 8 | Set Thorn's owner to Player 1 | B drags Thorn; C tries | B's move sticks; C can't |
| 9 | Shift+Alt+click a far corner; right-drag on empty canvas; right-click Goblin | B Alt+clicks, then pans away | B, C recentre and see the pulse and the laser trail; A, C see B's ping; on Goblin: menu, no laser |
| 10 | View Cellar: grid controls disabled; unlock, cell 50 → 52, Save. New folder "Act 2"; duplicate Goblin Ambush into it; new scene "Tavern" from an existing upload | — | Grid redraws while editing. Copy has all tokens (Wolf, Elite translucent), inactive; Tavern at root. B, C unaffected |
| 11 | Move Mira while B is dropped ("drop connection") | B back | B: banner, drag disabled; then Mira moved, no reload |
| 12 | Reload all; hard-kill + restart the server | — | All rejoin; Goblin Ambush live; state from steps 3–10 intact; Wolf hidden. Throughout: no leak string in B or C frames, no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | `scene` scope gate, active-scene cache, resync on activation, optimistic intents, signal hooks (OQ-MAP-16) | complete; hooks open |
| [assets-pipeline](assets-pipeline.md) | `assets.require`, asset-reference fields (`Scene.mapAssetId`, `Token.imageAssetId`), picker, loader, display size; [OQ-ASSET-01](assets-pipeline.md#15-open-questions) pick A fits the Konva loader | in-review |
| [entities](entities.md) | `resolveDefinition`, FK restrict, Creatures rows as drag sources, `statBlock.size`, portrait; [OQ-ENT-05](entities.md#15-open-questions) option A | in-review |
| [play-shell](play-shell.md) | Base-layer + tool-rail slots, window `map.scenes`, no-scene state, key routing (FR-SHELL-13) | in-review; OQ-SHELL-05 answered §7 |
| [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | `player` records for the owner picker; `town`, `battlemap` shapes as in §13 | complete |
| [combat-tracker](combat-tracker.md) | Combatant → token binding, hidden combatants, token-delete rule, target pick (OQ-MAP-03, 11, 21) | Phase 3 |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-MAP-01 | 5e diagonal rule | **5 ft per square (PHB default)**; 5/10/5 as a campaign setting later / 5/10/5 only | yes | — |
| OQ-MAP-02 | Who may move a token ("own")? | **One `ownerPlayerId` per token, defaulted from the character's owner, DM reassigns** (fn reads the token only; no shared tokens) / derived from the bound character (no reassign) / owner list (more UI) | yes | character-sheet |
| OQ-MAP-03 | Tokens per scene, or one token following a character? | **Per scene; combatant references a token; deleting a bound token → combat-tracker's FK rule (pick: set null)** / one token moves between scenes | yes | combat-tracker |
| OQ-MAP-04, 05 | Live drag broadcasts? Ruler visible to others? | **Drop-only with optimistic own move; ruler local only** (one intent per move) / throttled live preview; ruler as a signal (more traffic) | no · owner: spec-scenes-map | live-sync |
| OQ-MAP-06, 07, 09, 10 | ~~UI or fixtures? Ping/laser persisted? Movement model? Turn-gated?~~ **Decided:** scenes prepped in the UI; ping/laser are broadcast-only signals ([OQ-SYNC-11](live-sync.md#15-open-questions)); Owlbear-style free drag, snap on drop, no enforcement; players always move tokens they control | — | — | — |
| OQ-MAP-08 | DM "pull view": forced or suggested? | **Forced recentre, player can pan away** / suggestion Toast | no · owner: DM | notifications |
| OQ-MAP-11 | Hidden token bound to a combatant: also hidden in the player initiative view? | **Yes: hide/reveal also sets the combatant's flag in the same transaction (combat-tracker hook), both in `changes`** / initiative always visible | no for this spec (Combat phase) · owner: combat-tracker | combat-tracker, live-sync |
| OQ-MAP-12 | Grid calibration method | **Numeric + nudges, live preview; "drag a box over one cell" later** / box now | no · owner: spec-scenes-map | — |
| OQ-MAP-13 | DM views non-active scenes (tier A "prepare in background") in MVP? | **Yes, client-only viewed scene** (near-free: players only get the active scene; lets the DM prep without players watching; fixtures-adapters walkthrough assumes it) / DM always on the active scene | yes | play-shell, fixtures-adapters |
| OQ-MAP-14 | Token size source (answers [OQ-ENT-09](entities.md#15-open-questions)) | **Copied at placement, then per token** (no state-mutating listener, ADR-0016 open row) / `EntityUpdated` listener refreshes it (live link) | no · owner: spec-scenes-map | entities, combat-tracker |
| OQ-MAP-15 | Grid pixel space (answers [OQ-ASSET-07](assets-pipeline.md#15-open-questions)) | **`display` px; scene stores the display size** / original px + scale | no · owner: spec-scenes-map | assets-pipeline |
| OQ-MAP-16 | live-sync hooks: scope `scene` gates by `sceneId` (scene: `id`) for snapshot and events; signal `authorize(data, ctx)` with the active-scene id; hub stamps `from`; per-connection signal rate limit | **Add to the registry (shared change via orchestrator)** / checks inside scenes-map handlers (no signal hook exists) | no · owner: orchestrator | live-sync |
| OQ-MAP-17 | Player-visible scene fields | **Redacted: no name, folder, lock** (names can spoil) / full | no · owner: DM | play-shell |
| OQ-MAP-18 | Where the active scene lives | **`Scene.active` + partial unique index** (mirrors `Campaign.active`; no CAMP change) / `Campaign.activeSceneId` (changes campaign-management) | no · owner: spec-scenes-map | campaign-management |
| OQ-MAP-19 | Scene list extras | **Delete non-active scenes; one folder level; folder delete moves scenes to root** / no delete in MVP / nested folders | no · owner: DM | — |
| OQ-MAP-20 | Numbers and gestures (1 s, 200 tokens, 30 signals/s, 20 laser frames/s, zoom 10–400 %, grid defaults, Alt+click ping, `H`) | **As proposed** / DM sets | no · owner: DM | — |
| OQ-MAP-21 | Damage-card target pick ([OQ-CBT-07](combat-tracker.md#15-open-questions)) | **scenes-map exposes the selected token id in the client store; combat-tracker reads it** / combat-tracker builds its own picker | no · owner: combat-tracker | combat-tracker |
| OQ-MAP-22 | Glossary: add **Ping**, **Laser pointer**, **Scene folder**, **Token owner**, **Viewed scene** (if OQ-MAP-13) | **Add** as in §6 / keep spec-local | no · owner: integrator | glossary |

## 16. Out of scope

- See §4. Notes from tokens → [world-builder](post-mvp/world-builder.md); combatants → [combat-tracker](combat-tracker.md).
