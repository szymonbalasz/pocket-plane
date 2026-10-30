---
title: Overview scenes
prefix: OVW
status: complete
owner: spec-overview-scenes
phase: post-mvp
---

# Overview scenes

> Five-minute read: §1–§5 and the table below; §6 onward is the reference for builders. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Scope as the DM set it on 2026-10-30; complete (decisions [#398](../decisions-log.md)). Cross-cutting design: [ADR-0075](../architecture/adr/0075-overview-scenes.md).

### At a glance

| FR | What | Slice ([§14](#14-dependencies)) | Named test ([§13](#13-test-plan)) |
|---|---|---|---|
| FR-OVW-01–08 | Overview records, Show, one thing shown | Core | `FR-OVW-05 show takes the scene off`, `FR-OVW-06 scene show takes the overview off` |
| FR-OVW-09–14 | Canvas, camera, Scenes window, DM view rule | Canvas | `FR-OVW-10 DM view order`, `FR-OVW-12 fit frames the items` |
| FR-OVW-15–21 | Select, move, stack, lock, hide, delete | Images | `FR-OVW-16 locked pans`, `FR-OVW-18 group move` |
| FR-OVW-22–24 | Images, never cropped | Images | `FR-OVW-23 keeps its shape` |
| FR-OVW-25–30 | Place labels and their style | Labels | `FR-OVW-25 label in one go`, `FR-OVW-27 style bounds` |
| FR-OVW-31–38 | Miniatures, Add party, player moves, live drag | Miniatures | `FR-OVW-31 add party`, `FR-OVW-35 player moves own only` |
| FR-OVW-39–41 | What players receive | Core | `FR-OVW-39 visibility`, `FR-OVW-40 leak scan` |
| FR-OVW-42–45 | Fights, pets, images in use | Core, Canvas | `FR-OVW-42 fight runs on`, `FR-OVW-43 start needs a scene` |
| FR-OVW-46–48 | Fixtures, reconnect, crash | Core | `overview-scenes loads from empty`, `FR-OVW-47 reconnect`, `FR-OVW-48 crash` |

## 1. Summary

- An **overview** is a second kind of scene for the zoomed-out parts of the game: a region, a city, a town.
- It is an empty canvas holding **images**, **place labels** and **miniatures**, placed anywhere at any size. A map is just a large image.
- No grid, fog, walls, templates, ruler or combat. Longer reading stays in [handouts](party-board.md). Battle scenes don't change.

## 2. Scope

- Records `overview` and `overview-item`; intents `ovw.*`; signal `ovw.drag`.
- Overviews in the Scenes window: create, rename, folder, duplicate, delete, Show to players.
- A new canvas for both clients with pan, zoom, Fit, ping, laser and pull.
- Editing: select, group move, resize, stack, lock, hide and reveal, duplicate, delete.
- Place labels with text and dot styling. Miniatures with **Add party**, **Add miniature** and player moves.
- Fixtures and bundles `overview-scenes`, `overview-crowd`, `overview-visual`.

## 3. Goals

- The DM adds a named place during play with one click, the name and Enter, with no settings to open.
- A map image, a hidden quest scroll and the party are on a new overview in under a minute.
- A reveal or a move reaches every player ≤ 1 s after commit; a drag preview shows live.
- Zero leaks: a player never receives a hidden item, its image ID or an overview that isn't shown.
- Every existing battle-scene, fog and combat test passes unchanged, apart from the viewed-scene seam (FR-OVW-10).

## 4. Non-goals

- Rotation, undo, free text boxes, drawing, connectors, or clicking a label to open a handout.
- Tokens on overviews: a miniature has no creature, HP, vision, conditions or initiative.
- Combat on an overview, or converting a battle scene into one (make a new overview and pick the same image).
- Higher image resolution: the 4096 px cap stays ([FR-ASSET-05](assets-pipeline.md#6-functional-requirements)).

## 5. User stories

**DM**
- As the DM, I want the Sword Coast as an open canvas with my miniatures and place names, so I don't fight a grid I never use.
- As the DM, I want to add "Thundertree" with a dot as the party discovers it, so the map grows during play.
- As the DM, I want a white dot with a black ring, so a place stands out on a busy map.
- As the DM, I want to place a quest scroll hidden and reveal it when the party gets the quest.
- As the DM, I want to drag the whole party across the map at once.

**Player**
- As a player, I want to move my own miniature on the map.
- As a player, I want to see places and images appear as the DM reveals them, and zoom in to read them.

## 6. Functional requirements

Campaign = `env.actor.campaignId`; IDs and time from `env.ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). Every command is one transaction with its event-log row, except moves (FR-OVW-17). **Units**: 1 unit = 1 px at 100 % zoom. Numbers marked *(proposed)* are decided ([OQ-OVW-02](#15-open-questions)); measure at build.

### 6.1 Overview records and Show

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-01 | `ovw.create {name, folderId?}`: name as [FR-MAP-01](scenes-map.md#6-functional-requirements) (trimmed, 1–60, no control chars, not unique). No map, grid or fog. Not shown. ≤ 50 per campaign *(proposed)*, else `conflict`. | |
| FR-OVW-02 | `ovw.update {overviewId, name?, folderId?}`: rename, move to a folder or the root. Folders are the existing scene folders; a folder delete moves its overviews to the root, as it does scenes ([FR-MAP-02](scenes-map.md#6-functional-requirements)). | |
| FR-OVW-03 | `ovw.duplicate {overviewId}`: "‹name› (copy)" cut to 60, same folder, not shown, every item copied with new IDs. | |
| FR-OVW-04 | `ovw.delete {overviewId}`: items go with it. A shown overview → `conflict` "Show something else first". | As [FR-MAP-05](scenes-map.md#6-functional-requirements) |
| FR-OVW-05 | `ovw.show {overviewId}`, one transaction: the active scene (if any) off, the shown overview (if any) off, target on, `sceneHooks.deactivated` for the scene that went off. Already shown → no event. Event `OverviewShown`; the cache refreshes before listeners run; every player of the campaign resyncs. | ADR Decision 3 |
| FR-OVW-06 | `map.activateScene` turns a shown overview off in its transaction (an `activated` line in `sceneHooks`). At most one of scene and overview is shown per campaign, always. | |
| FR-OVW-07 | The active-scene resolver of the record registry returns the shown overview's ID when one is shown. `activeSceneOf(tx, cid)` stays battle-only: null while an overview is shown. | ADR Decision 2 |
| FR-OVW-08 | `overview` and `overview-item` are `scope: "scene"`, `sceneOf` = the overview's ID. Item rows use `dmWindow: "active-scene"`: the DM snapshot holds the shown overview's items, others load with `sync.loadScene`. | [ADR-0041](../architecture/adr/0041-active-scene-window.md) |

### 6.2 Canvas and Scenes window

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-09 | **Player base:** the shown overview, else today's `PlayerMapBase`. A new `OverviewCanvas`, lazily loaded; `MapCanvas` is not changed. | ADR Decision 4 |
| FR-OVW-10 | **DM view order:** a requested overview, a requested scene, the shown overview, the active scene, the first scene in list order, the shell's empty state. While an overview is viewed, every reader of the viewed scene gets null, so battle tools, Encounters Start, creature drops and View as switch off through `view-state.ts`. A viewed overview that isn't shown gets the "Not shown to players" badge, and ping, laser and pull are off, as [FR-MAP-08](scenes-map.md#6-functional-requirements). | |
| FR-OVW-11 | Pan and zoom as [FR-MAP-12](scenes-map.md#6-functional-requirements): wheel about the pointer, 10–400 %, per client, never sent. Left-drag on empty canvas or on an item the user can't move pans; middle-drag always pans. | |
| FR-OVW-12 | **Fit** frames every item the viewer has inside the free area (the part no window covers; no room is kept for toasts, #406). Runs when an overview first opens on a client and on the Fit button; adding or moving items never moves the camera. No items → origin at 100 %. | |
| FR-OVW-13 | **Tools:** Select, Add image, Label, Add party, Add miniature (DM); ping and laser (both); Fit, Pull (as battle scenes). No grid, ruler, walls, fog or templates. Ping, laser and pull reuse their signals with the overview's ID as `sceneId`. | |
| FR-OVW-14 | **Scenes window:** overviews sit in the same list and folders as scenes, with an Overview mark. **New** offers Battle scene or Overview. Row actions: Show, Rename, Duplicate, Move, Delete. Clicking a row views it. Players get no list. | FR-MAP-51 |

### 6.3 Editing items (DM)

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-15 | **Position:** `x, y` anywhere within ±16384 units, 2 decimals. No map to overlap. ≤ 300 items per overview, ≤ 3,000 per campaign *(proposed)*, else `conflict`. | §12 |
| FR-OVW-16 | **Select:** click, Ctrl- or Shift-click, Ctrl- or Shift-drag on empty canvas for a box; Esc or an empty click clears. A locked item is not dragged or box-selected: a left-drag on it pans, so a locked map stays out of the way. Right-click still opens its menu. Client only. | As [FR-MAP-31, -32](scenes-map.md#6-functional-requirements) |
| FR-OVW-17 | **Move:** `ovw.moveItems {overviewId, moves: [{itemId, x, y}]}`, 1–50 items, all or nothing. Event `OverviewItemsMoved`, not logged, as `TokenMoved`. | |
| FR-OVW-18 | **Group move:** dragging any selected item moves every selected unlocked item, one intent on drop. | |
| FR-OVW-19 | **Stack:** bands images < labels < miniatures, so a later map can't cover the party. New items go on top of their band. To front and To back act within the band. Order by `z`, then `seq`. | ADR Decision 5 |
| FR-OVW-20 | **Hide and reveal:** a hidden item is drawn for the DM with `visibility.hidden` styling and an eye-off icon. Place actions have an **Add hidden** switch, remembered per browser. | |
| FR-OVW-21 | **Menu and keys:** Hide / Reveal, Lock / Unlock, To front / To back, Duplicate, Delete, plus each kind's own. Delete and Ctrl-D act on the selection, canvas focused. Deleting more than one item asks first; one doesn't, as tokens. Intents `ovw.updateItems`, `ovw.duplicateItems`, `ovw.deleteItems`. | |

### 6.4 Images

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-22 | **Add image:** the asset picker, `context="map"`, then `ovw.placeImage {overviewId, assetId, x, y, w, h, hidden?}` through `assets.require`. On an empty overview it lands at its display size and the camera fits. Otherwise it lands in the view's centre, its long side half the view's. | |
| FR-OVW-23 | **Never cropped:** corner handles keep the image's shape, 8–16384 units per side. **Image…** in the menu swaps the picture, keeping the width and taking the new shape. | |
| FR-OVW-24 | The server checks size bounds only; keeping the shape is the client's job. No caption: a name goes on a label. | |

### 6.5 Place labels

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-25 | **Add:** Label tool, click the canvas, type, Enter → `ovw.placeLabel {overviewId, x, y, text, style, hidden?}`. Esc cancels. The tool stays on for the next label. The field is a DOM input over the canvas. | Goal 1 |
| FR-OVW-26 | **Text:** clean, one line, 1–80 chars. Double-click or menu **Edit text** changes it. | |
| FR-OVW-27 | **Style** (strict zod): `font` ∈ `fell` · `garamond` · `alegreya`; `size` 8–512; `color`, `strokeColor` `#rrggbb`; `strokeWidth` 0–32; `dot {on, size 2–256, color, strokeColor, strokeWidth 0–32}`. 0 = no stroke. Default: Garamond 28, white text with a 2-unit black stroke, dot on, size 12, white with a 2-unit black stroke. | Decided |
| FR-OVW-28 | **Style panel:** beside the Label tool, and for selected labels (one or many). A change previews locally and commits once, on release or on closing the colour picker. **The last style used is kept per browser per campaign**, and every new label takes it. | |
| FR-OVW-29 | **Layout:** `x, y` = the dot's centre, text to its right, vertically centred. Dot off: `x, y` = the text's left middle. Drag moves both together. | |
| FR-OVW-30 | **Scale:** text and dot are in units, so they shrink with the map. No minimum screen size, no hiding by zoom. The three fonts come from `themes/fonts.css`, and the canvas redraws once they have loaded. | Decided |

### 6.6 Miniatures

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-31 | **Add party:** `ovw.addParty {overviewId, x, y, size}`: one miniature per party character (the list Start uses, `partyOf`) not yet on this overview, in a row around `x, y`. Name, image and owner come from the character. None missing → no event, and the client toasts "Everyone is already here". | |
| FR-OVW-32 | **Add miniature:** the asset picker, then a name (0–40, optional) and an owner (optional): `ovw.placeMiniature {overviewId, assetId, x, y, size, text?, ownerPlayerId?, hidden?}`. For NPCs, ships, a "The Party" marker. | |
| FR-OVW-33 | **Character link:** a party miniature keeps `characterId`. Through a definition-changed hook, a change to the character's name, art or owner follows in the same transaction. **Name and Image… are off on a linked miniature.** | Unlike tokens ([#126](../decisions-log.md)): DM's choice |
| FR-OVW-34 | **Size and look:** starts 64 px on screen at the placer's zoom (`size` = 64 ÷ zoom), then handles, 8–4096 units, square. Shape round, square or none, as [FR-MAP-35](scenes-map.md#6-functional-requirements). No image → token art, as battle tokens. Shrinks with the map. | |
| FR-OVW-35 | **Who moves:** a player may move a miniature iff `ownerPlayerId` is theirs, it isn't hidden and its overview is shown. Hidden, on an overview not shown or unknown → `not_found`; visible but not theirs → `forbidden`. Moves only. The DM moves any. | As [FR-MAP-21](scenes-map.md#6-functional-requirements) |
| FR-OVW-36 | **Name:** under the miniature, centred, drawn with the label text style fields (`font`, `size`, `color`, `strokeColor`, `strokeWidth`). Same style panel, without the dot. Default size = 14 ÷ the placer's zoom, clamped 8–512 (#406). Drawn whole however wide. | |
| FR-OVW-37 | **Live drag:** signal `ovw.drag {overviewId, moves ≤ 50} \| {overviewId, itemIds, end}`, at most one frame per 50 ms, as [FR-MAP-39](scenes-map.md#6-functional-requirements). No DB, log or `seq`. Audience hook: a player sender per FR-OVW-35; a frame holding any hidden item, or on an overview not shown, goes to the DM only. | ADR-0026 |
| FR-OVW-38 | **Between overviews:** miniatures stay where they are. **Add party** on the next overview adds who's missing. | |

### 6.7 Visibility

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-39 | Player receives: the shown overview as `{id, campaignId, active}` (no name, folder or `seq`); that overview's non-hidden items minus `locked`. Reveal = `upsert`, hide = `delete`. Everything else → hidden. | Through the scene gate |
| FR-OVW-40 | **No leak:** a hidden item, its `assetId`, its text and its drag frames never reach a player in a snapshot, a frame, an ack or a `sync.loadScene`, before or after a reveal, a Show or a reconnect. | [FR-ASSET-12](assets-pipeline.md#6-functional-requirements) |
| FR-OVW-41 | Showing an overview removes the battle scene's rows from every player, and the reverse, by resync. | |

### 6.8 Battle scenes, assets

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-42 | A running fight continues while an overview is shown, as on a scene switch ([CBT §11](combat-tracker.md#11-edge-cases--failure-modes)): Initiative, rolls and cards work; no token is drawn. | Tested first, ADR risk |
| FR-OVW-43 | Encounters **Start** is off while the DM views an overview, with "Open a battle scene first". The DM may open a battle scene without showing it and start there, as today. A `cbt.start` with an overview ID → `not_found`. | Start uses the viewed scene ([FR-CBT-07](combat-tracker.md#6-functional-requirements)) |
| FR-OVW-44 | `sceneHooks` gains `deactivated(env, scene)`. Entities re-derive `petPresent` on it, so pets follow the "no battle scene" state. | [FR-ENT-37](entities.md#6-functional-requirements) |
| FR-OVW-45 | Asset use kind `overview image`: an item's `assetId` blocks an image's delete and appears in **Used in**, as [FR-ASSET-64](assets-pipeline.md#6-functional-requirements). | |

### 6.9 Fixtures and failure

| ID | Requirement | Notes |
|---|---|---|
| FR-OVW-46 | Fixture units `fixtures/units/overview-scenes/`: `ovw-sword-coast` (shown; locked map from `map-large.svg`, three styled labels, one hidden; hidden scroll; party miniatures), `ovw-phandalin` (not shown; `town.svg`), `ovw-crowd` (not shown; 300 items, 200 of them labels; walkthrough step 12 only). Bundle `overview-scenes` = `scenes` + the first two, with `player-1` and `player-2`; `overview-crowd` = that + `ovw-crowd`; `overview-visual` = `overview-scenes`, for the screenshots (#406). | [§9.3](../../AGENTS.md#93-fixtures) |
| FR-OVW-47 | **Reconnect:** the snapshot carries the shown overview and its items; a drag in progress on the dropped connection snaps back, unsent. A preview from a dropped sender ends as `map.drag` does. While not `live`, editing is off; pan, zoom, selection and viewing still work, as [FR-MAP-28](scenes-map.md#6-functional-requirements). | |
| FR-OVW-48 | **Crash:** each command is one transaction, so nothing or everything of a Show, a group move or an Add party survives. After a restart the cache rebuilds from the DB. Previews are never stored. | |

## 7. UI/UX notes

Reference [visual-direction](../design/visual-direction.md): the canvas is the hero. Panels and menus use the existing kit; only label and miniature text carries the DM's own colours.

- **Screens:** `OverviewCanvas`; the tool rail in its overview set; the label style panel; rows in the Scenes window.
- **States:** empty overview: "Add an image to begin" (DM), a plain canvas (player). Loading: as the map's scene load. Disconnected: FR-OVW-47. Missing image: the asset error tile, as props.
- **DM view:** everything in FR-OVW-13–36. Hidden items in hidden styling. Tool panels make room as [FR-MAP-60](scenes-map.md#6-functional-requirements) does.
- **Player view:** pan, zoom, Fit, ping and laser. Their own miniatures drag; nothing else responds. No menus, no selection, no list of overviews. A viewer who wants to read an image zooms in; the DM can also [Present](party-board.md#6-functional-requirements) the same image as a handout.
- **Windows:** the window placer sees no tokens on an overview, so it won't steer around miniatures in this version.
- **Test IDs:** `ovw-<area>-<element>`, repeated records with `data-record-id`; canvas nodes `name` = test ID, `id` = item ID ([§9.5](../../AGENTS.md#95-test-ids)). E.g. `ovw-item`, `ovw-label-input`, `ovw-style-font`, `ovw-add-party`, `ovw-scene-row`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Overview | id, campaignId, folderId, seq | ID, ID → Campaign, ID → SceneFolder \| null, int | |
| | name | text 1–60 | |
| | active | bool | Partial unique index per campaign |
| | createdAt, updatedAt | ISO | |
| OverviewItem | id, campaignId, overviewId, seq, z | ID, ID, ID → Overview (cascade), int, int | |
| | kind | `image` \| `label` \| `miniature` | |
| | x, y | real | ±16384, 2 dp |
| | w, h | real \| null | Null on labels |
| | hidden, locked | bool | `locked` DM only |
| | assetId | ID → Asset \| null | Asset reference; required on images |
| | text | text \| null | Label text or miniature name |
| | style | JSON leaf \| null | FR-OVW-27; miniature: no `dot` |
| | characterId | ID → Entity \| null | Miniature link |
| | ownerPlayerId | ID → Player \| null | Miniature only |
| | shape | `round` \| `square` \| `none` \| null | Miniature only |
| | createdAt, updatedAt | ISO | |

- **Relations:** one overview, many items. A character, many miniatures (one per overview by rule, FR-OVW-31). Characters can't be deleted today ([FR-ENT-14](entities.md#6-functional-requirements)); should that change, the delete path must handle miniatures.
- **Derived values:** a label's box (measured by the client, for hits and Fit); the party's missing list.
- **Persisted runtime state:** which overview is shown (`active`). Client only: selection, last label style, Add hidden, camera, drag previews.

## 9. API & events

**REST (Hono RPC):** none. Uploads use the existing asset route.

**WS intents (client → server)**

| Intent | Who | Validation / ownership |
|---|---|---|
| `ovw.create`, `ovw.update`, `ovw.duplicate`, `ovw.delete`, `ovw.show` | DM | FR-OVW-01–05 |
| `ovw.placeImage`, `ovw.placeLabel`, `ovw.placeMiniature`, `ovw.addParty` | DM | Bounds, caps, `assets.require`; owner is a player of the campaign |
| `ovw.updateItems`, `ovw.duplicateItems`, `ovw.deleteItems` | DM | All items on one overview of the campaign; ≤ 50 |
| `ovw.moveItems` | DM; player per FR-OVW-35 (one item) | Bounds; a locked item → `conflict` |

**Signals:** `ovw.drag` (DM, player; FR-OVW-37). `map.ping`, `map.laser`, `map.pull` unchanged.

**WS events (server → client)**

| Event | Payload | Visibility rule |
|---|---|---|
| `OverviewCreated`, `OverviewUpdated`, `OverviewDuplicated`, `OverviewDeleted` | `{overviewId}` | DM; players only through the scene gate (an overview not shown stays hidden) |
| `OverviewShown` | `{overviewId, previousSceneId, previousOverviewId}` | DM by `changes`; players by resync |
| `OverviewItemsPlaced`, `OverviewItemsUpdated`, `OverviewItemsDeleted` | `{overviewId, itemIds}` | Per item: FR-OVW-39 |
| `OverviewItemsMoved` | `{overviewId, itemIds}`, not logged | Per item: FR-OVW-39 |

None is undoable.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create, edit, duplicate, delete, show overviews | Yes | No | Role |
| Place, style, resize, stack, lock, hide, delete items | Yes | No | Role |
| Move any item | Yes | No | Role |
| Move own miniature on the shown overview | Yes | Yes | FR-OVW-35 |
| Ping, laser | Yes | Yes | Role; receiver compares IDs |
| Pull view | Yes | No | Role |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** FR-OVW-47. Their miniature stays; the DM can move it.
- **DM disconnect / reconnect:** same snapshot rules; selection and tool are kept; an unsent label field stays in the DOM until sent or cancelled, and Enter is off while not `live`.
- **Server crash mid-action:** FR-OVW-48.
- **Concurrent edits:** last write wins. A player drops a miniature just as the DM hides it, or as the shown thing changes → `not_found`, it snaps back. Two DM tabs: same.
- **Invalid / malicious input:** strict zod on everything. Another campaign's asset or item → `not_found`. A player sending another's item → `forbidden`; DM-only intents → `forbidden`. A forged `sceneId` on ping reaches only clients showing that ID.
- **Character with no owner:** its miniature has no owner, DM-moved only.
- **Asset deleted:** blocked while in use (FR-OVW-45).
- **Fight on, overview shown:** FR-OVW-42. Summons and other token-making actions target the encounter's scene and behave as on a switched scene.

## 12. Performance & bandwidth

- Item row: label 594 B, image 436 B, widest 684 B (measured): 300 items ≈ 165 KB, in the DM snapshot only for the shown overview, and in place of the battle scene's tokens and props. Overview rows ≈ 200 B each, ≤ 50 ≈ 10 KB. Test `FR-OVW-08 CON-44` measures both against the [CON-44](../protocol/README.md#11-conflicts-log) ceilings (DM 1.5 MiB since #256, players 512 KiB; measured at 300 items: DM 185 KB, player 137 KB).
- A drag frame ≤ 50 × ≈ 60 B, ≤ 20 per second, DM group drags only at that size; a player's frame ≈ 100 B.
- Images are the existing `display` files (long edge ≤ 4096 px), served with the existing cache. A region map over the tunnel costs what a battle map costs.
- Canvas: pan and zoom stay smooth at 300 items with 200 stroked labels. Checked in walkthrough step 12; if not, cache the static items in one Konva layer, as the map does.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)). Agent build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

| Level | What | Fixtures |
|---|---|---|
| Unit | Input bounds, style zod, band order, Fit box, DM view order, label layout, miniature size from zoom | — |
| Integration | Show both ways; resolver and `activeSceneOf` values; visibility per record DM vs player; `FR-OVW-40 leak scan` over snapshot, frames, loads and drags; a fight, a pet and a roll with an overview shown; group move all-or-nothing; Add party twice; character edit follows; `FR-OVW-08 CON-44`; crash at `ovw.show:before-commit` and `after-commit` (`PP_TEST_CRASH`) | `overview-scenes` |
| E2E (thin) | `e2e/overview-scenes.e2e.ts`: DM shows, player follows; reveal; label added and styled; player drags own, not another's; Show a battle scene and back; Start off on an overview. `e2e/visual-overview.e2e.ts` holds the overview shots | `overview-scenes` |

**Browser walkthrough** (test agent; `pw-dm` = A, `pw-player-1` = B, `pw-player-2` = C): `bun run build`, `bun run fixtures:reset-load overview-scenes --profile verify`, `bun run start --profile verify`.

| # | Step | Expected |
|---|---|---|
| 1 | B, C open their links | Sword Coast, no grid, no hidden scroll or hidden label |
| 2 | A: Scenes window | Overviews and battle scenes in one list, Sword Coast marked live |
| 3 | A: left-drag on the locked map | Pans; the map doesn't move |
| 4 | A: Label tool, click, "Thundertree", Enter; again "Conyberry" | Both on B and C ≤ 1 s; second has the first's style |
| 5 | A: select both, white dot, black ring, IM Fell | Both change for everyone; zoom out and they shrink |
| 6 | A: Reveal the scroll | Appears on B and C, uncropped |
| 7 | B: drag own miniature; drag C's | Own: C and A see it move live, it stays. C's: pans instead |
| 8 | A: box-select the party, drag | All move together on every client |
| 9 | A: Phandalin row → view, not shown | Badge; ping off; Encounters Start off with the hint; B unchanged |
| 10 | A: Add party on Phandalin, again | Party placed; second press toasts "Everyone is already here" |
| 11 | A: Show a battle scene, start a fight, Show Sword Coast | Players follow each time; fight continues in Initiative; rolls work |
| 12 | A: `fixtures:reset-load overview-crowd`, pan and zoom; B reconnects | Smooth; B has the same picture, no hidden item in its records |

Evidence under `.verify/<run-id>/`. Teardown: stop, `bun run fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [scenes-map](scenes-map.md) | Scene gate, Scenes window, folders, signals, `view-state.ts` | Built; changes below |
| [assets-pipeline](assets-pipeline.md) | `assets.require`, picker, use kinds | Built; one kind added |
| [entities](entities.md) | Definition-changed hook registry, `petPresent` | Built; one line each |
| [combat-tracker](combat-tracker.md) | `partyOf`; Start reads the viewed scene | Built; no change |
| [ADR-0075](../architecture/adr/0075-overview-scenes.md) | Decisions 1–5 | Accepted (#398) |

**Build split:** worktrees from `origin/main`, one after the other up to Images; Labels and Miniatures may run in parallel.

| Slice | Branch | Delivers | Shared files (orchestrator assigns) |
|---|---|---|---|
| Core | `fix/ovw-core` | Tables, records, commands for overviews and items, Show both ways, resolver, visibility, hook member, asset kind, fixtures; docs/data-model and docs/protocol | `src/server/db/`, `src/shared/events/`, `active-scene.ts`, `scene-hooks.ts`, `scenes-map/index.ts`, folder delete |
| Canvas | `build/ovw-canvas` | Canvas for both clients, camera, Fit, tool rail set, Scenes window, DM view order, ping, laser, pull | `DmMap.tsx`, `PlayerMap.tsx`, `view-state.ts`, `scenes-window.tsx` |
| Images | `build/ovw-images` | Select, move, group move, resize, stack, lock, hide, images | — |
| Labels | `build/ovw-labels` | Label tool, style panel, fonts | — |
| Miniatures | `build/ovw-minis` | Add party, Add miniature, link hook, player move, `ovw.drag` | Entities' hook registry (append) |

A slice merges after its targeted `bun run check` and its own walkthrough steps pass; step 12 closes the feature.

## 15. Open questions

All decided at spec review ([#398](../decisions-log.md)): every bold pick accepted.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-OVW-01 | Accept the [ADR](../architecture/adr/0075-overview-scenes.md)? | **Accept** / change a decision | decided | All |
| OQ-OVW-02 | Caps: 50 overviews per campaign, 300 items per overview, 3,000 per campaign, 50 per group action | **As written** / other numbers | decided | §6, §12 |
| OQ-OVW-03 | Glossary: add **Overview**, **Overview item**, **Place label**, **Miniature**; **Scene** and **Active scene** gain a note that an overview can be what's shown | **Add** / other names | decided | Glossary, integrator |
| OQ-OVW-04 | Label text always right of the dot. Later a left or below option? | **Right only for now** / add now | decided | FR-OVW-29 |
| OQ-OVW-05 | Picker context for overview images: existing `map` tags new uploads "Maps", scrolls included | **`map`** / new "Overviews" tag | decided | FR-OVW-22, assets-pipeline |

## 16. Out of scope

- §4's list. Clicking a label to open a handout comes first if the DM misses it.
- Dragging creatures from the Creatures window onto an overview; use Add miniature.
- A staging preset for battle scenes: no longer needed.
- Moving a party between overviews in one action: Add party does it.
