---
title: Scene tools
prefix: SCN
status: in-review
owner: spec-scene-tools
phase: post-mvp-2
---

# Scene tools

## 1. Summary

- Battlemap **props and structure** on the [scenes-map](scenes-map.md) canvas (sprint 2 track B, #187): a **layer model** (map / objects / tokens / DM-only), **walls and doors** that block player token moves, **AoE templates** (cone, sphere, cylinder, cube, line), image **props** from the [asset pipeline](assets-pipeline.md), and the **diagonal rule** as a campaign setting.
- Movement only: walls never affect vision, light or fog ([ADR-0007](../architecture/adr/0007-product-scope.md)). Fog of war is its own spec (FOG); this spec owns the layer model fog registers into and exposes what fog's filter needs (§14).
- Hard constraint: the DM snapshot has ≈ 4.4 KiB left under CON-44. SCN records are windowed to the active scene and packed; with effect presets on demand and fog, the combined heavy DM figure is ≈ 779 KB of 786.4 KB (§12, [OQ-SCN-01](#15-open-questions), seam S1).

## 2. Scope

- **Layers:** the four layers, render order, DM view toggles; DM-only = the existing `hidden` flag on each record (tokens unchanged).
- **Structure:** walls and doors as segments between grid vertices; doors open / closed / locked (DM); player moves across a wall or a non-open door are refused server-side; the DM always moves through. Client-side undo of DM drawing.
- **AoE templates:** five shapes, snapped to the grid, affected squares shown; placed by the DM and players *(carried pick, OQ-SCN-03)*; ephemeral by default, **Keep** makes one persistent *(OQ-SCN-02)*.
- **Props:** DM-placed images on the objects layer, cell-snapped, 90° rotation.
- **Diagonal rule:** campaign setting, 5/10/5 (default, #145) or 5 ft *(carried pick, OQ-SCN-04)*.
- *(proposed)* DM "Select creatures inside" on a template (feeds combat's target selection; no automation).

## 3. Goals

- The DM preps Goblin Ambush (walls, two doors, barrel, table, a hidden chest) in the UI in minutes, without leaking anything hidden.
- A player can't walk through a wall or a closed door, and is told why; the DM is never blocked.
- Everyone sees a spell's area and the squares it covers, live, ≤ 1 s.
- Fits CON-44 with room left for fog; nothing persisted is lost on a hard kill.

## 4. Non-goals

- Vision, lighting, line of sight, fog by walls ([ADR-0007](../architecture/adr/0007-product-scope.md)); freehand drawing (#21).
- Automatic AoE damage, saves or target lists ([combat-extras](combat-extras.md) multi-target is out); speed enforcement (#145: indicators only).
- Props that block movement, overhead props above tokens, free rotation / sizing *(OQ-SCN-10)*.
- Map pins (tier B), player-ready indicator, scene preload, server-side (event-log) undo (ADR-0016 unchanged).

## 5. User stories

**DM**
- As the DM, I want to trace the walls and doors of a battlemap once, so that players can't walk through them and I stop policing moves.
- As the DM, I want to lock a door without players seeing it's locked, and open it with a double-click mid-fight.
- As the DM, I want to drop barrels, tables and a hidden chest from my uploads and reveal the chest later.
- As the DM, I want to undo my last few drawing steps.

**Player**
- As a player, I want to place a Fireball sphere and see who's in it before I commit, then clear it.
- As a player, I want a refused move to tell me a wall is in the way.

## 6. Functional requirements

Units: **vertex** = grid intersection `(x, y)`, integers, map space `offset + x × cellSize`; **cell** `(col, row)` as [FR-MAP-14](scenes-map.md#6-functional-requirements). 1 cell = 5 ft. Everything is stored in grid units, so recalibration ([FR-MAP-10](scenes-map.md#6-functional-requirements)) moves SCN content with the grid.

| ID | Requirement | Notes |
|---|---|---|
| **Layers** | | |
| FR-SCN-01 | Four **layers**, render order bottom → top. **map**: map image, grid (MAP). **objects**: props, AoE templates, walls and doors. **tokens**: tokens, labels (MAP). **DM-only**: not a canvas layer; any token, prop or template with `hidden = true`, plus every wall. Fog (FOG) renders above props and structure, below templates and tokens (follow-up ruling 1). | Settled S6 |
| FR-SCN-02 | Canvas layer order (registry slots): map 0, grid 10, `scn-props` 20, `scn-structure` 26, *fog 30 (FOG)*, `scn-templates` 35 (above fog: a DM template under fog is filtered server-side, a player's own stays visible), tokens 40, labels 45, `scn-edit` 48 (DM drawing previews, handles), pointers 50. | §14 seam |
| FR-SCN-03 | **Layer registry** (existing, append-only, `src/client/common/features/scenes-map/canvas-layers.ts`): SCN owns the entry shape `LayerDef {id, order, component, clients?: ("dm" \| "player")[] (default both), toggle?: {key, label, layer: "objects" \| "tokens" \| "dm-only" \| "fog"}}`, typed in `layers.ts`. Duplicate id or order throws at load (as built). FOG adds one line. | OQ-SCN-11, OQ-SCN-12 |
| FR-SCN-04 | **DM-only = `hidden`**: tokens keep [FR-MAP-19](scenes-map.md#6-functional-requirements) (no new token field); props and templates get the same flag and the same styling (`visibility.hidden`, eye-off). Players never receive a hidden record. | Reconciles #76 |
| FR-SCN-05 | **Layers popover** (DM tool rail): one Switch per registered `toggle` (Walls & doors, Props, Templates, DM-only items; FOG may add Fog). Off = not drawn and not hit on this DM client. Client only, never sent; `localStorage` per campaign; default all on. | |
| FR-SCN-06 | **Canvas tool registry** (new, append-only, `src/client/common/features/scenes-map/canvas-tools.ts`): `{id, label, icon, clients, order, panel?}` adds tool-rail entries; a tool's pointer handling lives in its layer component (reads the active tool). SCN adds Structure, Props (DM), AoE (both); FOG adds its tools. While any drawing tool (SCN or FOG) is active, Space + drag pans. | Settled S6 |
| **Structure** | | |
| FR-SCN-07 | **Structure** = one record per scene: `walls [n, x1, y1, x2, y2][]`, `doors [n, x1, y1, x2, y2, state][]`, `state` 0 open / 1 closed / 2 locked; `n` unique per scene, from `nextN`. Segment: vertex to vertex, any angle, length > 0, endpoints within the map's vertex range ± 1; identical segments (either direction) dedupe. ≤ 2,000 segments per scene, else `conflict`. | Compact on purpose (§12) |
| FR-SCN-08 | **Structure tool** (DM), modes Wall · Door · Erase. Wall: click vertices (pointer snaps to the nearest vertex) to draw a polyline; double-click ends it, Esc cancels; on end one `scn.addWalls` (≤ 200 segments). Door: two clicks → `scn.addDoor` (closed). Erase: click within 8 px of a segment, or Ctrl/Shift-drag a box (segments fully inside) → `scn.removeSegments`. | |
| FR-SCN-09 | **Door state** (DM): `scn.setDoor {sceneId, n, state}`. Door menu (right-click): Open, Close, Lock, Unlock, Delete. Double-click a door with the Select tool toggles open ↔ closed (locked stays locked). Players can't change doors *(OQ-SCN-07)*. | |
| FR-SCN-10 | **Blocking rule:** a **player's** `map.moveToken` is refused iff the straight segment between the footprint centres of `from` and `to` intersects or touches any wall or any door with state ≠ open (collinear overlap counts). Integer math on doubled coordinates. DM moves are never checked. | OQ-SCN-05 |
| FR-SCN-11 | The check runs as a **move guard** in `map.moveToken`'s transaction. Order (S4): **guards** (may refuse) → write → FOG's `derive` (`fogged`) → token-changed hooks. The guard reads only the scene's structure row (an in-memory cache keyed by `(sceneId, rev)` is allowed). Refused → `reject conflict` "Blocked by a wall or door" (same text for wall, closed, locked); no write, no event, no hook, no `movedFt`. | [proposed ADR](../architecture/adr/proposed-token-move-guards.md) |
| FR-SCN-12 | **Player cue:** on that reject the client reverts (FR-MAP-15), shows the Toast and flashes the target cell (`accent.danger`, 1 s). | |
| FR-SCN-13 | **DM hint:** while the DM drags a token across a blocking segment, the movement label adds "· through wall" and the crossed segments highlight; the drop still sends. Local only. | Needs MAP drag state (§14) |
| FR-SCN-14 | **Drawing:** DM sees walls as lines (`accent.primary`), doors as a door glyph per state, locked with a lock glyph. Players see doors only: open or closed (locked is sent as closed); never walls. | OQ-SCN-06 |
| FR-SCN-15 | **Undo** (DM, client only): per scene, the last 50 structure and prop edits made in this tab; Undo button in the tool panel and Ctrl+Z while a SCN tool is active *(proposed)*. Undo sends the inverse intent (add ↔ remove with the same coordinates, previous door state, previous prop fields, re-place a deleted prop). A rejected inverse drops that entry + Toast. Lost on reload. Not ADR-0016 undo. Fog's undo is server-side by design (one mask vs many SCN records; S7); no shared helper. | OQ-SCN-08 |
| **Props** | | |
| FR-SCN-16 | **Place** (DM, Props tool): pick an image in the asset picker ([FR-ASSET-17](assets-pipeline.md#6-functional-requirements)), click a cell → `scn.placeProp {sceneId, assetId, col, row, w?, h?, hidden?}`; `assets.require`; default 1 × 1; footprint must overlap the map. ≤ 200 per scene, ≤ 2,000 per campaign, else `conflict`. | |
| FR-SCN-17 | **Edit** (DM, Props tool): click selects one prop; drag moves (cell snap); handles resize (1–20 cells per side). Menu: Rotate 90°, Hide / Reveal, Lock / Unlock, To front / To back, Duplicate, Image…, Delete. Intents `scn.updateProp`, `scn.setPropHidden`, `scn.duplicateProp`, `scn.deleteProp`. Locked: no move or resize (menu works). | OQ-SCN-10 |
| FR-SCN-18 | **Draw:** `display` image cover-fitted to the `w × h` footprint (90° / 270° swap the drawn sides), rotated about its centre; order `z`, then `seq`. With any tool but Props, props take no pointer events (a drag on one pans). Props never block moves and never enter the fit's content box ([FR-MAP-44](scenes-map.md#6-functional-requirements)). | |
| FR-SCN-19 | **Visibility:** `hidden` or fog-hidden (FR-SCN-35) → hidden; else redacted (no `locked`). The `assetId` reaches a player only on a visible prop; reveal = `upsert` ([FR-ASSET-12](assets-pipeline.md#6-functional-requirements)). | |
| **AoE templates** | | |
| FR-SCN-20 | **Shapes:** origin at a vertex. Sphere / cylinder: radius `size`. Cube: square of side `size`, origin = a corner, axis-aligned, `angle` picks the quadrant (0 / 90 / 180 / 270). Cone: length `size`, width at any distance = that distance (5e), direction `angle`. Line: length `size`, width `width` (default 5 ft), direction `angle`. `size` 5–300 ft step 5; `width` 5–60 step 5; `angle` 0–345 step 15. | |
| FR-SCN-21 | **Affected squares:** cells whose centre lies inside or on the shape, cut to the map; pure `templateCells(template, scene)` in `@shared/scene-tools/geometry`. Drawn tinted; label "‹label› · N squares" at the origin. | OQ-SCN-09 |
| FR-SCN-22 | **AoE tool** (DM, players): panel = shape, size, width (line), label (0–40 chars); drag from a vertex sets direction (cone, line, cube quadrant) or size (sphere, cylinder); release → an **ephemeral** template. One per connection: a new placement replaces it; Clear or Esc removes it. | |
| FR-SCN-23 | **Ephemeral:** signal `scn.template {sceneId, key, shape, x, y, size, width?, angle, label?, dmOnly?}` / `{sceneId, key, end: true}`; ≤ 20 sends/s while dragging, repeated every 1 s at rest; receivers drop it on `end`, a snapshot, or 3 s silence. Never persisted. Placer colour = role accent (as ping). | Like `map.drag` |
| FR-SCN-24 | **Signal audience** ([ADR-0033](../architecture/adr/0033-signal-audience.md)): player sender → `sceneId` must be the active scene (else `invalid`) → `"all"`; DM sender → `"dm"` if `dmOnly`, the scene isn't active, or FOG's hook finds every cell of `templateCells` fogged (S5; FOG names the hook), else `"all"`. Player templates are never fog-hidden. Receivers draw only for the scene they show. | |
| FR-SCN-25 | **Keep:** the template panel's Keep turns the ephemeral into a record: `scn.placeTemplate` (same fields, `hidden` = `dmOnly`), then `end`. ≤ 20 per scene, ≤ 3 per player per scene, else `conflict`. A player's `sceneId` must be the active scene. | OQ-SCN-02 |
| FR-SCN-26 | **Persistent edits:** placer (`placedByPlayerId = ctx.playerId`) or DM: move (drag the origin), rotate / resize (panel), Delete → `scn.updateTemplate`, `scn.deleteTemplate`; DM only: Hide / Reveal (`hidden`), "Clear templates" per scene → `scn.clearTemplates`. Others' templates: no menu, not draggable. | |
| FR-SCN-27 | **Visibility:** `hidden` or fog-hidden (FOG's `hides`; never for a player-placed template) → hidden; else full (incl. `placedByPlayerId`). | S5 |
| FR-SCN-28 | *(proposed)* **Select creatures inside** (DM, template menu, ephemeral or persistent): sets the DM selection ([FR-MAP-33](scenes-map.md#6-functional-requirements)) to the viewed scene's tokens (incl. hidden and fog-hidden: the DM sees everything, S8) whose footprint overlaps an affected square; the attack popup then preselects them. No roll, no damage. | combat seam |
| **Diagonal rule** | | |
| FR-SCN-29 | Record `map-settings` per campaign `{id = campaignId, diagonalRule: "5-10-5" \| "5"}`, default `5-10-5` (#145). DM sets it in the Ruler tool's panel → `scn.setDiagonalRule`. Everyone receives it. | OQ-SCN-04 |
| FR-SCN-30 | One distance fn `distanceFt(a, b, rule)` (`@shared/scenes-map/geometry`) drives the ruler ([FR-MAP-22](scenes-map.md#6-functional-requirements)), the movement indicator ([FR-MAP-37](scenes-map.md#6-functional-requirements)) and combat's movement used ([FR-CBT-39](combat-tracker.md#6-functional-requirements), server reads the row). `5`: `5 × max(dx, dy)`. Template sizes don't use it. | combat seam |
| **Scenes, sync, lifecycle** | | |
| FR-SCN-31 | **Scene duplicate** ([FR-MAP-04](scenes-map.md#6-functional-requirements)) copies structure and props (new IDs, same `n`), not templates. **Scene delete** deletes every SCN row of the scene; all are listed in the event's `changes`. Both register in scenes-map's `sceneHooks` (create / duplicate / delete), THE scene lifecycle registry, created by `fix/fog-core` (S3). | Settled S3 |
| FR-SCN-32 | **Snapshot window:** `scene-structure`, `scene-prop`, `aoe-template` register with the active-scene DM window: the DM snapshot holds only the active scene's rows. Viewing another scene, the DM client sends `sync.loadScene {sceneId}` once per scene per snapshot; the canvas shows "Loading scene…" on SCN layers until the result lands. Live events still reach the DM for every scene. Players unchanged (scene gate). | [proposed ADR](../architecture/adr/proposed-active-scene-window.md) |
| FR-SCN-33 | Every SCN command: rows + one event-log entry in one transaction, then the event; IDs and time from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). All structure ops emit one event name, `StructureEdited`, so players can't tell a lock from a wall edit. Nothing server-undoable. | |
| FR-SCN-34 | While not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)): SCN tools disabled except the Layers popover; a polyline in progress is discarded; the ephemeral template stops sending. | |
| FR-SCN-35 | **Fog seam** (S5): fog subjects = props, DM-placed kept templates, DM-placed ephemeral signals (FR-SCN-24). Every prop / template write that sets or moves a footprint calls scenes-map's `deriveSceneObject(env, {type, sceneId, cells})` (FOG's `derive`) in its transaction and stores `fogged`; SCN's visibility fns for `scene-prop`, `aoe-template` consult `hides`. SCN exports pure `propCells`, `templateCells`. **Walls and doors are not fog subjects**: doors reach players under fog. FOG owns what fog hides. | Settled S5 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, semantic tokens only; the map is the hero.

- **Tool rail** (FR-SCN-06): DM: Structure, Props, AoE, Layers (Popover). Player: AoE. Each tool opens a small panel (Popover anchored to the rail): Structure = mode ToggleGroup (Wall · Door · Erase) + Undo; Props = "Choose image…" + Undo; AoE = shape ToggleGroup, size / width number inputs with ±5 nudges, label Input, Keep, Clear; Ruler panel (DM) gains "Diagonals" ToggleGroup (5/10/5 · 5 ft).
- **DM view:** walls, doors (glyph per state), all props and templates; hidden ones in `visibility.hidden` styling; drawing previews on `scn-edit`; selected prop has handles; "through wall" hint on drags.
- **Player view:** doors (open / closed), visible props, visible templates, own and others' ephemeral templates; the blocked-cell flash.
- **States:** empty scene → nothing extra; loading (DM, non-active scene) → "Loading scene…" chip on the canvas, tools disabled until loaded; error (prop image) → broken-image placeholder (assets-pipeline §7); disconnected → FR-SCN-34 + live-sync banner.
- **Test IDs:** `scn-tool-<structure|props|aoe|layers>`, `scn-structure-mode-<wall|door|erase>`, `scn-undo`, `scn-door-menu-<open|close|lock|unlock|delete>`, `scn-prop-menu-<rotate|hide|lock|front|back|duplicate|image|delete>`, `scn-prop-image`, `scn-aoe-shape-<cone|sphere|cylinder|cube|line>`, `scn-aoe-<size|width|label|keep|clear>`, `scn-template-menu-<select-inside|hide|delete>`, `scn-layer-toggle-<key>`, `scn-diagonal-rule` (`data-value`), `scn-scene-loading`. Konva (name = test ID, id = record ID): `scn-walls` (one shape; attr `count`), `scn-door` (id `door-<n>`, attr `state` = `open` \| `closed` \| `locked`), `scn-prop` (attr `hidden`), `scn-template` (id = record ID or `eph-<key>`; attrs `shape`, `cells`, `ephemeral`), `scn-blocked-cell`, `scn-through-wall`.

## 8. Data model

All rows per campaign; `seq` by the DB (CON-20); timestamps from `ctx.clock`. Wire records are compact (no `campaignId`, `seq`, timestamps) to save snapshot bytes; the registry reads those from the row. **JSON leaf fields** ([ADR-0006](../architecture/adr/0006-persistence.md)): `walls`, `doors`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| SceneStructure | id (= sceneId), campaignId, rev, nextN; walls; doors; updatedAt | ID → Scene (cascade), ID, int, int; **JSON** `[n, x1, y1, x2, y2][]`; **JSON** `[n, x1, y1, x2, y2, state][]`; timestamp | Created lazily on first edit; none = empty. ≤ 2,000 segments |
| Prop | id, campaignId, sceneId, seq; assetId; col, row, w, h, rotation, z; hidden, locked, fogged; createdAt, updatedAt | ID, ID, ID → Scene (cascade), int; ID → Asset (**asset reference**); int ×4 (w, h 1–20), 0/90/180/270, int; bool ×3; timestamp ×2 | ≤ 200 per scene. `fogged`: server copy from FOG's `derive`, never in an intent, on the wire only when true; always DM-placed |
| AoeTemplate | id, campaignId, sceneId, seq; shape; x, y; size, width, angle; label; placedByPlayerId; hidden, fogged; createdAt, updatedAt | ID, ID, ID → Scene (cascade), int; cone \| sphere \| cylinder \| cube \| line; int ×2 (vertex); int ×3 (width null unless line); text 0–40; ID → Player \| null (null = DM); bool ×2; timestamp ×2 | Persistent only; ≤ 20 per scene. `fogged` as Prop |
| MapSettings | id (= campaignId), diagonalRule, updatedAt | ID → Campaign; `5-10-5` \| `5`; timestamp | Row created on first set; none = `5-10-5` |

- **Relations:** Scene 1—0..1 SceneStructure; Scene 1—* Prop, AoeTemplate; Prop → Asset; AoeTemplate → Player; Campaign 1—0..1 MapSettings.
- **Derived:** segment geometry, door `open` for players, `propCells`, `templateCells`, distance per rule.
- **Client only:** ephemeral templates `key → {from, template, lastAt}` (receivers), undo stacks, layer toggles, loaded-scenes set, prop selection, polyline in progress.
- **Persisted runtime state:** door states, props, persistent templates, the diagonal rule.

## 9. API & events

Envelopes, rejects: [live-sync](live-sync.md). All WS (canvas actions, ADR-0021 D). No REST.

**WS intents** (default DM only; scene in `ctx.campaignId`, else `not_found`)

| Intent | Who | Validation / ownership |
|---|---|---|
| `scn.addWalls {sceneId, segments [x1, y1, x2, y2][] 1–200}` → `{ns}` | DM | FR-SCN-07 |
| `scn.addDoor {sceneId, segment, state?}` → `{n}`; `scn.setDoor {sceneId, n, state}`; `scn.removeSegments {sceneId, ns 1–500}` | DM | `n` exists, else `not_found` |
| `scn.placeProp` → `{propId}`; `scn.updateProp {propId, col?, row?, w?, h?, rotation?, z?, locked?, assetId?}`; `scn.setPropHidden {propId, hidden}`; `scn.duplicateProp {propId}` → `{propId}`; `scn.deleteProp {propId}` | DM | `assets.require`; FR-SCN-16/17; locked → move / resize `conflict` |
| `scn.placeTemplate {sceneId, shape, x, y, size, width?, angle, label?, hidden?}` → `{templateId}` | DM, player | FR-SCN-20, 25; player: active scene, `hidden` not in schema |
| `scn.updateTemplate {templateId, x?, y?, size?, width?, angle?, label?, hidden?}`; `scn.deleteTemplate {templateId}` | DM, placer | Player: hidden / unknown → `not_found`, not own → `forbidden`; `hidden` DM only |
| `scn.clearTemplates {sceneId}`; `scn.setDiagonalRule {rule}` | DM | — |
| `sync.loadScene {sceneId}` → `{records {<type>: Record[]}}` | DM | Owned by the window ADR (FR-SCN-32) |

**Record types**

| Type | Scope | Player visibility (DM `full`) | Snapshot |
|---|---|---|---|
| `scene-structure` | scene, `sceneOf = id`; active-scene DM window | **redacted** `{id, doors [n, x1, y1, x2, y2, open 0 \| 1][]}`: no walls, locked → closed | DM: active scene (+ loads); player: active |
| `scene-prop` | scene, `sceneOf = sceneId`; window | `hidden` or fog-hidden (`hides`) → hidden; else redacted (no `locked`) | same |
| `aoe-template` | scene, `sceneOf = sceneId`; window | `hidden` or fog-hidden (DM-placed only) → hidden; else full | same |
| `map-settings` | campaign | full | the campaign's row (or none) |

**Signal:** `scn.template` (DM, player), audience per FR-SCN-24. Not logged, persisted or in a snapshot.

**Domain events** (all logged, none transient or undoable). Visibility: each change per its record type above (transition matrix, FR-SYNC-19); players see only `cause.name`.

| Event | Payload | Changes |
|---|---|---|
| `StructureEdited` | `{sceneId, op: addWalls \| addDoor \| removeSegments \| setDoor, ns}` | `scene-structure` upsert |
| `PropPlaced` / `PropUpdated` / `PropHidden` / `PropRevealed` / `PropDuplicated` / `PropDeleted` | `{propId}` | `scene-prop` upsert / delete |
| `TemplatePlaced` / `TemplateUpdated` / `TemplateDeleted` / `TemplatesCleared` | `{templateId}` / `{sceneId, templateIds}` | `aoe-template` upsert / delete |
| `DiagonalRuleSet` | `{rule}` | `map-settings` upsert |
| MAP `SceneDuplicated` / `SceneDeleted` | unchanged | + SCN rows from `sceneHooks` |
| FOG `FogEdited` / `FogUndone` | FOG's | + `scene-prop` / `aoe-template` rows whose `fogged` flipped |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Walls, doors, props, Layers, diagonal rule | ✓ (any scene) | ✗ | Default-DM intents |
| Move a token through a wall / non-open door | ✓ | ✗ | Move guard (FR-SCN-11) |
| Place ephemeral / persistent template | ✓ (any scene; may be DM-only) | ✓ active scene, ≤ 3 kept | Signal audience; FR-SCN-25 |
| Edit / delete persistent template | any | own | FR-SCN-26 |
| Select creatures inside | ✓ | ✗ | Client only |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** their ephemeral template vanishes for others ≤ 3 s; persistent ones stay. A drag in progress snaps back unsent (FR-MAP-28). Reconnect → snapshot with current doors and props.
- **DM disconnect / reconnect:** a polyline in progress and the undo stack survive a reconnect (client memory) but not a reload. Reconnect snapshot → only the active scene's SCN rows; the client reloads the viewed scene (FR-SCN-32).
- **Server crash mid-action:** one transaction per command → before commit nothing, after commit in the snapshot. Ephemeral templates are lost (accepted). A blocked move never wrote anything.
- **Concurrent edits:** add / remove by `n`, never a whole-list replace, so two DM tabs don't lose each other's walls; `rev` increments per edit. Door closed while a player drags → the guard reads the committed state at drop. Undo of an edit another tab already reverted → `not_found` → entry dropped + Toast.
- **Scene switch:** players' ephemerals on the old scene are dropped by the receivers' scene filter; persistent templates stay with their scene. Activating a scene puts its SCN rows into every player's resync snapshot.
- **Recalibration / map change:** content follows the grid; entries off the new map stay drawn and editable.
- **Invalid / malicious input:** strict zod; another campaign's IDs → `not_found`; player sends `hidden` or a DM intent → `invalid` / `forbidden`; labels rendered as text; > 64 KB frame closed (CON-13).
- **Accepted leaks:** a refused move tells the player something blocks that line (that is the feature); `StructureEdited` upserts tell players the DM edited the active scene's structure (not what); door positions and states on the active scene, also under fog (S5; FOG lists it for the DM).

## 12. Performance & bandwidth

**Snapshot (hard constraint, CON-44).** Heavy DM 781,923 B of 786,432 B (4,509 B left). "Typical prepped scene": 150 walls, 10 doors, 15 props, 3 kept templates.

| Item | Wire size | Typical scene | Max scene |
|---|---|---|---|
| Wall / door tuple | ≈ 21 / 23 B | 3.5 KB (+ envelope) | 2,000 → 44 KB |
| Prop (DM / player) | ≈ 205 / 190 B | 3.1 KB | 200 → 41 KB |
| Kept template | ≈ 250 B | 0.75 KB | 20 → 5 KB |
| `map-settings` | ≈ 60 B | 0.06 KB | — |
| **Per scene** | | **≈ 7.3 KB DM**, ≈ 3.6 KB player | ≈ 90 KB |

**Combined with FOG** (seam S1, same numbers in both specs): heavy DM 781.9 KB − 18.5 KB presets (on demand) + SCN active-scene window ≈ 7.3 KB + fog ≈ 8.3 KB (fog rows stay in the full DM snapshot, compact; the window covers SCN records only) ≈ **779 KB of 786.4 KB, ≈ 7 KB left**. Without the window, 30 prepped scenes would add ≈ 216 KB.

| Option (OQ-SCN-01, one combined **DM** question) | Heavy DM | Left | Cost |
|---|---|---|---|
| **A. Presets on demand + SCN active-scene window** | ≈ 779 KB | ≈ 7 KB | MOD preset transport → REST read; window ADR |
| B. A + window `token` the same way | ≈ 679 KB | ≈ 100 KB | scenes-map change; DM paths that read other scenes' tokens need a load |
| C. Raise the DM ceiling | ≤ ceiling | as raised | DM decides only; DM client usually local (ADR-0003) |

- Players: + ≈ 3.6 KB per typical scene (≈ 276 of 512 KiB). Event frames: a structure upsert ≤ 44 KB to the DM, doors only to players.
- **Move guard:** O(segments) intersection tests, ≤ 2,000 at the cap: target ≤ 1 ms p95 per move (unit benchmark); the structure row is read once per move or cached by `rev`.
- **Canvas:** walls drawn as one Konva shape; props as cached image nodes (≤ 200); affected squares one shape per template, memoised per template change (≤ 20 kept + ephemerals). Review check: Chrome trace while panning Goblin Ambush with the typical scene: median frame ≤ 20 ms.
- **Signals:** ephemeral template ≈ 250 B × ≤ 20/s per dragging sender, 1/s at rest, ≈ 30 KB/s fan-out to 6 players over the tunnel at worst.

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:`, temp asset dir, port 0; walkthroughs on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), AGENTS §9.6). Tests named after FRs.

**Fixtures** (`fixtures/units/scene-tools/`; Goblin Ambush is 20 × 14):

| Key | Contents | Requires |
|---|---|---|
| `scn-prop-images` | Committed SVGs `prop-barrel`, `prop-table`, `prop-chest` (`fixtures/assets/props/`) ingested | `images` |
| `scn-walls` | Goblin Ambush structure: walls x = 8 from y 0–5, 6–11, 12–14; door d1 (8, 5)–(8, 6) **closed**; door d2 (8, 11)–(8, 12) **locked** | `battlemap` |
| `scn-props` | Barrel (5, 3) 1 × 1; table (4, 11) 2 × 1, rotation 90; **hidden** chest (17, 12) | `scn-prop-images`, `battlemap` |
| `scn-templates` | Kept sphere 15 ft at vertex (3, 8), placed by `player-1`, label "Spirit Guardians"; **hidden** DM cube 10 ft at (12, 12), label "Glyph" | `battlemap`, `player-1` |

- **Bundle `scene-tools`** = `scenes` + the four units. `session-sim` gains `scn-walls` + `scn-templates` *(OQ-SCN-20)*. CON-44 heavy scenario gains one typical prepped active scene (§12).
- **Leak strings / properties** (player frames): "Glyph"; `prop-chest`'s asset ID (until revealed); no `walls` key; no door state `2`; no `scene-structure`, `scene-prop` or `aoe-template` of a non-active scene; no `scn.template` signal with `dmOnly` or from a non-active scene.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-SCN-10 blocking` (cross, touch an endpoint, collinear, diagonal through a jamb, open door passes, closed / locked block, Large token centre, DM skipped) + benchmark at 2,000 segments; `FR-SCN-07` (dedupe both directions, length 0, bounds, cap); `FR-SCN-21 templateCells` (golden cells per shape, each angle step, map cut); `FR-SCN-18` prop footprint with rotation; `FR-SCN-30` distance per rule; `FR-SCN-15` undo reducer (inverse per op, reject drops entry, per scene, 50 cap); `FR-SCN-23` ephemeral store (end, snapshot, 3 s, scene filter, one per sender); `FR-SCN-03` registry (`clients`, toggles, duplicate order throws); visibility matrix (3 types × DM / owner / other player × hidden / locked) | In-code |
| Integration | Each command: rows + log + one event, IDs from `ctx`, rollback → nothing; caps → `conflict`. **Guard:** `player-1` Mira (2, 7) → (10, 7) `conflict`, no event, no `movedFt` change in combat; via open d1 ✓; d2 locked ✗; DM Goblin through the wall ✓; guard before hooks. **Leak test:** `player-1` / `player-2` frames per leak list through snapshot, lock / unlock, prop hide / reveal, template hide; `StructureEdited` cause only. **Window:** DM snapshot holds only the active scene's SCN rows; `sync.loadScene` returns the others; convergence per the ADR; edits on a non-active scene reach no player. **Signal:** `scn.template` routing (player → all; DM `dmOnly` → DM tabs only; player on a non-active scene → `invalid`). **Scene hooks:** duplicate copies structure + props, not templates; delete lists every SCN row. **CON-44** heavy + session-sim under ceilings | `scene-tools` |
| E2E (thin) | DM + `player-1`: blocked move reverts with Toast; DM opens d1, move succeeds; player places a sphere, DM sees it, Keep, reload, still there | `scene-tools` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`, `fixtures:reset-load scene-tools --profile verify`, `start --profile verify`. **A** DM, **B** `player-1`, **C** `player-2`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, Show to players | B, C open links | A: walls, d1 closed, d2 lock glyph, barrel, table, chest + Glyph translucent, Spirit Guardians. B, C: d1, d2 both closed, barrel, table, Spirit Guardians; no walls, chest, Glyph (frames: leak list) |
| 2 | — | B drags Mira (2, 7) → (10, 7) | Refused: snap back, Toast "Blocked by a wall or door", cell flash; A, C see Mira at (2, 7) |
| 3 | Drag Goblin (12, 6) → (4, 6) | — | "· through wall" while dragging; drop accepted |
| 4 | Double-click d1 (Select tool); lock and unlock d2 | B: Mira → (7, 5), then → (9, 5) | d1 open for B, C ≤ 1 s; both moves accepted; B's frames: d2 always closed |
| 5 | Structure: draw a 3-segment wall; Erase one; Undo, Undo | — | Wall drawn, segment erased, restored, polyline gone; B, C see no walls, only `StructureEdited` upserts |
| 6 | Props: place barrel at (6, 12), resize 2 × 2, rotate, hide, reveal chest, lock it, drag it | — | B, C see the barrel change, lose it on hide; chest appears with its image; a locked drag does nothing |
| 7 | — | B: AoE cone 15 ft from (3, 7), drag direction, Keep; C: sphere 20 ft, then closes the tab | A, C see B's cone live with "N squares", then kept; C cannot delete it; C's sphere vanishes for A, B ≤ 3 s |
| 8 | B's cone → Select creatures inside; Clear templates | — | Tokens inside get selection rings; all kept templates gone for B, C |
| 9 | Ruler panel: Diagonals 5 ft | B ruler (2, 7) → (5, 9) | B reads "15 ft" (was "20 ft"); back to 5/10/5 |
| 10 | Layers: Walls & doors off, DM-only off | — | A hides them; B, C unaffected |
| 11 | View Cellar; draw a wall; reload; view Cellar again | — | "Loading scene…", then the wall; B, C get no frame |
| 12 | Duplicate Goblin Ambush, view the copy, delete it | — | Copy has walls, doors, props, no templates; delete leaves no SCN rows in A's store |
| 13 | Hard-kill + restart | B mid-drag, reconnects | Walls, door states, props, kept templates intact; ephemerals gone; `state:digest` equal before / after; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [scenes-map](scenes-map.md) | Move-guard registry in `map.moveToken` ([proposed ADR](../architecture/adr/proposed-token-move-guards.md)); `sceneHooks` (created by `fix/fog-core`) for duplicate / delete; layer entry shape (FR-SCN-03); canvas tool registry; local drag state for the DM hint; `distanceFt` rule param | complete; SCN core changes it (OQ-SCN-13–16) |
| [fog-of-war](fog-of-war.md) | `fix/fog-core` lands first: `visibility-hooks.ts` (`derive`, `hides`, `dragToDm`), `sceneHooks`, `deriveSceneObject`; registers its layer (order 30) in `canvas-layers.ts` and its tools in `canvas-tools.ts` (fog client slice after `fix/scn-core`); owns what fog hides (S5) | spec in-review (settled S1–S8) |
| [live-sync](live-sync.md) | Active-scene DM window + `sync.loadScene` ([proposed ADR](../architecture/adr/proposed-active-scene-window.md)); signal audience (built) | complete; ADR proposed |
| [combat-tracker](combat-tracker.md) | `movedFt` uses the campaign rule; blocked moves commit nothing; popup preselects from the selection (FR-SCN-28) | complete (OQ-SCN-17) |
| [assets-pipeline](assets-pipeline.md) | Picker, `assets.require`, `useAssetImage` | complete |
| [effect-modifiers](effect-modifiers.md) | Presets on demand (OQ-SCN-01 A), built in `fix/fog-core` (S1) | complete; FR-MOD amendment by the integrator |
| [fixtures-adapters](fixtures-adapters.md) | Units + bundle above; FIX §8 rows at merge | complete |

**Shared changes** (builders report `shared change needed:` per AGENTS §9.9):

| Shared file | Change | Branch |
|---|---|---|
| ★ `src/server/db/` | Tables `scene_structure`, `prop` (+ `fogged`), `aoe_template` (+ `fogged`), `map_settings`; schema lock after `fix/fog-core` merges (S2) | `fix/scn-core` |
| Effect-modifiers | Preset transport → REST read (FR-MOD amendment by the integrator) | `fix/fog-core` (S1) |
| `src/shared/events/` | `scene-tools.ts`: the §9 events | `fix/scn-core` |
| `src/server/ws/`, `src/shared/protocol/` | Registration `dmWindow: "active-scene"`, `sync.loadScene`, convergence + leak helpers honour it | `fix/scn-core` |
| `src/server/features/scenes-map/` (MAP lock) | `moveGuards` registry run in `map.moveToken` before the write and `derive` (S4); SCN lines in `sceneHooks` (registry by `fix/fog-core`, S3) | `fix/scn-core` |
| `src/client/common/features/scenes-map/` (canvas lock, with FOG) | `layers.ts` entry shape; new `canvas-tools.ts`; `ToolRail.tsx` renders it; `canvas-context.ts` exposes the local drag; `@shared/scenes-map/geometry` `distanceFt(rule)` | `fix/scn-core` |
| Combat hook | FR-CBT-39 reads `map-settings`; after `fix/fog-combat` merges (S8) | `fix/scn-core` |
| Docs | Protocol: new section (types, intents, signal, events, registries); data model: four tables; AGENTS §9.9 registry list (+ `visibility-hooks.ts`, `sceneHooks`, `moveGuards`, `canvasTools`, S3); glossary (OQ-SCN-19); FIX §8 | integrator |

**Build slices** (after DM gate 2; P2's canvas fixes merged first). Order (S2): **`fix/fog-core` → `fix/scn-core`** → SCN slices ∥ the fog client slice (needs `canvas-tools.ts`):

| Slice | Contents | Touches |
|---|---|---|
| `fix/scn-core` | Everything in the table above (after `fix/fog-core`), `derive` calls for props / templates, geometry lib (`@shared/scene-tools/geometry`), empty SCN layers registered, CON-44 heavy scene | Schema ★, canvas ★ |
| `build/scene-tools-structure` | Structure commands, guard, layer, tool, door menu, DM hint, undo helper, `scn-walls` | Canvas (own files + registry lines) |
| `build/scene-tools-props` | Props commands, layer, tool, menu, `scn-prop-images`, `scn-props` | Own files |
| `build/scene-tools-templates` | Template records + signal, layer, AoE tool, Select creatures inside, `scn-templates` | Own files |
| `build/scene-tools-settings` | Layers popover, diagonal rule panel + wiring | `ToolRail` panel slot |

## 15. Open questions

**Bold** = suggested pick (not decided). **DM** = needs the DM at gate 2.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SCN-01 | Fit SCN + fog under CON-44 (§12; one combined question, S1) — **DM** | **A presets on demand + SCN active-scene window: ≈ 779 of 786.4 KB, ≈ 7 KB left** / B A + token window: ≈ 100 KB left, bigger change / C raise the DM ceiling. *A: smallest change; B if later features need room* | yes | live-sync, MOD, FOG, scenes-map |
| OQ-SCN-02 | Templates ephemeral or persistent — **DM** | **Ephemeral (signal) by default, Keep → record** / always records (snapshot cost) / always ephemeral (Spirit Guardians lost on reload). *Two paths, but zero snapshot cost for most* | yes | live-sync |
| OQ-SCN-03 | Who places templates (carried) — **DM** | **DM and players** / DM only. *Players show their own spells* | yes | — |
| OQ-SCN-04 | Diagonal rule (carried) — **DM** | **Campaign setting: 5/10/5 default, 5 ft option** / fixed 5/10/5. *One row; touches ruler, indicator, combat* | yes | scenes-map, combat-tracker |
| OQ-SCN-05 | Blocking rule — **DM** | **Straight line between footprint centres (as Foundry)** / reachable region (path search, moves around corners in one drop). *Simple and exact; corners need two drops* | yes | — |
| OQ-SCN-06 | What players see of structure — **DM** | **Doors (open / closed) only** / walls too (lets the client pre-check, shows layout under fog) / nothing. *Map art shows walls already* | yes | FOG |
| OQ-SCN-07 | Who opens doors — **DM** | **DM only (as brief); locked is a DM marker** / players toggle unlocked doors next to their token. *Locked means little until players can open doors* | no · owner: DM | — |
| OQ-SCN-08 | Undo for DM drawing | **Client-side inverse intents, 50 per scene, lost on reload** (FOG's server-side undo differs by design, S7) / server undo (amends ADR-0016 scope, #66) | no · owner: spec-scene-tools | FOG |
| OQ-SCN-09 | Affected squares | **Cell centre inside the shape** / any overlap / sphere by the diagonal rule. *Common VTT default* | no · owner: DM (rules) | — |
| OQ-SCN-10 | Prop size / angle | **Cells 1–20, 90° steps** / free size and angle. *Cheap, grid-true* | no · owner: spec-scene-tools | — |
| ~~OQ-SCN-11~~ | ~~Layer registry home~~ | **Settled S6:** keep `canvas-layers.ts`, SCN owns the entry shape; order per FR-SCN-02 | — | — |
| ~~OQ-SCN-12~~ | ~~FOG seam: what FOG needs from SCN~~ | **Settled S5 / S6:** fog subjects = props, DM-placed templates (kept and ephemeral); not walls or doors; SCN stores `fogged` via `derive`, consults `hides`; fog layer `{id: "fog", order: 30}` (FR-SCN-35) | — | — |
| OQ-SCN-13 | scenes-map: wall check | **Move-guard registry, may reject ([proposed ADR](../architecture/adr/proposed-token-move-guards.md))** / a token-changed hook that rejects (breaks ADR-0031) / client-only check. *Keeps ADR-0031's hooks non-rejecting* | yes · ADR at gate | scenes-map |
| ~~OQ-SCN-14~~ | ~~scenes-map: scene duplicate / delete~~ | **Settled S3:** one `sceneHooks` registry (create / duplicate / delete), created by `fix/fog-core` | — | — |
| OQ-SCN-15 | scenes-map: DM drag hint | **`canvas-context` exposes the local drag `{tokenId, from, to}`** / no DM hint | no · owner: spec-scene-tools | scenes-map |
| ~~OQ-SCN-16~~ | ~~scenes-map: tool rail entries~~ | **Settled S6:** append-only `canvas-tools.ts` (SCN + FOG); Space + drag pans in drawing tools | — | — |
| OQ-SCN-17 | combat-tracker | **`movedFt` per campaign rule; nothing on blocked moves; FR-SCN-28 only fills the selection** / no rule in combat | no · owner: orchestrator | combat-tracker |
| OQ-SCN-18 | live-sync: DM window | **[Proposed ADR](../architecture/adr/proposed-active-scene-window.md): active-scene DM window + `sync.loadScene`** / DM gets all scenes (needs D) | yes · ADR at gate | live-sync, FOG |
| OQ-SCN-19 | Glossary | **Rename "AoE prop" → "AoE template"; add Prop, Wall, Door, Structure, DM-only layer, Ephemeral template, Diagonal rule, Move guard; Scene: "fog and props" stays** | no · owner: integrator | glossary |
| OQ-SCN-20 | `session-sim` content | **+ `scn-walls`, `scn-templates`** (sprint gate walks a wall and a template) / unchanged | no · owner: orchestrator | FIX, CON-44 |

## 16. Out of scope

- Fog → [fog-of-war](fog-of-war.md). HP bar / condition icons on tokens → built by [combat-extras](combat-extras.md) (FR-CBTX-28/29). Drag previews → built by [scenes-map](scenes-map.md) (#171).
- Map pins (tier B, [world-builder](post-mvp/world-builder.md)); player-ready indicator and scene preload (#39); vision, lighting (ADR-0007); freehand (#21); AoE automation; props blocking moves; dragging images from the desktop onto the map (tier A, #148).
