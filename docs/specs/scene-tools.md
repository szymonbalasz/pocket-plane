---
title: Scene tools
prefix: SCN
status: claimed
owner: spec-colours
phase: post-mvp-5
---

# Scene tools

> **Sprint 3 (track V, DM decisions [#201](../decisions-log.md), [#202](../decisions-log.md)).** Decided by the DM (not open): walls are drawn **freeform while Ctrl is held**, grid-snapped otherwise; while a token is dragged over a wall, the **wall under the drag path highlights red** before the drop; walls take part in dynamic vision ([fog-of-war](fog-of-war.md) v2, [ADR-0042](../architecture/adr/0042-dynamic-vision.md)). Amended here: FR-SCN-07, 08, 10, 12, 13, 36; new FR-SCN-37–40; §8, §9, §12–§15. *Review pass (rulings 2026-10-16):* door samples = `doorCells` on integer doors (A8), the wall hint is the first crossing only (A3), a token the player can't see → `not_found` in `map.checkMove` (A4), build order (A10). Everything else is the built sprint-2 spec. *Sprint-3 gate 1 (DM, 2026-10-16):* §15's new rows decided (**#207**); DM snapshot ceiling 1 MiB (**#208**, §12).

> **Sprint 4 (track M, DM decisions [#243](../decisions-log.md) [8], BL-05).** Decided by the DM (not open): **freeform AoE templates** that still highlight affected cells, a cell counting when **> 50 % covered**. Amended here: FR-SCN-20–23, 26; new FR-SCN-41–46; §7–§15. *Sprint-4 gate 1 (DM, 2026-10-17, **#245**):* every §15 sprint-4 question decided as picked: one-side tie rule, exact area, snapped unless Ctrl, Clear confirm + tick, end handle kept, no dependency (OQ-SCN-28–32, -36). One map-tools design with [scenes-map](scenes-map.md) (drag path, labels, Show to players) and [play-shell](play-shell.md) (window placement); seams with track V ([fog-of-war](fog-of-war.md): fog brush, drag-time vision) in §14. *Seams pass (orchestrator ruling):* S1 (the `map.checkMove` probe moves to V8's `drag-probe.ts`, FR-SCN-38), S2 (helper at `@shared/scenes-map/area`, FR-SCN-42, OQ-SCN-33 settled), S4 / S5 (M1 after V7; schema V6 → R0 → Mc) applied.

**Sprint 4 at a glance** (review A25; the rest of the spec is the built sprint-2 / sprint-3 detail)

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-SCN-20, -23 | Freeform origin (0.01 cell) + angle (0.1°); sizes stay 5-ft steps | Mc, M1 | `FR-SCN-20 zod` |
| FR-SCN-21, -41 | Affected squares = > 50 % covered, exact; a tie counts on one side only (lines / cones: right of the axis; cubes: either centre line) | M0, Mc | `FR-SCN-41 coverage 49 / 50 / 51 %`, `cube ties`, goldens |
| FR-SCN-42 | One helper `@shared/scenes-map/area` (modes `half` / `centre` / `distance`) shared with V's brush | M0 | `FR-SCN-42 helper` |
| FR-SCN-43 | Snapped unless Ctrl | M1 | `FR-SCN-43 gestures` |
| FR-SCN-44 | Clear templates: confirm, players' kept templates only with the tick | Mc, M1 | `FR-SCN-44 Clear templates scope` |
| FR-SCN-45 | End handle on kept templates | M1 | `FR-SCN-45 handles` |
| FR-SCN-46 | Old rows valid; boot re-derive of DM templates' fog copies | Mc | `FR-SCN-46` |

Decided at sprint-4 gate 1 (#245): OQ-SCN-28 (one-side ties), -29 (exact area), -30 (Ctrl), -31 (Clear + tick), -32 (no dependency), -36 (end handle kept). Measured: +8.3 B per template row; heavy DM 676,270 B at the template cap (§12). Walkthrough: scenes-map §13 M2, M3, M11, M12.

## 1. Summary

- Battlemap **props and structure** on the [scenes-map](scenes-map.md) canvas (sprint 2 track B, #187): a **layer model** (map / objects / tokens / DM-only), **walls and doors** that block player token moves, **AoE templates** (cone, sphere, cylinder, cube, line), image **props** from the [asset pipeline](assets-pipeline.md), and the **diagonal rule** as a campaign setting.
- ~~Movement only: walls never affect vision~~ *(sprint 3)*: walls and doors not open block player moves **and sight** (FR-SCN-37, #207, OQ-FOG-21 / -24); never light (dynamic lighting stays out). Fog of war is its own spec ([fog-of-war](fog-of-war.md), FOG). This spec owns the layer model and the tool registry fog registers into, and exposes what fog's filter needs (FR-SCN-35, FR-SCN-37).
- Hard constraint: CON-44 (DM snapshot ≈ 4.4 KiB left). Decided (#196): the DM snapshot carries only the **active scene's** tokens and SCN records; other scenes load on view ([active-scene window ADR](../architecture/adr/0041-active-scene-window.md), accepted #196; [OQ-SCN-01](#15-open-questions)).
- **Sprint 4** (FR-SCN-41–46): templates go **freeform** (origin anywhere, any angle; snapped unless Ctrl); affected squares = cells **> 50 % covered** (exact area; a tie counts on one side only), from one shared **area helper** that V's fog brush also uses (FR-SCN-42); **Clear templates** asks first and keeps players' templates unless ticked (BL-05); kept templates get an end handle (all decided #245). Measured: +8 B per template row (§12).

## 2. Scope

- **Layers:** four layers, render order, DM view toggles. DM-only = the existing `hidden` flag on each record (tokens unchanged).
- **Structure:** walls and doors are segments between grid vertices, or **anywhere with Ctrl** (sprint 3); doors are open / closed / locked (DM). A player move across a wall or a non-open door is refused server-side; the DM always moves through. While dragging, the crossed wall highlights **red** for the player and the DM (sprint 3). Client-side undo of DM drawing (#196, OQ-SCN-08).
- **AoE templates:** five shapes, ~~snapped to the grid~~ *(sprint 4)* freeform: snapped unless Ctrl (#245), affected squares shown (*sprint 4:* > 50 % covered). Placed by the DM and players (#196, OQ-SCN-03). Ephemeral by default; **Keep** makes one persistent (#196, OQ-SCN-02). *(Sprint 4)* Clear templates with a confirm and a scope (BL-05).
- **Props:** DM-placed images on the objects layer, cell-snapped, 90° rotation.
- **Diagonal rule:** campaign setting, 5/10/5 (default, #145) or 5 ft (#196, OQ-SCN-04).

## 3. Goals

- The DM preps Goblin Ambush (walls, two doors, barrel, table, a hidden chest) in the UI in minutes, without leaking anything hidden.
- A player can't walk through a wall or a closed door, and is told why, *(sprint 3)* already while dragging. The DM is never blocked.
- *(Sprint 3)* The DM traces an irregular cave wall in a few Ctrl-clicks; walls cut the party's sight exactly where they cut movement (one geometry, FR-SCN-10 / 37).
- Everyone sees a spell's area and the squares it covers, live, ≤ 1 s.
- *(Sprint 4)* A player lays a cone off the grid and every client highlights the same squares: the ones more than half inside it. The DM clears their own leftovers without wiping the players' kept templates.
- Fits CON-44 with fog included. Nothing persisted is lost on a hard kill.

## 4. Non-goals

- Lighting ([ADR-0007](../architecture/adr/0007-product-scope.md)); vision math itself (owned by FOG; walls only supply occluders, FR-SCN-37); one-way, terrain or window walls; freehand (brush) drawing (#21).
- Automatic AoE damage, saves or target lists ([combat-extras](combat-extras.md) multi-target is out); speed enforcement (#145: indicators only).
- *(Sprint 4)* Free template sizes (sizes and widths stay 5 ft steps: spells come in them); templates blocked by walls (an area ignores walls, as today); per-player template colours (BL-17, backlog).
- Props that block movement; overhead props above tokens; free rotation or sizing *(OQ-SCN-10)*.
- Map pins (tier B), player-ready indicator, scene preload, server-side (event-log) undo of scene edits.

## 5. User stories

**DM**
- As the DM, I want to trace the walls and doors of a battlemap once, so that players can't walk through them and I stop policing moves.
- As the DM, I want to lock a door without players seeing it's locked, and open it with a double-click mid-fight.
- As the DM, I want to drop barrels, tables and a hidden chest from my uploads and reveal the chest later.
- As the DM, I want to undo my last few drawing steps.
- *(Sprint 3)* As the DM, I want to trace a curved cave wall off the grid (Ctrl) and have doors snap into its gaps.

**Player**
- As a player, I want to place a Fireball sphere and see who's in it before I commit, then clear it.
- As a player, I want a refused move to tell me a wall is in the way, *(sprint 3)* and to see the wall turn red before I let go.
- *(Sprint 4)* As a player, I want to aim my Burning Hands cone exactly from my hands (Ctrl) and see which squares it really catches, so that we stop arguing about half-covered goblins.
- *(Sprint 4)* As the DM, I want "Clear templates" to ask first and to leave the players' kept templates alone unless I say so.
## 6. Functional requirements

**Units.**
- **Vertex** = grid intersection `(x, y)`, integers; map space `offset + x × cellSize`. *(Sprint 3)* **Point** = any `(x, y)` in grid units with ≤ 2 decimals (1/100 cell); a vertex is a point with integer coordinates. Segments run point to point.
- **Cell** `(col, row)` as [FR-MAP-14](scenes-map.md#6-functional-requirements). 1 cell = 5 ft.
- Everything is stored in grid units, so recalibration ([FR-MAP-10](scenes-map.md#6-functional-requirements)) moves SCN content with the grid.

| ID | Requirement | Notes |
|---|---|---|
| **Layers** | | |
| FR-SCN-01 | Four **layers** (product view), bottom → top. **map**: map image and grid (MAP). **objects**: props, walls and doors, AoE templates. **tokens**: tokens and labels (MAP). **DM-only**: not drawn on its own; any token, prop or template with `hidden = true`, plus every wall. Fog (FOG) renders above props and structure, below templates and tokens. | Settled S6 |
| FR-SCN-02 | **Canvas layers** (registry entries), by order: map 0, grid 10, `scn-props` 20, `scn-structure` 26, *fog 30 (FOG)*, `scn-templates` 35, tokens 40, labels 45, `scn-edit` 48, pointers 50. `scn-templates` sits above fog: a DM template under fog is filtered server-side; a player's own template stays visible. `scn-props` + `scn-structure` share one Konva layer (FR-SCN-03 `group`). `scn-edit` (drawing previews, handles) is mounted only while a DM drawing tool is active. Budget: ≤ 8 Konva layers, 9 while drawing. | X10 |
| FR-SCN-03 | **Layer registry** (existing, append-only): `src/client/common/features/scenes-map/canvas-layers.ts`. SCN owns the entry shape in `layers.ts`: `LayerDef {id, order, component, clients?: ("dm" \| "player")[]` (default both)`, group?: string, toggle?: {key, label, layer: "objects" \| "tokens" \| "dm-only" \| "fog"}}`. Entries next to each other with the same `group` render as Konva `Group`s inside one `<Layer>`. A duplicate id or order throws at load (as built). FOG adds one line. | Settled S6 |
| FR-SCN-04 | **DM-only = `hidden`.** Tokens keep [FR-MAP-19](scenes-map.md#6-functional-requirements) (no new token field). Props and templates get the same flag and the same styling (`visibility.hidden`, eye-off). Players never receive a hidden record. | Reconciles #76 |
| FR-SCN-05 | **Layers popover** (DM tool rail): one Switch per registered `toggle` (Walls & doors, Props, Templates, DM-only items; FOG may add Fog). Off = not drawn and not hit on this DM client. Client only, never sent; `localStorage` per campaign; all on by default. | |
| FR-SCN-06 | **Canvas tool registry** (new, append-only): `src/client/common/features/scenes-map/canvas-tools.ts`. Entry: `{id, label, icon, clients, order, panel?, cursor?, pointer?: {down, move, up, cancel}}`. `MapCanvas` dispatches stage pointer events to the active tool's `pointer` handlers. While a drawing tool is active, the tokens layer ignores left-press (right-click menus still open) and Space + drag pans. Esc goes to the tool first. SCN adds Structure, Props (DM) and AoE (both); FOG adds its tools. | Settled S6; F11, BO3 |
| **Structure** | | |
| FR-SCN-07 | **Structure** = one record per scene. `walls [n, x1, y1, x2, y2][]`. `doors [n, x1, y1, x2, y2, state, f][]`: `state` 0 open / 1 closed / 2 locked; `f` is the server-written fog flag (FR-SCN-36). `n` is unique per scene, taken from `nextN`. A segment runs ~~vertex to vertex~~ **point to point** *(sprint 3: coordinates are numbers with ≤ 2 decimals; more → `invalid`; existing integer segments stay valid unchanged)* at any angle, length ≥ 0.05 cell, endpoints within the map's vertex range ± 1. Identical segments (either direction) dedupe. ≤ 2,000 segments per scene, else `conflict`. | Compact on purpose (§12) |
| FR-SCN-08 | **Structure tool** (DM), modes Wall · Door · Erase. **Wall:** click vertices (the pointer snaps to the nearest one) to draw a polyline; double-click ends it, Esc cancels. Ending sends one `scn.addWalls` (≤ 200 segments). **Door:** two clicks → `scn.addDoor` (closed). **Erase:** click within 8 px of a segment, or Ctrl/Shift-drag a box (segments fully inside) → `scn.removeSegments`. *(Sprint 3)* **Freeform:** in Wall and Door mode a click **with Ctrl held** places the point where the pointer is (rounded to 0.01 cell) instead of the nearest vertex; per click, so one polyline may mix both. In either mode a point within **8 px of an existing segment endpoint** snaps to that endpoint (magnet, *#207, OQ-SCN-24*), so freeform walls join up and a door fits a gap. A "Free" chip follows the cursor while Ctrl is held. Erase unchanged (Ctrl-drag still box-selects there). | #202 |
| FR-SCN-09 | **Door state** (DM): `scn.setDoor {sceneId, n, state}`. Door menu (right-click): Open, Close, Lock, Unlock, Delete. Double-click a door with the Select tool to toggle open ↔ closed (a locked door stays locked). Players can't change doors (#196, OQ-SCN-07). | |
| FR-SCN-10 | **Blocking rule:** a **player's** `map.moveToken` is refused iff the straight segment between the footprint centres of `from` and `to` intersects or touches any wall, or any door whose state ≠ open (collinear overlap counts). Integer math on ~~doubled~~ coordinates **scaled by 200** *(sprint 3: 1/100-cell points, doubled for centres; \|v\| ≤ 2 × 200 × 1,025 = 410,000, so products stay < 2^53 and exact)*. DM moves are never checked. Pure `blockingSegments(structure, from, to, size) → Segment[]` in `@shared/scene-tools/geometry` (empty = not blocked); the guard, `map.checkMove` and the DM client all call it, so the highlight and the refusal can't disagree. | OQ-SCN-05 |
| FR-SCN-11 | The check is a **move guard** in `map.moveToken`'s transaction. Order: **guards** (may refuse) → FOG's `derive` → one write → token-changed hooks. The guard reads only the scene's structure row (an in-memory cache keyed by `(sceneId, rev)` is allowed). Refused → `reject conflict` "Blocked by a wall or door" (same text for wall, closed and locked). No write, no event, no hook, no `movedFt` change. | [move-guards ADR](../architecture/adr/0040-token-move-guards.md) (accepted #196); X7 |
| FR-SCN-12 | **Player cue:** on that reject the client reverts (FR-MAP-15), shows the Toast and flashes the target cell (`accent.danger`, 1 s). *(Sprint 3)* Before the drop: FR-SCN-38. | |
| FR-SCN-13 | **DM hint:** while the DM drags a token (read from the existing `pointers.drag`, FR-MAP-40) across a blocking segment, `scn-structure` highlights the crossed segments **red** (`accent.danger`, sprint 3, #202; was the accent colour) and shows a "through wall" tag at the target cell. The drop still sends. Local only, from `blockingSegments` on the DM's own structure row. | B10 |
| FR-SCN-14 | **Drawing.** DM: walls as lines (`accent.primary`); doors as a door glyph per state, with a lock glyph when locked. Players: doors only, open or closed (locked is sent as closed), never walls; doors with `f = 1` are dropped (#196, OQ-SCN-06). | |
| FR-SCN-15 | **Undo** (DM, client only). Per scene, the last 50 structure and prop edits made in this tab. Undo button in the tool panel, and Ctrl+Z while a SCN tool is active. Undo sends the inverse intent: add ↔ remove with the same coordinates, the previous door state, the previous prop fields, or re-placing a deleted prop. Each inverse's `ack` (`{ns}`, `{propId}`) **remaps** the old `n` / id in older entries, so undo chains keep working. A rejected inverse drops that entry and shows a Toast. Lost on reload. It amends ADR-0016's "not scene edits", together with fog's server-side undo (decided #196, OQ-SCN-08). | B2, B3 |
| **Props** | | |
| FR-SCN-16 | **Place** (DM, Props tool): pick an image in the asset picker ([FR-ASSET-17](assets-pipeline.md#6-functional-requirements)), then click a cell → `scn.placeProp {sceneId, assetId, col, row, w?, h?, hidden?}`. Runs `assets.require`; default 1 × 1; the footprint must overlap the map. ≤ 200 per scene and ≤ 2,000 per campaign, else `conflict`. | |
| FR-SCN-17 | **Edit** (DM, Props tool): click selects one prop; drag moves it (cell snap); handles resize it (1–20 cells per side). Menu: Rotate 90°, Hide / Reveal, Lock / Unlock, To front / To back, Duplicate, Image…, Delete. Intents `scn.updateProp`, `scn.setPropHidden`, `scn.duplicateProp`, `scn.deleteProp`. A locked prop can't be moved or resized (the menu still works). | OQ-SCN-10 |
| FR-SCN-18 | **Draw:** the `display` image, cover-fitted to the `w × h` footprint (90° / 270° swap the drawn sides) and rotated about its centre; ordered by `z`, then `seq`. With any tool but Props, props take no pointer events (a drag on one pans). Props never block moves and never enter the fit's content box ([FR-MAP-44](scenes-map.md#6-functional-requirements)). | |
| FR-SCN-19 | **Visibility:** `hidden` or fog-hidden (FR-SCN-35) → hidden; else redacted (no `locked`). The `assetId` reaches a player only on a visible prop; reveal = `upsert` ([FR-ASSET-12](assets-pipeline.md#6-functional-requirements)). | |
| **AoE templates** | | |
| FR-SCN-20 | **Shapes**, ~~all with the origin at a vertex~~ *(sprint 4)* origin = any point `(x, y)` in grid units with ≤ 2 decimals (a vertex when snapped, FR-SCN-43). **Sphere / cylinder:** radius `size`. **Cube:** square of side `size`; the origin is a corner; ~~axis-aligned; `angle` picks the quadrant (0 / 90 / 180 / 270)~~ *(sprint 4)* sides along `angle` and `angle + 90°` (0 / 90 / 180 / 270 = sprint 2's quadrants SE / SW / NW / NE). **Cone:** length `size`; its width at any distance = that distance (5e); direction `angle`. **Line:** length `size`, width `width` (default 5 ft), direction `angle`. Angles: 0 = east, 90 = south (screen). Ranges: `size` 5–300 ft step 5; `width` 5–60 step 5; `angle` ~~0–345 step 15~~ *(sprint 4)* 0 ≤ angle < 360, ≤ 1 decimal (15° steps when snapped). | Amended sprint 4 [8] |
| FR-SCN-21 | **Affected squares:** ~~cells whose centre lies inside or on the shape~~ *(sprint 4, [8])* cells **more than 50 % covered** by the shape (FR-SCN-41). Pure `templateCells(template, scene, {cut})` in `@shared/scene-tools/geometry` (same name and signature; it calls FR-SCN-42's helper). Drawing and the count use `cut: true` (cut to the map); `derive` uses `cut: false`, so `fogged` stays right after a map change. Drawn tinted, with the label "‹label› · N squares" at the origin. | OQ-SCN-09 superseded by [8]; X8 |
| FR-SCN-22 | **AoE tool** (DM, players). Panel: shape, size, width (line only), label (0–40 chars). Dragging from ~~a vertex~~ *(sprint 4)* the press point (FR-SCN-43) sets the direction (cone, line, cube) or the size (sphere, cylinder; rounded to 5 ft); release → an **ephemeral** template. One per connection: a new placement replaces it; Clear or Esc removes it. | |
| FR-SCN-23 | **Ephemeral:** signal `scn.template {sceneId, key, shape, x, y, size, width?, angle, label?, dmOnly?}` / `{sceneId, key, end: true}` (*sprint 4:* `x`, `y`, `angle` per FR-SCN-20). ≤ 20 sends/s while dragging, repeated every 1 s at rest. Receivers drop it on `end`, on a snapshot, or after 3 s of silence. Never persisted. Placer colour = role accent (as ping). Receivers compute the squares themselves (FR-SCN-41), so no cell list is ever sent. | Like `map.drag` |
| FR-SCN-24 | **Signal audience** ([ADR-0033](../architecture/adr/0033-signal-audience.md)). **Player sender:** `sceneId` must be the active scene (else `invalid`), then `"all"`. **DM sender:** `"dm"` if `dmOnly`, if the scene isn't active, or if FOG's hook finds every uncut `templateCells` cell fogged; else `"all"`. An `end` frame carries no geometry and routes `"all"`. Player templates are never fog-hidden. Receivers draw only for the scene they show. | S5; F5 |
| FR-SCN-25 | **Keep:** the panel's Keep button turns the ephemeral into a record with `scn.placeTemplate` (same fields; `hidden` = `dmOnly`), then sends `end`. ≤ 20 per scene and ≤ 3 per player per scene, else `conflict`. A player's `sceneId` must be the active scene. The DM may set `placedByPlayerId` (a player of the campaign; fixtures); a player sending it → `invalid`. | OQ-SCN-02; B1 |
| FR-SCN-26 | **Persistent edits.** The placer (`placedByPlayerId = ctx.playerId`) or the DM: move (drag the origin), rotate / resize (panel; *sprint 4:* also the end handle, FR-SCN-45), Delete → `scn.updateTemplate`, `scn.deleteTemplate`. DM only: Hide / Reveal (`hidden`), and "Clear templates" per scene → `scn.clearTemplates` (*sprint 4:* confirm + scope, FR-SCN-44). Others' templates have no menu and can't be dragged. | |
| FR-SCN-27 | **Visibility:** `hidden` or fog-hidden (FOG's `hides`; never for a player-placed template) → hidden; else full (incl. `placedByPlayerId`). | S5 |
| ~~FR-SCN-28~~ | ~~Select creatures inside a template~~: **out** (#196, OQ-SCN-21). | B6 |
| **Diagonal rule** | | |
| FR-SCN-29 | Record `map-settings` per campaign: `{id = campaignId, diagonalRule: "5-10-5" \| "5"}`, default `5-10-5` (#145). The DM sets it in the Ruler tool's panel → `scn.setDiagonalRule`. Everyone receives it. | OQ-SCN-04 |
| FR-SCN-30 | One distance fn, `distanceFt(a, b, rule)` (`@shared/scenes-map/geometry`), drives the ruler ([FR-MAP-22](scenes-map.md#6-functional-requirements)), the movement indicator ([FR-MAP-37](scenes-map.md#6-functional-requirements)) and combat's movement used ([FR-CBT-39](combat-tracker.md#6-functional-requirements); the server reads the row). Rule `5`: `5 × max(dx, dy)`. Template sizes don't use it. | combat seam |
| **Scenes, sync, lifecycle** | | |
| FR-SCN-31 | Through scenes-map's **`sceneHooks`** (`scene-hooks.ts`, created by `fix/fog-core`; signature in FOG's [fog visibility ADR](../architecture/adr/0039-fog-visibility.md) (accepted #196)). `duplicated(env, source, copy)` copies structure and props (new IDs, same `n`), not templates. `deleting(env, scene)` returns every SCN row of the scene as a delete, before the row deletes. All of them go into `SceneDuplicated` / `SceneDeleted` `changes`. | Settled S3; X4 |
| FR-SCN-32 | **Active-scene window:** `scene-structure`, `scene-prop` and `aoe-template` register with `dmWindow: "active-scene"` (as `token` does, set by `fix/active-scene-window`). The DM snapshot holds only the active scene's rows. When the DM views another scene, its client sends `sync.loadScene {sceneId}` once per scene per snapshot. That scene's tokens and SCN rows come back in hub frame order, and the canvas shows "Loading scene…" until they land. Live events still reach the DM for every scene. Players are unchanged (scene gate). | [active-scene window ADR](../architecture/adr/0041-active-scene-window.md) (accepted #196) |
| FR-SCN-33 | Every SCN command commits its rows and one event-log entry in one transaction, then emits the event; IDs and time come from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). All structure ops emit one event name, `StructureEdited`, so players can't tell a lock from a wall edit. Nothing is server-undoable. | |
| FR-SCN-34 | While not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)): SCN tools are disabled except the Layers popover; a polyline in progress is discarded; the ephemeral template stops sending. | |
| FR-SCN-35 | **Fog seam** (S5). Fog subjects: props, DM-placed kept templates, DM-placed ephemeral signals (FR-SCN-24). Every prop or template write that sets or moves a footprint calls `deriveSceneObject(read, {type, sceneId, cells})` (FOG's `derive`) **before** its single write, and stores `fogged` (on the wire only when true). SCN's visibility fns for `scene-prop` and `aoe-template` consult `hides`. Walls are never fog subjects. SCN exports the pure fns `propCells`, `templateCells` and `doorCells`. FOG owns what fog hides. | Settled S5; X7 |
| FR-SCN-36 | **Door fog flag** (#196, OQ-SCN-06), *amended sprint 3 (per player)*: a door's **sample points**: on a door with integer endpoints, the centres of its `doorCells` (exactly sprint 2's cells, so the migration is byte-equal); on a freeform door, per each of its ⌈length⌉ equal pieces, 2 points 0.5 cell either side of the piece's midpoint along the normal (replaces `doorCells` for fog; review A8). FOG writes `doorSeen[n]` = the players who see a sample point (FR-FOG-34) and `f = 1` iff nobody does. `scn.addDoor` sets both (via `derive`); FOG's re-derive updates them and lists the `scene-structure` change. The player redaction keeps a door iff the viewer ∈ `doorSeen[n]`, never sends `doorSeen` or `f`, and stays pure. | X6 |
| **Sprint 3: freeform walls, sight, drag highlight** | | |
| FR-SCN-37 | **Walls block sight** *(#207, OQ-FOG-21 / -24)*: walls and doors whose state ≠ open are **occluders** for FOG's sight polygons (FR-FOG-33); open doors aren't. Pure `sightOccluders(structure) → Segment[]` (`@shared/scene-tools/geometry`). Walls still never reach players (FR-SCN-14). | FOG seam |
| FR-SCN-38 | **Red drag highlight, player** (#202, *#207, OQ-SCN-22*): while a player drags their token, each time the previewed cell changes (debounced 50 ms, ≤ 10 / s, newest wins) the client sends the read-only intent **`map.checkMove {tokenId, col, row}`** (scenes-map, OQ-SCN-26). It runs the move guards in dry run and returns `{ok, hints}`; the wall guard's hint = **one piece**: the **first** segment the from → to line crosses (nearest to `from`), **clipped to 0.5 cell either side of that crossing** (*#207, OQ-SCN-23*; per-crossing pieces would let a scripted client map walls behind walls, review A3). The client draws the piece red (`scn-wall-hint`) on `scn-structure` until the cell changes, the drag ends or a snapshot arrives; a stale ack (older cell) is dropped. The drop still sends `map.moveToken` (the guard decides); FR-SCN-12's flash and Toast stay. DM drags use FR-SCN-13 (no intent). *(Sprint 4, seams S1)* The probe that sends `map.checkMove` moves to scenes-map's drag probe `src/client/common/features/scenes-map/drag-probe.ts` (V8; one in flight, ≤ 10 / s), whose ack carries every guard's hints (SCN wall, FOG sight); SCN's `wall-hint.ts` keeps only drawing the wall piece from that ack. The rule above is unchanged. | Leak: ≤ 1 cell per check |
| FR-SCN-39 | **Structure edits re-derive vision:** every structure command (`scn.addWalls`, `addDoor`, `setDoor`, `removeSegments`) runs FOG's scene re-derive (FR-FOG-35) in its transaction; `StructureEdited.changes` gains the flipped tokens, props, templates, `vision` rows and doors. One event as before. | FOG seam |
| FR-SCN-40 | **Move guard** unchanged in contract ([ADR-0040](../architecture/adr/0040-token-move-guards.md)): read-only, before `derive`; on decimal segments via FR-SCN-10. *(Sprint 3)* A guard may also return a **hint** for `map.checkMove`; guards stay read-only and the dry run writes, logs and emits nothing. | ADR-0040 refined |
| **Sprint 4: freeform templates, coverage, Clear** ([#243](../decisions-log.md) [8], BL-05) | | |
| FR-SCN-41 | **Coverage rule** ([8]): a cell is affected iff the area of (shape ∩ cell) is **more than 50 %** of the cell. Computed **exactly** (decided #245, OQ-SCN-29): cone (triangle), line (rectangle) and cube (square) by clipping the cell square against the convex shape, then the shoelace area; sphere / cylinder by the closed-form circle ∩ rectangle area. Cells whose four corners lie inside count as 100 % without clipping. Tolerance 1e-9 of a cell. **Exactly 50 %** (within the tolerance; decided #245, OQ-SCN-28: a tie counts on one side only): **line, cone:** the cell counts iff its centre lies strictly on the **right** of the template's axis (origin → direction, screen orientation); so a 5-ft line laid east along a grid line covers the one row south of it (measured: as built it covered 2 rows; "> 50 %" alone covers none). **Cube** *(review A10)*: against its two **centre lines** (through the square's centre, along `angle` and along `angle + 90°`): the cell counts iff its centre lies strictly right of either; so ties on two of the four sides count. Measured on 144 snapped cubes (136 tie cells): mean \|squares − area\| 0.44 (0.53 with the cube's own edge as the axis). **Sphere / cylinder:** never. A shape may cover no cell (a 5-ft cone is half a cell): label "0 squares". | [8]; golden cells §13 |
| FR-SCN-42 | **Shared area helper** (*settled by seams S2*: one module for V's fog brush and M's templates): **`src/shared/scenes-map/area.ts`** (`@shared/scenes-map/area`; scenes-map is the base both build on, so neither scene-tools nor fog owns it), pure, no dependency (OQ-SCN-32). **Shapes** (grid units): `circle`, `cone`, `line`, `square` (a template cube), `polygon` (FOG's `{rect} \| {polygon} \| {circle}` geometry accepted as is) and `stroke` (polyline + radius, V's brush). **Modes:** `half` (FR-SCN-41: > 50 % exact area + the one-side tie rule; circle, cone, line, square, polygon), `centre` (cell centre inside; every shape), `distance` (cells within an FR-SCN-30 5/10/5 radius of a cell, rule passed in; V's snapped brush). API: `templateArea(t) → AreaShape`; `cellCoverage(shape) → {col, row, share}[]` (row-major, share > 0); `cells(shape, mode, {axis?, rule?}) → Cell[]`; `snapPoint(p, free) → p` (nearest vertex, or rounded to 0.01 cell); `snapAngle(deg, free)` (15° steps, or 0.1°). Server and both clients call it; `templateCells` (FR-SCN-21) wraps `cells(…, "half")`. A `stroke` in `half` mode is not built (no consumer; see the seams-pass note in §15). | Built first by M0 `fix/area-geom` (S2, §14) |
| FR-SCN-43 | **Snapping** (decided #245, OQ-SCN-30): the AoE press point snaps to the nearest grid vertex and the direction to 15° steps, unless **Ctrl** is held (read on every move: origin free to 0.01 cell, angle to 0.1°), like walls (FR-SCN-08), fog shapes (FR-FOG-18) and the fog brush ([6]). The "Free" chip (`scn-free-chip`) follows the cursor while Ctrl is held. Size and width stay in 5-ft steps (a dragged radius rounds to 5 ft). Moving a kept template's origin and its end handle (FR-SCN-45) follow the same rule. | Same Ctrl everywhere |
| FR-SCN-44 | **Clear templates** (BL-05; scope decided #245, OQ-SCN-31): the DM's "Clear templates on this scene" opens an AlertDialog "Clear N DM templates on this scene?" with a Checkbox **"Also players' kept templates (M)"**, unticked by default; Confirm (disabled while the chosen scope holds 0) sends `scn.clearTemplates {sceneId, players?}` (absent = false); Cancel / Esc sends nothing. Server: deletes the scene's kept templates with `placedByPlayerId = null`, or every kept one with `players: true`; nothing to delete → no write, no event. Ephemeral templates are signals, never touched. | Was: no confirm, all kept (sim-6 #9, sim-7 #14) |
| FR-SCN-45 | *(In scope, decided #245, OQ-SCN-36)* **End handle** (kept templates; placer or DM, FR-SCN-26): the selected template shows an origin handle (drag = move) and an end handle (cone, line, cube: direction; sphere, cylinder: radius in 5-ft steps). The drag previews locally; release sends one `scn.updateTemplate {x?, y?, angle?, size?}`; others see it on commit (≤ 1 s). Snapping per FR-SCN-43. | |
| FR-SCN-46 | **Compatibility + fog** (FOG seam, FR-SCN-35): existing rows (integer `x`, `y`; `angle` in 15° steps) stay valid and draw the same shapes; only their affected squares follow FR-SCN-41. `derive` and the DM ephemeral audience (FR-SCN-24) use FR-SCN-41's uncut cells; a template with no covered cell samples the cell holding its origin. A **boot re-derive** (scene-tools' feature start, one transaction, before the hub accepts connections) re-runs `derive` for every DM-placed kept template whose `fogged` / `seenBy` would change under the new cells; rerun = no-op. | No stale `fogged` after the rule change |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, semantic tokens only; the map is the hero. Test IDs: [Appendix A](#appendix-a-test-ids).

- **Tool rail** (FR-SCN-06). DM: Structure, Props, AoE, Layers (Popover). Player: AoE. Each tool opens a small panel (a Popover anchored to the rail):
  - **Structure:** mode ToggleGroup (Wall · Door · Erase) + Undo.
  - **Props:** "Choose image…" + Undo.
  - **AoE:** shape ToggleGroup, size / width number inputs with ±5 nudges, label Input, Keep, Clear. *(Sprint 4)* DM: "Clear templates on this scene" opens the FR-SCN-44 AlertDialog (shadcn AlertDialog + Checkbox; destructive Confirm). Hint line under the shapes: "Ctrl: free placement".
  - **Ruler** (DM): gains a "Diagonals" ToggleGroup (5/10/5 · 5 ft).
- **DM view:** walls; doors (a glyph per state); every prop and template, with hidden ones in `visibility.hidden` styling; drawing previews on `scn-edit`; handles on the selected prop; the "through wall" tag and **red** crossed segments while dragging; *(sprint 3)* the "Free" chip at the cursor while Ctrl is held in Wall / Door mode; off-grid points drawn as small open dots on the preview.
- **Player view:** doors (open / closed; only those the player sees, FR-SCN-36); visible props; visible templates; their own and others' ephemeral templates; *(sprint 3)* red wall pieces under the drag line before the drop (FR-SCN-38); the blocked-cell flash.
- *(Sprint 4)* **Both views:** a template draws its true outline (off-grid allowed) over the tinted affected squares (one shape per template, memoised per geometry change); "Free" chip while Ctrl is held in the AoE tool; selected kept template: origin + end handles (FR-SCN-45). DM only: the Clear confirm. Same squares on every client (one pure helper, FR-SCN-42).
- **States.**
  - Empty scene: nothing extra.
  - Loading (DM, non-active scene): a "Loading scene…" chip on the canvas; tools stay disabled until the scene loads.
  - Error (prop image): broken-image placeholder (assets-pipeline §7).
  - Disconnected: FR-SCN-34 + live-sync banner.

## 8. Data model

All rows are per campaign; `seq` comes from the DB (CON-20); timestamps from `ctx.clock`. Wire records are compact (no `campaignId`, `seq` or timestamps) to save snapshot bytes; the registry reads those from the row. **JSON leaf fields** ([ADR-0006](../architecture/adr/0006-persistence.md)): `walls`, `doors`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| SceneStructure | id (= sceneId), campaignId, rev, nextN; walls; doors; updatedAt | ID → Scene (cascade), ID, int, int; **JSON** `[n, x1, y1, x2, y2][]`; **JSON** `[n, x1, y1, x2, y2, state, f][]`; timestamp | Created lazily on the first edit; no row = empty. ≤ 2,000 segments. *Sprint 3:* coordinates are numbers ≤ 2 decimals (integers stay valid, no migration) |
| | **doorSeen** *(sprint 3)* | **JSON** `{<n>: playerId[]}` | FOG-written copy (FR-SCN-36); server only, never on any wire |
| Prop | id, campaignId, sceneId, seq; assetId; col, row, w, h, rotation, z; hidden, locked, fogged; createdAt, updatedAt | ID, ID, ID → Scene (cascade), int; ID → Asset (**asset reference**); int ×4 (w, h 1–20), 0/90/180/270, int; bool ×3; timestamp ×2 | ≤ 200 per scene. `fogged` is a server copy from `derive`, never in an intent. Always DM-placed |
| AoeTemplate | id, campaignId, sceneId, seq; shape; x, y; size, width, angle; label; placedByPlayerId; hidden, fogged; createdAt, updatedAt | ID, ID, ID → Scene (cascade), int; cone \| sphere \| cylinder \| cube \| line; ~~int ×2 (vertex)~~ *(sprint 4)* **real ×2, ≤ 2 decimals** (any point); int ×2 (size; width null unless line), ~~int~~ *(sprint 4)* **real `angle`, ≤ 1 decimal, 0 ≤ a < 360**; text 0–40; ID → Player \| null (null = DM); bool ×2; timestamp ×2 | Persistent only; ≤ 20 per scene. `fogged` as on Prop. *Sprint 4:* columns `x`, `y`, `angle` become `real`; existing integer rows stay valid (no data migration; drizzle push) |
| MapSettings | id (= campaignId), diagonalRule, updatedAt | ID → Campaign; `5-10-5` \| `5`; timestamp | Row created on the first set; no row = `5-10-5` |

- **Relations:** Scene 1—0..1 SceneStructure; Scene 1—* Prop, AoeTemplate; Prop → Asset; AoeTemplate → Player; Campaign 1—0..1 MapSettings.
- **Derived:** segment geometry; a door's open / closed for players; `propCells`, `templateCells`, `doorCells`; distance per rule. *(Sprint 3)* `blockingSegments`, `sightOccluders`, door sample points.
- **Client only:** ephemeral templates `key → {from, template, lastAt}` (receivers); undo stacks with the id remap; layer toggles; the loaded-scenes set; prop selection; a polyline in progress; *(sprint 3)* the player's current wall hint pieces (from the latest `map.checkMove` ack); *(sprint 4)* each template's covered cells (memoised per geometry), the Free chip state, a kept template's handle drag.
- **Derived (sprint 4):** `cellCoverage` / `coveredCells` (FR-SCN-41, -42); never stored or sent.
- **Persisted runtime state:** door states and `f`, props, persistent templates, `fogged` copies, the diagonal rule.

## 9. API & events

Envelopes and rejects: [live-sync](live-sync.md). Everything is WS (canvas actions, ADR-0021 D); no REST.

**WS intents** (DM only by default; the scene must be in `ctx.campaignId`, else `not_found`)

| Intent | Who | Validation / ownership |
|---|---|---|
| `scn.addWalls {sceneId, segments [x1, y1, x2, y2][] 1–200}` → `{ns}` | DM | FR-SCN-07 (*sprint 3:* numbers ≤ 2 decimals, also for `scn.addDoor`'s `segment`) |
| `map.checkMove {tokenId, col, row}` → `{ok, hints [{guard, segments [x1, y1, x2, y2][]}]}` *(sprint 3, scenes-map's intent, OQ-SCN-26)* | player (own token, FR-MAP-21), DM | Read-only dry run of the move guards (FR-SCN-38); not logged, no event, no `seq`; errors as `map.moveToken`: hidden, fog-hidden for that player (FOG FR-FOG-11) or unknown → `not_found`, checked first; visible but not theirs → `forbidden` |
| `scn.addDoor {sceneId, segment, state?}` → `{n}`; `scn.setDoor {sceneId, n, state}`; `scn.removeSegments {sceneId, ns 1–500}` | DM | `n` must exist, else `not_found` |
| `scn.placeProp` → `{propId}`; `scn.updateProp {propId, col?, row?, w?, h?, rotation?, z?, locked?, assetId?}`; `scn.setPropHidden {propId, hidden}`; `scn.duplicateProp {propId}` → `{propId}`; `scn.deleteProp {propId}` | DM | `assets.require`; FR-SCN-16/17; moving or resizing a locked prop → `conflict` |
| `scn.placeTemplate {sceneId, shape, x, y, size, width?, angle, label?, hidden?, placedByPlayerId?}` → `{templateId}` | DM, player | FR-SCN-20, 25. Player: active scene only; `hidden` and `placedByPlayerId` are not in the player schema |
| `scn.updateTemplate {templateId, x?, y?, size?, width?, angle?, label?, hidden?}`; `scn.deleteTemplate {templateId}` | DM, placer | Player: hidden or unknown → `not_found`, not their own → `forbidden`; `hidden` is DM only |
| `scn.clearTemplates {sceneId, players?}` *(sprint 4: `players`, FR-SCN-44)*; `scn.setDiagonalRule {rule}` | DM | `players` absent = false (DM-placed only); a player sending it → `forbidden` (default-DM intent) |
| *(Sprint 4)* `scn.placeTemplate` / `scn.updateTemplate` / signal `scn.template` | as above | `x`, `y`: numbers ≤ 2 decimals within today's coordinate bound (`COORD_MAX`, as wall points; 3 decimals → `invalid`); `angle`: 0 ≤ a < 360, ≤ 1 decimal; `size`, `width` unchanged (5-ft steps) |
| `sync.loadScene {sceneId}` → `{records {<type>: Record[]}}` | DM | Owned by the window ADR (FR-SCN-32) |

**Record types**

| Type | Scope | Player visibility (DM `full`) | Snapshot |
|---|---|---|---|
| `scene-structure` | scene, `sceneOf = id`; `dmWindow` | **redacted** `{id, doors [n, x1, y1, x2, y2, open 0 \| 1][]}`: no walls; locked sent as closed; ~~`f = 1` doors dropped~~ *(sprint 3)* doors the viewer is not in `doorSeen` of dropped; never `doorSeen` | DM: active scene (+ loads); player: active scene |
| `scene-prop` | scene, `sceneOf = sceneId`; `dmWindow` | `hidden` or fog-hidden → hidden; else redacted (no `locked`) | same |
| `aoe-template` | scene, `sceneOf = sceneId`; `dmWindow` | `hidden` or fog-hidden (DM-placed only) → hidden; else full | same |
| `map-settings` | campaign | full | the campaign's row (or none) |

**Signal:** `scn.template` (DM, player), audience per FR-SCN-24. Not logged, persisted or in a snapshot.

**Domain events.** All logged; none transient or undoable. Visibility: each change follows its record type above (transition matrix, FR-SYNC-19); players see only `cause.name`.

| Event | Payload | Changes |
|---|---|---|
| `StructureEdited` | `{sceneId, op: addWalls \| addDoor \| removeSegments \| setDoor, ns}` | `scene-structure` upsert; *(sprint 3)* + FOG re-derive rows: flipped tokens, props, templates, `vision` (FR-SCN-39) |
| `PropPlaced` / `PropUpdated` / `PropHidden` / `PropRevealed` / `PropDuplicated` / `PropDeleted` | `{propId}` | `scene-prop` upsert / delete |
| `TemplatePlaced` / `TemplateUpdated` / `TemplateDeleted` / `TemplatesCleared` | `{templateId}` / `{sceneId, templateIds}` (*sprint 4:* + `players: bool`) | `aoe-template` upsert / delete. Players get deletes only for rows they had (visibility unchanged) and the cause name; a DM-only clear sends a player no delete for their own templates |
| `DiagonalRuleSet` | `{rule}` | `map-settings` upsert |
| MAP `SceneDuplicated` / `SceneDeleted` | unchanged | + SCN rows from `sceneHooks` |
| FOG `FogEdited` / `FogUndone` | FOG's | + `scene-prop` / `aoe-template` rows whose `fogged` flipped; `scene-structure` if a door's `f` flipped |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Walls, doors, props, Layers, diagonal rule | ✓ (any scene) | ✗ | Default-DM intents |
| Move a token through a wall / non-open door | ✓ | ✗ | Move guard (FR-SCN-11) |
| Check a move before the drop (`map.checkMove`, sprint 3) | ✓ (not needed: FR-SCN-13) | own token on the active scene | FR-MAP-21 checks, read-only |
| Place ephemeral / persistent template | ✓ (any scene; may be DM-only) | ✓ active scene, ≤ 3 kept | Signal audience; FR-SCN-25 |
| Edit / delete persistent template | any | own | FR-SCN-26 |
| *(Sprint 4)* Clear templates (DM-placed; + players' with the box) | ✓ | ✗ | Default-DM intent (FR-SCN-44) |
| *(Sprint 4)* Free placement (Ctrl) | ✓ | ✓ | zod decimals (FR-SCN-20) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** their ephemeral template vanishes for others within 3 s; persistent ones stay. A drag in progress snaps back unsent (FR-MAP-28). On reconnect: a snapshot with the current doors and props.
- **DM disconnect / reconnect:** a polyline in progress is discarded (FR-SCN-34). The undo stack survives a reconnect (client memory) but not a reload. The reconnect snapshot holds only the active scene's tokens and SCN rows; the client reloads the viewed scene (FR-SCN-32).
- **Server crash mid-action:** one transaction per command. Before commit: nothing. After commit: in the snapshot (crash-hook tests, §13). Ephemeral templates are lost (accepted). A blocked move never wrote anything.
- **Concurrent edits:**
  - Adds and removes go by `n`, never a whole-list replace, so two DM tabs don't lose each other's walls; `rev` increments per edit.
  - A door closed while a player drags: the guard reads the committed state at drop.
  - Undo of an edit another tab already reverted → `not_found` → the entry is dropped with a Toast.
- **Scene switch:** players' ephemerals on the old scene are dropped by the receivers' scene filter; persistent templates stay with their scene. Activating a scene puts its SCN rows into every player's resync snapshot.
- **Recalibration / map change:** content follows the grid; entries off the new map stay drawn and editable; `fogged` uses uncut cells (FR-SCN-21).
- **Invalid / malicious input:** strict zod; another campaign's IDs → `not_found`; a player sending `hidden`, `placedByPlayerId` or a DM intent → `invalid` / `forbidden`; labels are rendered as text; frames > 64 KB are closed (CON-13).
- **Sprint 3:**
  - A door closed while a player drags: the next `map.checkMove` (or the drop) sees it; a hint can lag one ack (≤ 1 RTT) behind; the guard at drop decides.
  - Disconnect mid-drag: no ack arrives; the hint clears with the drag (FR-MAP-28). Reconnect: hints are never in a snapshot.
  - Freeform points: an endpoint off the map ± 1 or with 3 decimals → `invalid`; a 0.04-cell segment → `invalid`; the magnet never moves an existing segment.
  - A wall added across a player's sight removes what it hides in the same `StructureEdited` (FR-SCN-39).
- **Sprint 4:**
  - Player disconnect / reconnect mid-placement: the ephemeral stops sending, others drop it after 3 s (unchanged); a kept template's handle drag in progress is dropped unsent (local preview only). Reconnect: the snapshot carries kept templates with their decimal fields; every client recomputes the same cells.
  - DM disconnect with the Clear dialog open: Confirm is disabled while not `live` (FR-SCN-34); nothing sent.
  - Server crash: `scn.clearTemplates`, `scn.placeTemplate` (decimals) commit rows + log + event in one transaction (before → nothing, after → in the snapshot; crash-hook tests). The boot re-derive (FR-SCN-46) runs before connections, so a crash mid-way leaves the old copies and the next boot redoes it.
  - Concurrent: a player keeps a template while the DM clears DM-only → the player's survives; the DM clears with players' while a player edits theirs → the edit gets `not_found` (Toast), as any deleted template.
  - Two clients disagree on squares: impossible by construction (one pure helper, exact arithmetic with a fixed tolerance); golden tests pin the cells.
  - Invalid: 3-decimal origin, angle 360 or 12.25 → `invalid`; `players` from a player → `forbidden`.
- **Accepted leaks:**
  - A refused move tells the player something blocks that line (that is the feature). *(Sprint 3)* Before the drop, `map.checkMove` shows ≤ 0.5 cell either side of the **first** crossing only, also under fog (OQ-SCN-23); probing many cells still tells the player whether **something** blocks each line from the token (an oracle, not geometry); the sight polygon's edges show walls inside the player's own sight (FOG).
  - `StructureEdited` upserts tell players the DM edited the active scene's structure, but not what.
  - Positions and states of doors outside fog.

## 12. Performance & bandwidth

**Snapshot (hard constraint, CON-44).** Ceiling 786,432 B in sprint 2 (the tables below are that gate's record). *Sprint 3 (#208):* DM ceiling **1 MiB** (1,048,576 B), players 512 KiB, the 100 KiB guard dropped; V0 lands it. SCN adds no snapshot bytes in sprint 3 beyond FOG §12's figures (heavy DM 674,186 B under OQ-FOG-30 B, 374,390 left). Arithmetic and per-item sizes: [Appendix B](#appendix-b-snapshot-arithmetic).

Measured by spec-fog-of-war with the realistic-heavy harness on `main`. Fog and SCN rows are prototype records with the specs' wire shapes. Same table as FOG §12.

| Item | Bytes | Kind |
|---|---|---|
| Heavy DM today (`main`) | 781,917 | measured |
| Heavy player P1 today | 273,606 | measured |
| `fog` rows (30) | 5,045 | measured, prototype rows |
| `"fogged":true` on 206 tokens | 2,884 | measured, prototype field |
| One typical SCN scene (DM): 150 walls, 10 doors, 15 props, 3 kept templates, `map-settings` | 7,384 | measured, prototype rows |
| `effect-preset` rows (16: 10 campaign + 6 character) | 18,445 | measured |
| Tokens not on the active scene (240) | ≈ 121,125 | measured (B vs base) |
| **Base: today + fog + `fogged` + one SCN scene** (SCN active-scene window assumed) | **797,382** | measured; **10,950 B over** 786,432 |
| Player P1 with the active fog row + SCN player records | 281,267 (243,021 left of 524,288) | measured |

| Option (OQ-SCN-01 = OQ-FOG-04) | Heavy DM | Left of 786,432 B | Cost |
|---|---|---|---|
| (A) All effect presets (campaign + character) load on demand over the window's WS load; **reopens #190 OQ-MOD-14 / -15** | 778,920 | 7,512 B | MOD server, client and tests change; separate `fix/mod-presets-on-demand` (MOD's owner). Leaves nothing for sprint 3 |
| **(B) Token window + SCN window (decided #196)**: the DM snapshot carries only the active scene's tokens and SCN records; others load with `sync.loadScene` | **676,257** | **110,175 B** | Window ADR covers `token`; built first as `fix/active-scene-window` (ws / snapshot lock). Presets untouched (#190 stands) |
| (C) Raise the DM ceiling (DM only) | 797,382 | needs ≥ 797.4 KB; at 1 MiB: 251,194 B | No code. The DM client usually runs on the host (ADR-0003): cost is build time and memory, not tunnel bandwidth |

- Estimate, not offered at the gate: campaign presets only on demand ≈ 785.9 KB, ≈ 0.6 KB left.
- **Players:** + ≈ 3.6 KB per typical scene (measured with fog: P1 281,267 B of 512 KiB). Event frames: a structure upsert ≤ 44 KB to the DM; doors only to players.
- **Move guard:** O(segments) intersection tests, ≤ 2,000 at the cap. Target ≤ 1 ms p95 per move (unit benchmark). The structure row is read once per move, or cached by `rev`.
- **Canvas:** walls are one Konva shape; props are cached image nodes (≤ 200); affected squares are one shape per template, memoised per template change. ≤ 8 Konva layers (FR-SCN-02). **Review check:** Chrome trace while panning Goblin Ambush with the typical scene: median frame ≤ 20 ms.
- **Signals:** an ephemeral template is ≈ 250 B × ≤ 20/s per dragging sender, 1/s at rest; ≈ 30 KB/s fan-out to 6 players over the tunnel at worst.
- **Sprint 3 (measured with the FOG probe, FOG §12):** a `map.checkMove` ack with 2 clipped segments = 119 B; ≤ 10 / s while the previewed cell changes ≈ 1.2 KB/s down per dragging player, plus ≈ 70 B intents up; server cost = one guard run (≤ 1 ms p95 at 2,000 segments, as FR-SCN-11). Decimal coordinates add ≤ 3 B per freeform number to a wall tuple (arithmetic: `12.25` vs `12`; a fully freeform typical scene ≈ +1.8 KB on the DM's windowed structure row, inside FOG §12's headroom). A structure edit adds FOG's re-derive (≤ 60 ms at caps, FOG §12) to its transaction.

**Sprint 4 (measured by spec-maptools, 2026-10-17;** throwaway probe on `main` @ 0b254f2: `buildRealisticHeavy` + the active battle scene filled to the template cap, `snapshotSizes`; real sockets on `scene-tools` for signal frames; a hand-rolled coverage prototype under `bun`. Not committed.)

| Item | Bytes / time | Kind |
|---|---|---|
| Heavy DM today (3 templates on the active scene) | 670,433 B | measured |
| Heavy DM, active scene at the cap (20 kept templates, 40-char labels), integer fields | 676,103 B | measured |
| **Same, freeform** (2-decimal `x`, `y`; 1-decimal `angle`) | **676,270 B** (+167 B, **+8.3 B per row**); **372,306 B left of 1 MiB** | measured |
| Players at that cap (19 visible templates) | 282,307–285,367 B; **≥ 238,921 B left of 512 KiB** | measured |
| `scn.template` signal frame (received, player cone) | 263 B; freeform prototype 270 B (+8 B) | measured |
| Coverage, exact, per template (FR-SCN-41) | typical (20-ft sphere, 15-ft cone, 60-ft line, 15-ft cube) ≤ 0.04 ms; worst 300-ft sphere 2.2 ms (11,304 cells), 300-ft cone 1.3 ms | measured, prototype |
| Coverage, 8×8 / 4×4 sample points | 300 ft: 6.5–11.7 ms / 2.2–3.0 ms; differ from exact on 0.5 % / 1.6 % of 128,017 cells (2,000 random freeform templates); the old centre rule differs on 0.6 % | measured, prototype |

- No cell list is ever sent: every client computes the squares (FR-SCN-23). Clear templates adds no bytes (one `TemplatesCleared` event with deletes, as today).
- **Canvas:** one shape per template (outline + tinted cells), memoised per geometry change; recomputed per ephemeral frame (≤ 20 / s, ≤ 2.2 ms at the 300-ft worst case). No new Konva layer (BL-07).

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:`, a temp asset dir, port 0; walkthroughs on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), AGENTS §9.6). Tests are named after FRs.

**Fixtures** (`fixtures/units/scene-tools/`; Goblin Ambush is 20 × 14 cells):

| Key | Contents | Requires |
|---|---|---|
| `scn-prop-images` | Committed SVGs `prop-barrel`, `prop-table`, `prop-chest` (`fixtures/assets/props/`), ingested | `images` |
| `scn-walls` | Goblin Ambush structure: walls at x = 8 for y 0–5, 6–11 and 12–14; door d1 (8, 5)–(8, 6) **closed**; door d2 (8, 11)–(8, 12) **locked** | `battlemap` |
| `scn-props` | Barrel (5, 3) 1 × 1; table (4, 11) 2 × 1, rotation 90; **hidden** chest (17, 12) | `scn-prop-images`, `battlemap` |
| `scn-templates` | Kept sphere 15 ft at vertex (3, 8), `placedByPlayerId: player-1` (DM override, FR-SCN-25), label "Spirit Guardians"; **hidden** DM cube 10 ft at (12, 12), label "Glyph" | `battlemap`, `player-1` |

- **Bundle `scene-tools`** = `scenes` + the four units. `session-sim` stays unchanged: walls would refuse existing eastward moves (B7). The sprint-gate regression walks a wall and a template from `scene-tools`. The CON-44 heavy scenario gains one typical prepped active scene.
- **Fog × SCN** (X5): FOG owns the fixture `fog-scn` (a barrel, a DM kept template "Trap" and a door, all in fog), its leak strings, the DM-ephemeral routing test and the walkthrough step (FOG §13, after both client slices). SCN builds the call sites (FR-SCN-24, 35, 36).
- **Leak strings / properties** (player frames): "Glyph"; `prop-chest`'s asset ID (until it is revealed); no `walls` key; no door state `2`; no `scene-structure`, `scene-prop` or `aoe-template` from a non-active scene; no `scn.template` signal with `dmOnly` or from a non-active scene. *(Sprint 3)* no `doorSeen` key; a `map.checkMove` ack carries at most one piece, ≤ 1 cell long, of the first segment the line from → to crosses; Goblin's id never in a reject while `player-1` can't see it.
- **Sprint 3 fixture:** the freeform wall `[4.5, 3.25, 6.75, 5.5]` is part of FOG's `vision-crypt` (bundle `vision`, a patch that adds one wall, seams S10); `scn-walls` and bundle `scene-tools` are unchanged and must pass as in sprint 2.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-SCN-10 blocking` (cross, touching an endpoint, collinear, diagonal through a jamb, open door passes, closed / locked block, Large token centre, DM skipped) + a benchmark at 2,000 segments; `FR-SCN-07` (dedupe both directions, length 0, bounds, cap); `FR-SCN-21 templateCells` (golden cells per shape, each angle step, cut vs uncut); `FR-SCN-36 doorCells` (axis-aligned, diagonal); `FR-SCN-18` prop footprint with rotation; `FR-SCN-30` distance per rule; `FR-SCN-15` undo reducer (inverse per op; id / `n` remap after a re-add, "door, open, erase, Undo, Undo"; a reject drops the entry; per scene; cap 50); `FR-SCN-23` ephemeral store (end, snapshot, 3 s, scene filter, one per sender); `FR-SCN-03` registry (`clients`, `group`, toggles, duplicate order throws); `FR-SCN-06` tool dispatch (Space pan, Esc to the tool, tokens ignore left-press); visibility matrix (3 types × DM / placer / other player × hidden / locked / `f`) | In-code |
| Integration | **Commands:** each one writes rows + log + one event, IDs from `ctx`; rollback → nothing; caps → `conflict`; a player sending `placedByPlayerId` → `invalid`. **Guard:** `player-1` Mira (2, 7) → (10, 7) is `conflict`, with no event and no `movedFt` change in combat; via open d1 ✓; d2 locked ✗; DM Goblin through the wall ✓; guard before `derive` and hooks. **Leak test:** `player-1` / `player-2` frames per the leak list, through snapshot, lock / unlock, prop hide / reveal and template hide; `StructureEdited` cause only. **Window:** the DM snapshot holds only the active scene's tokens and SCN rows; `sync.loadScene` returns the others and the leak scan covers `ack.records`; convergence per the ADR; edits on a non-active scene reach no player. **Signal:** `scn.template` routing (player → all; DM `dmOnly` → DM tabs only; player on a non-active scene → `invalid`; `end` → all). **Scene hooks:** duplicate copies structure + props but not templates; delete lists every SCN row. **Crash** (`PP_TEST_CRASH`): `scn.addWalls`, `scn.placeProp`, `scn.placeTemplate` at `:before-commit` / `:after-commit` → `state:digest` equals the pre-command state / the committed state. **CON-44:** heavy + `session-sim` under the ceilings | `scene-tools` |
| Unit (sprint 3) | `FR-SCN-07 decimals` (≤ 2 decimals ok, 3 → `invalid`, integers unchanged, min length 0.05, dedupe with decimals); `FR-SCN-10 blockingSegments` on freeform segments (crossing at a decimal point, touching a free endpoint, collinear free segment, scaled integer math matches a rational reference on 10k random cases, same result as the sprint-2 rule on integer data); `FR-SCN-08 freeform gestures` (Ctrl per click, mixed polyline, magnet within / outside 8 px, door into a gap, "Free" chip, Erase Ctrl-drag unchanged); `FR-SCN-38 hint` (clip to ±0.5 cell, several crossings → only the first from `from`, stale ack dropped, cleared on drag end / snapshot / disconnect, debounce + ≤ 10 / s); `FR-SCN-37 sightOccluders` (open door excluded, closed / locked included); `FR-SCN-36 door samples` (integer doors = `doorCells` centres, axis and diagonal; freeform: 2 per cell-length piece) | In-code |
| Integration (sprint 3) | `map.checkMove`: `player-1` Mira (2, 7) → (10, 7) → `{ok: false}` with one piece `[8, 7, 8, 8]`; → (9, 1) crosses the freeform wall at ≈ (5.87, 4.62), then x = 8 at y ≈ 2.79 → one piece of the freeform wall only; → (7, 5) `ok`; Goblin (fog-hidden for `player-1`) → `not_found`, same as Wolf (hidden) and an unknown id (Goblin's id joins the leak test's oracle list); the same for `map.moveToken` and `map.drag` on Goblin; no DB write, log row, event or `seq` change; ack frames scanned by the leak test. **Guard** on the freeform wall `[4.5, 3.25, 6.75, 5.5]`: Mira (2, 7) → (6, 3) `conflict`. `FR-SCN-39`: a wall added between Mira and a token she sees → that token's `delete` for `player-1` in the same `StructureEdited`; door opened → appears. Crash `scn.addWalls:after-commit` with decimals → digest | `vision` |
| E2E (thin) | DM + `player-1`: a blocked move reverts with a Toast; the DM opens d1 and the move succeeds; the player places a sphere, the DM sees it, Keep, reload, it is still there. *(Sprint 3)* While dragging Mira toward (10, 7), `scn-wall-hint` appears before the drop | `scene-tools`; `vision` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`, `fixtures:reset-load scene-tools --profile verify`, `start --profile verify`. **A** DM, **B** `player-1`, **C** `player-2`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, Show to players | B, C open their links | A: walls, d1 closed, d2 with a lock glyph, barrel, table, chest + Glyph translucent, Spirit Guardians. B, C: d1 and d2 both closed, barrel, table, Spirit Guardians; no walls, chest or Glyph (frames: leak list) |
| 2 | — | B drags Mira (2, 7) → (10, 7) | Refused: snap back, Toast "Blocked by a wall or door", cell flash; A, C see Mira at (2, 7) |
| 3 | Drag Goblin (12, 6) → (4, 6) | — | "through wall" tag and highlighted segment while dragging; drop accepted |
| 4 | Double-click d1 (Select tool); lock and unlock d2 | B: Mira → (7, 5), then → (9, 5) | d1 open for B, C ≤ 1 s; both moves accepted; B's frames show d2 closed throughout |
| 5 | Structure: add a door, open it, erase it; Undo, Undo; draw a 3-segment wall; Undo | — | The door comes back, then closes again (remap works); the wall is gone; B, C see no walls, only `StructureEdited` upserts |
| 6 | Props: place a barrel at (6, 12), resize to 2 × 2, rotate, hide; reveal the chest, lock it, drag it | — | B, C see the barrel change and lose it on hide; the chest appears with its image; a locked drag does nothing |
| 7 | — | B: AoE cone 15 ft from (3, 7), drag the direction, Keep; C: sphere 20 ft, then closes the tab | A, C see B's cone live with "N squares", then kept; C cannot delete it; C's sphere vanishes for A, B within 3 s |
| 8 | Clear templates | — | Every kept template is gone for B, C |
| 9 | Ruler panel: Diagonals 5 ft | B rulers (2, 7) → (5, 9) | B reads "15 ft" (was "20 ft"); then back to 5/10/5 |
| 10 | Layers: Walls & doors off, DM-only off | — | A hides them; B, C unaffected |
| 11 | View Cellar; draw a wall; reload; view Cellar again | — | "Loading scene…", then Cellar's Goblin and the wall; B, C get no frame |
| 12 | Duplicate Goblin Ambush, view the copy, delete it | — | The copy has walls, doors and props, no templates; after the delete, A's store holds none of its rows |
| 13 | Hard-kill + restart | B mid-drag, reconnects | Walls, door states, props and kept templates intact; ephemerals gone; `state:digest` equal before / after; no console errors |

**Sprint 3 walkthrough** (bundle `vision`; run with FOG §13, which repeats steps 3 and 6 with vision): A DM, B `player-1`, C `player-2`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| S1 | Structure → Wall: click (10, 2), **Ctrl**-click (12.4, 3.65), double-click; second wall: Ctrl-click (13.1, 4.8), click (15, 6), double-click | — | "Free" chip while Ctrl is held; each polyline mixes vertex and free points; one `StructureEdited` each; B, C frames: no `walls` key |
| S2 | Door mode: click 5 px from (12.4, 3.65), then 5 px from (13.1, 4.8) | — | The door's endpoints land exactly on both wall ends (magnet) and close the gap; B, C get the door only if their characters see it (FR-SCN-36) |
| S3 | Drag Goblin across the new wall | B drags Mira slowly toward (10, 7), back, then toward (6, 3); drops on (6, 3) | A: red crossed segments + "through wall", drop accepted. B: one red piece `[8, 7, 8, 8]` while over (10, 7), gone when back, then one piece of the freeform wall ≈ (5.27, 4.02)–(5.98, 4.73); drop refused: snap back, Toast, flash. C sees Mira stay at (2, 7) |
| S4 | Undo, Undo (the door, the wall) | — | Both gone; red hints never shown to C |

**Sprint 4** (track M). Bundle **`map-tools`** (defined in [scenes-map §13](scenes-map.md#13-test-plan)) = `vision` + `scn-templates` + `mt-templates` + `mt-crowd`.

| Key | Contents | Requires |
|---|---|---|
| `mt-templates` *(new, `fixtures/units/scene-tools/`)* | On Goblin Ambush: **Thunderwave** kept cube 15 ft, origin (1.5, 10.5), angle 300, `placedByPlayerId: player-2` (DM override, FR-SCN-25); **Web** kept DM cube 20 ft at vertex (0, 6), angle 0 (mostly inside the revealed nook, so players see it) | `battlemap`, `player-2` |

- **Golden cells** (exact coverage, one-side tie rule, #245; prototype-computed, the builder's helper must match): Thunderwave = 8 squares (3, 8) (2, 9) (3, 9) (4, 9) (2, 10) (3, 10) (4, 10) (3, 11) (the old centre rule gave 10); a cone 15 ft from (3.37, 7.64) at 37.5° = (4, 8) (5, 8) (4, 9) (5, 9); a snapped 30-ft line from vertex (10, 7) at 0° = (10, 7)–(15, 7) (6 squares; ">" alone: 0, "≥": 12); a free 20-ft sphere at (6.5, 9.25) = 48 squares; *(review A10)* a free 10-ft cube at (0.5, 0.5), 0° (area 4: one full cell, four half cells, four quarters) = **3** squares (1, 1) (0, 1) (1, 2) under the centre-line rule (the cube's-edge axis gives 4, not 5: its ties on the origin edge sit on the axis, not right of it; "≥" 5; "> 50 %" alone 1; no tie rule reaches the area of 4 symmetrically). The builder's helper reproduces these goldens; the reviewer checks them against a brute-force reference.
- **Leak strings / properties** (player frames): no cell list in any frame; a DM-only clear sends a player no delete for a player-placed template; "Glyph" as before.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-SCN-41 coverage 49 / 50 / 51 %`: a 5-ft line east from (0, y0): y0 = 6.99 → row 6 counts (51 %), row 7 not (49 %); y0 = 7.01 → row 7 only; y0 = 7.00 → both at exactly 50 % → row 7 only (right of east), row 6 not; the same line west → row 6 only; a sphere never takes a tie; `FR-SCN-41 cube ties` (the 10-ft cube golden; all 144 snapped cube placements: 136 tie cells, each counted iff right of a centre line, total squares pinned). `FR-SCN-41 exact area`: per-shape cell shares sum to the shape's area (± 1e-9) for 200 seeded random freeform templates incl. 300 ft; matches a 64×64 sampled reference within 1/64 per cell; fully-inside fast path = clipping result. `FR-SCN-41 goldens` (above) incl. "0 squares" for a 5-ft cone. `FR-SCN-42 helper` (`@shared/scenes-map/area`): `snapPoint` (vertex vs 0.01), `snapAngle` (15° vs 0.1°), `templateArea` per shape (cube 0 / 90 / 180 / 270 = sprint 2's quadrants), modes per shape (`half` = the goldens; `centre` = sprint 2's `templateCells` results on every sprint-2 golden; `distance` = `distanceFt` ≤ r for both rules, incl. a radius-0 brush = its own cell; a `stroke` in `centre` / `distance` = the union of its sampled points' results), a non-convex polygon in `half` (clipped against each cell, shares sum to its area), coverage benchmark ≤ 3 ms at 300 ft (p95). `FR-SCN-20 zod`: 2 decimals ok, 3 → `invalid`, angle 359.9 ok, 360 / 12.25 → `invalid`, integer rows unchanged. `FR-SCN-43 gestures`: Ctrl per move, Free chip, radius rounds to 5 ft. `FR-SCN-44 dialog`: counts per scope, Confirm disabled at 0, Cancel / Esc send nothing. `FR-SCN-45 handles` (one update on release, snapped / Ctrl) | In-code |
| Integration | `FR-SCN-44 Clear templates scope`: DM `scn.clearTemplates {sceneId}` → deletes Web + Glyph only, one `TemplatesCleared {players: false}`, Spirit Guardians + Thunderwave stay; P1 / P2 frames get Web's delete (they saw it), no delete of their own templates; again with `players: true` → the rest; nothing left → no event; a player sending it → `forbidden`. `FR-SCN-20 decimals`: place / update / signal with 2-decimal origin and 37.5° → stored and broadcast as sent; convergence. `FR-SCN-46`: a fixture DM template whose `fogged` flips under the new cells → boot re-derive fixes it in one transaction; rerun no-op; per-player snapshots before / after equal except that row. Crash `scn.clearTemplates:before-commit` / `:after-commit` → `state:digest`. CON-44: the heavy test gains the 20-template cap with decimals (DM < 1 MiB, players < 512 KiB) | `map-tools`, heavy |
| E2E (thin) | `// e2e-bundle: map-tools`: `player-1` places a Ctrl cone, Keep → `scn-template` `cells` attr equal on DM and `player-2`; DM Clear (default) keeps it, Clear with the box removes it | `map-tools` |

**Sprint 4 walkthrough:** steps M1–M3, M10 and M12 of the map-tools walkthrough in [scenes-map §13](scenes-map.md#13-test-plan) (freeform cone with its squares, the snapped line tie, Thunderwave's 8 squares, Clear templates confirm + scope, crash with decimals).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [scenes-map](scenes-map.md) | Move-guard registry in `map.moveToken` ([move-guards ADR](../architecture/adr/0040-token-move-guards.md) (accepted #196)); `sceneHooks`; layer entry shape (FR-SCN-03); tool registry + stage dispatch (FR-SCN-06); `distanceFt` rule param; `token` flagged `dmWindow` | complete; changed by the branches below |
| [fog-of-war](fog-of-war.md) | `visibility-hooks.ts` (`derive`, `hides`, `dragToDm`), `scene-hooks.ts`, `deriveSceneObject(read, obj)`; door re-derive (FR-SCN-36); the fog layer (order 30) and tools via SCN's registries; fixture `fog-scn`. *Sprint 3:* FOG v2 consumes `sightOccluders`, door samples, `doorSeen`; owns the re-derive SCN calls (FR-SCN-39) and the `vision` bundle | complete (sprint 2); v2 revised with this spec |
| [live-sync](live-sync.md) | Active-scene window + `sync.loadScene` ([active-scene window ADR](../architecture/adr/0041-active-scene-window.md) (accepted #196)); signal audience (built) | ADR accepted (#196) |
| [combat-tracker](combat-tracker.md) | `movedFt` uses the campaign rule; blocked moves commit nothing | complete (OQ-SCN-17) |
| [assets-pipeline](assets-pipeline.md) | Picker, `assets.require`, `useAssetImage` | complete |
| [fixtures-adapters](fixtures-adapters.md) | Units + bundle above; FIX §8 rows at merge | complete |
| *(Sprint 4)* [fog-of-war](fog-of-war.md) (V) | The brush imports FR-SCN-42 at `@shared/scenes-map/area` (seams S2); FOG's template derive takes the new cells (OQ-SCN-34); V8's drag probe sends `map.checkMove` (S1); V7 (Konva layers ≤ 4, the Layers popover "Fog" switch) merges before M1 (S4) | revised in parallel (track V) |
| *(Sprint 4)* [scenes-map](scenes-map.md) | Bundle `map-tools`, the shared walkthrough, `mt-crowd` | revised with this spec |

**Registries** (BO5; same table as FOG §14):

| Registry | Path | Created by | Who appends |
|---|---|---|---|
| Scene visibility hooks | `src/server/features/scenes-map/visibility-hooks.ts` | `fix/fog-core` | FOG |
| Scene lifecycle hooks `sceneHooks` | `src/server/features/scenes-map/scene-hooks.ts` | `fix/fog-core` | FOG, SCN |
| Move guards `moveGuards` | `src/server/features/scenes-map/move-guards.ts` | `fix/scn-core` | SCN |
| Canvas tools `canvasTools` | `src/client/common/features/scenes-map/canvas-tools.ts` | `fix/scn-core` | SCN, FOG |
| Canvas layers (existing) | `src/client/common/features/scenes-map/canvas-layers.ts` | built | MAP, SCN, FOG |

**Shared changes** (builders report `shared change needed:` per AGENTS §9.9):

| Shared file | Change | Branch |
|---|---|---|
| `src/server/ws/`, `src/shared/protocol/`, scenes-map `token` registration | `dmWindow: "active-scene"`, `sync.loadScene`, convergence + leak helpers (incl. `ack.records`), DM client loaded-scenes set; `token` flagged; CON-44 test re-baselined | `fix/active-scene-window` (ws / snapshot lock; first) |
| ★ `src/server/db/` | Tables `scene_structure`, `prop` (+ `fogged`), `aoe_template` (+ `fogged`), `map_settings`; schema lock after `fix/fog-core` | `fix/scn-core` |
| `src/shared/events/` | `scene-tools.ts`: the §9 events | `fix/scn-core` |
| `src/server/features/scenes-map/` (MAP lock) | `move-guards.ts`, run in `map.moveToken` before `derive`; SCN lines in `scene-hooks.ts` | `fix/scn-core` |
| `src/client/common/features/scenes-map/` (canvas lock, with FOG) | `tool-store.ts` (open `MapTool`); `MapCanvas.tsx` (stage dispatch to the active registry tool, Space pan, Esc, tokens ignore left-press while drawing); `layers.ts` (entry shape, `group`); `canvas-tools.ts`; `ToolRail.tsx`; `@shared/scenes-map/geometry` `distanceFt(rule)` | `fix/scn-core` |
| Combat hook | FR-CBT-39 reads `map-settings` | `build/scene-tools-settings` (BO2) |
| Docs | Protocol: new SCN section; data model: four tables; AGENTS §9.9 registry list (table above); AGENTS §9.3 `fixtures/assets/props/`; glossary (OQ-SCN-19); FIX §8 | integrator |

**Build order:** `fix/active-scene-window` → `fix/fog-core` → `fix/scn-core` → the SCN slices ∥ the fog client slice (needs `canvas-tools.ts`). `build/scene-tools-settings` goes after fog's last server slice, which carries FR-FOG-14. P2's canvas fixes merge first.

| Slice | Contents | Touches |
|---|---|---|
| `fix/scn-core` | Shared rows above, `derive` call sites, geometry lib (`@shared/scene-tools/geometry`), empty SCN layers registered, CON-44 heavy scene | Schema ★, canvas ★ |
| `build/scene-tools-structure` | Structure commands, guard, door `f`, layer, tool, door menu, DM hint, undo helper, `scn-walls` | Own files + registry lines |
| `build/scene-tools-props` | Props commands, layer, tool, menu, `scn-prop-images`, `scn-props` | Own files |
| `build/scene-tools-templates` | Template records + signal, layer, AoE tool, `scn-templates` | Own files |
| `build/scene-tools-settings` | Layers popover, diagonal rule panel + wiring, combat `movedFt` rule | `ToolRail` panel slot, combat hook |

**Sprint 3** (track V; order and the core in [FOG §14](fog-of-war.md#14-dependencies)): `fix/vision-core` (V0) lands the shared parts; this spec's slice is V4. Order (review A10): **V0 → V5 → V1 → (V4 ∥ V2) → V3**; canvas lock one branch at a time (seams S3): V1 → V4 → V3; V4 runs in parallel with FOG's server slice V2.

| Slice | Contents | Touches |
|---|---|---|
| V0 `fix/vision-core` (FOG-owned) | `doorSeen` column; decimal zod for segments in `@shared/scene-tools/schemas.ts`; scaled `blockingSegments` + `sightOccluders` in `@shared/scene-tools/geometry`; scenes-map `map.checkMove` + guard `hint` in `move-guards.ts` (ADR-0040 refined); structure commands call FOG's re-derive (no-op until V2) | ★ db, scenes-map (MAP lock), scene-tools shared files |
| V4 `build/walls-freeform` | Ctrl drawing + magnet + "Free" chip, wall guard hint line, player `map.checkMove` client + red pieces, DM red hint, tests, walkthrough S1–S4 | scene-tools folders only; `scn-structure` layer (canvas lock, after V1, before V3); no new Konva layer |

**Sprint 4** (track M; full split with MAP and SHELL slices in [scenes-map §14](scenes-map.md#14-dependencies)). Seams with V (fog-of-war): the fog brush imports FR-SCN-42's helper (OQ-SCN-33); V edits the canvas first.

| Slice | Contents | Touches (AGENTS §9.9) |
|---|---|---|
| M0 `fix/area-geom` (first, lock-free, pure; wave 1) | `src/shared/scenes-map/area.ts` (FR-SCN-42, seams S2) + unit tests and goldens; no caller switched yet (no behaviour change) | the new file + its test only. Must merge before V9's brush imports it |
| Mc `fix/maptools-core` (schema lock, seams S5: V6 → R0 → **Mc** → C-art core; wave 3) | ★ `aoe_template.x`, `y`, `angle` → `real`; decimal zod for place / update / signal; `scn.clearTemplates {players?}`; `TemplatesCleared.players` (`src/shared/events/scene-tools.ts`); `templateCells` → coverage (FR-SCN-21); FR-SCN-46 boot re-derive; CON-44 heavy at the template cap | ★ `src/server/db/`, ★ `src/shared/events/`, scene-tools server + shared (own); docs: data model §25 + protocol §36 rows (integrator) |
| M1 `build/aoe-freeform` (seams S4: after V7, in parallel with V9 / V10; own folders + append-only registries only, drawing inside V7's layer scheme; wave 4) | AoE tool: Ctrl / Free chip, decimal origin + angle, end handle, coverage drawing + count; Clear confirm + scope (FR-SCN-44, client + the command's `players` rule); `mt-templates` + the `map-tools` bundle line; e2e | scene-tools client folder, `TemplatesLayer.tsx`, `aoe-tool.tsx`; `fixtures/bundles/index.ts` (append) |

## 15. Open questions

Sprint-2 rows: all decided at DM gate 2 (#196, "go with picks") or settled earlier; OQ-SCN-05 (blocking rule) stands on freeform segments; OQ-SCN-06 (doors under fog) is refined per player by FR-SCN-36. Glossary rows stay for the integrator. Sprint-3 rows follow the table.

| ID | Question | Decision | Affects |
|---|---|---|---|
| OQ-SCN-01 (= OQ-FOG-04) | CON-44 headroom for fog + scene tools | **Decided (#196): (B)** token window + SCN window (110,175 B left, measured, §12); presets stay in the snapshot (#190 stands); built first as `fix/active-scene-window`. Rejected: (A) presets on demand, (C) raise the ceiling | live-sync, FOG, scenes-map |
| OQ-SCN-02 | Templates ephemeral or persistent | **Decided (#196):** ephemeral (signal) by default, Keep → record | live-sync |
| OQ-SCN-03 | Who places templates | **Decided (#196):** DM and players | — |
| OQ-SCN-04 | Diagonal rule | **Decided (#196):** campaign setting, 5/10/5 default, 5 ft option | scenes-map, combat-tracker |
| OQ-SCN-05 | Blocking rule | **Decided (#196):** straight line between footprint centres | — |
| OQ-SCN-06 | Doors under fog | **Decided (#196):** server-written per-door fog flag; the player redaction drops fully fogged doors (FR-SCN-36). Walls are never sent to players | FOG |
| OQ-SCN-07 | Who opens doors | **Decided (#196):** DM only; locked is a DM marker | — |
| OQ-SCN-08 (= OQ-FOG-08) | Undo for scene editing | **Decided (#196):** both as specified: fog = server per-scene stack, depth 20; structure / props = client inverse intents, 50 per scene, lost on reload; both amend ADR-0016's "not scene edits" | ADR-0016, FOG, glossary |
| OQ-SCN-09 | Affected squares | **Decided (#196):** cell centre inside the shape | — |
| OQ-SCN-10 | Prop size / angle | **Decided (#196):** cells 1–20, 90° steps | — |
| OQ-SCN-11, 12, 14, 15, 16 | Layer registry home; FOG seam; scene hooks; DM drag hint; tool registry | **Settled (S3 / S5 / S6 + review):** `canvas-layers.ts` with SCN's entry shape; fog subjects per FR-SCN-35; `scene-hooks.ts` (FR-SCN-31); the hint reads the existing `pointers.drag`; `canvas-tools.ts` with stage dispatch | — |
| OQ-SCN-13 | scenes-map: wall check | **Decided (#196):** move-guard registry that may reject; [move-guards ADR](../architecture/adr/0040-token-move-guards.md) accepted | scenes-map |
| OQ-SCN-17 | combat-tracker | **Decided (#196):** `movedFt` per campaign rule (in `build/scene-tools-settings`); nothing on blocked moves | combat-tracker |
| OQ-SCN-18 | live-sync: DM window | **Decided (#196):** tokens + SCN records windowed to the active scene, `sync.loadScene` in hub frame order; [active-scene window ADR](../architecture/adr/0041-active-scene-window.md) accepted | live-sync, scenes-map, combat-tracker |
| OQ-SCN-19 | Glossary | Rename "AoE prop" → "AoE template"; add Prop, Wall, Door, Structure, DM-only layer, Ephemeral template, Diagonal rule, Move guard, Canvas layer (vs Layer); one Undo row covering combat, fog and scene drawing. **Owner: integrator** | glossary |
| OQ-SCN-20 | `session-sim` content | **Ruled (B7):** unchanged; walls and templates are walked from `scene-tools` | — |
| OQ-SCN-21 | Scope: "Select creatures inside" a template | **Decided (#196): out** | combat-tracker |

**Sprint 3** (decided at sprint-3 gate 1, **#207**, 2026-10-16; rejected options struck for the record)

| ID | Question | Decision (options kept) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SCN-22 | How does a player's client know a wall is under the drag (players never get walls, FR-SCN-14)? | **Decided (#207, G14): A server dry run `map.checkMove` per previewed cell** (exact guard rule, 119 B acks, ≤ 1 RTT lag). Rejected: ~~B send walls to players~~ (contradicts #196 / FR-SCN-14), ~~C send players the walls they have seen~~ | — | live-sync, FOG |
| OQ-SCN-23 | How much of the wall is highlighted? | **Decided (#207, G14): A 0.5 cell either side of the first crossing from the token, one piece per check**. Rejected: ~~B the whole crossed segment~~ (outlines fogged rooms), ~~C a piece at every crossing~~ (maps the layout behind walls, review A3) | — | FOG |
| OQ-SCN-24 | Freeform snapping | **Decided (#207, bulk): A Ctrl = free point; an endpoint magnet (8 px) in both modes**. Rejected: ~~B no magnet~~ | — | — |
| OQ-SCN-25 | Do walls block sight? | **Decided (#207, G7)** with FOG's OQ-FOG-21 / -24: **walls + doors not open block sight** | — | FOG |
| OQ-SCN-26 | **scenes-map:** host the dry run as `map.checkMove` (all move guards, read-only) and let a guard return a `hint` ([ADR-0040](../architecture/adr/0040-token-move-guards.md) refined) | **Decided (#207; ADR-0042 accepted): A in scenes-map**. Rejected: ~~B an SCN-only `scn.checkPath`~~ (duplicates FR-MAP-21 checks) | — | scenes-map, ADR-0040 |
| OQ-SCN-27 | Glossary | **Settled by seams S9:** integrator adds after the gate. **Wall** → "A segment between two points (grid vertices, or free with Ctrl) that blocks player token moves and sight"; **Door** → "…; hidden from a player until a point beside it is in their sight"; add **Wall hint** | no · integrator | glossary |

**Sprint 4** (track M). Decided by the DM before the spec: freeform templates, "> 50 % covered" ([8]). Every row below decided at sprint-4 gate 1 (**#245**, 2026-10-17) or settled by the seams ruling; rejected options struck for the record.

| ID | Question | Decision | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SCN-28 | A cell covered exactly 50 %: does it count? (measured: a snapped 5-ft line along a grid line covers 2 rows at exactly 50 %) | **Decided** (DM, sprint-4 gate 1, #245; G28): **"> 50 %", and a tie counts on one side only**: right of the direction for lines and cones, right of either centre line for cubes, never for spheres (a 5-ft line covers exactly 1 row; FR-SCN-41). Rejected: ~~strictly > 50 %~~ (the line highlights nothing), ~~≥ 50 %~~ (2 rows) | — | — |
| OQ-SCN-29 | How is coverage computed? | **Decided** (DM, sprint-4 gate 1, #245; bulk): **exact area** (polygon clipping + closed-form circle; ≤ 0.04 ms typical, 2.2 ms at 300 ft). Rejected: ~~8×8 / 4×4 sample points~~ | — | — |
| OQ-SCN-30 | Snapping for freeform templates | **Decided** (DM, sprint-4 gate 1, #245; G29): **snapped (vertex, 15°) unless Ctrl**, like walls, fog shapes and the brush (FR-SCN-43). Rejected: ~~free unless Ctrl~~, ~~always free + a Snap toggle~~ | — | fog-of-war (brush) |
| OQ-SCN-31 | Clear templates scope (BL-05) | **Decided** (DM, sprint-4 gate 1, #245; G31): **confirm "Clear N DM templates?" with "Also players' kept templates (M)" unticked** (FR-SCN-44). Rejected: ~~clear all with a count~~, ~~two buttons~~ | — | — |
| OQ-SCN-32 | Dependency for coverage / clipping | **Decided** (DM, sprint-4 gate 1, #245; G2): **none; hand-rolled** (≈ 150 lines, exact). Rejected: ~~`polygon-clipping`~~, ~~`martinez-polygon-clipping`~~, ~~`@turf/intersect`~~, ~~`clipper2-js`~~ | — | ADR-0001 (unchanged) |
| OQ-SCN-33 | **fog-of-war (V):** one shape / snap / coverage helper for the fog brush ([6]) and templates | **Settled by seams S2:** one module `src/shared/scenes-map/area.ts`, modes `half` / `centre` / `distance`, shapes circle, cone, line, square, polygon / stroke; built first by M0 `fix/area-geom`, V9 imports it (FR-SCN-42). *Seams-pass note (M):* a `stroke` in `half` mode (exact area of a union of capsules) is not built in M0: no consumer needs it (templates have no strokes; V's snapped brush uses `distance`); V asks if a freeform brush ever needs it | — | fog-of-war |
| OQ-SCN-34 | **fog-of-war:** FOG's template `derive` and the DM ephemeral audience (FR-SCN-24) switch to FR-SCN-41's cells, with FR-SCN-46's boot re-derive; FOG's leak tests on `fog-scn` ("Trap") re-run under the new cells | **Accept as FR-SCN-46** (call site is SCN's; FOG's rule unchanged); ~~FOG keeps centre cells for fog only~~ | no · owner: **Mc `fix/maptools-core`** (switch + boot re-derive; re-runs FOG's `fog-scn` leak tests) | fog-of-war |
| OQ-SCN-36 | Scope: the end handle on kept templates (FR-SCN-45) | **Decided** (DM, sprint-4 gate 1, #245; G30): **keep** (re-aim without delete + re-place). Rejected: ~~cut~~ | — | — |
| OQ-SCN-35 | Glossary | Reword **AoE template**: "… placed freely (Ctrl) or snapped; its affected squares are the cells more than half inside it"; add **Affected squares** | no · owner: **integrator at the sprint-4 spec merge** · **Glossary: applied (#246)** | glossary |

## 16. Out of scope

- Fog → [fog-of-war](fog-of-war.md). HP bar / condition icons on tokens → built by [combat-extras](combat-extras.md) (FR-CBTX-28/29). Drag previews → built by [scenes-map](scenes-map.md) (#171).
- Map pins (tier B, [world-builder](post-mvp/world-builder.md)); player-ready indicator and scene preload (#39); vision, lighting (ADR-0007); freehand (#21); AoE automation; props blocking moves; dragging images from the desktop onto the map (tier A, #148).

## Appendix A: test IDs

- **DOM:**
  - Tools: rail buttons `map-tool-<structure|props|aoe|layers>` (built by the core ToolRail, #198; `scn-tool-props` sits on the Props panel root), `scn-structure-mode-<wall|door|erase>`, `scn-undo`.
  - Door menu: `scn-door-menu-<open|close|lock|unlock|delete>`.
  - Props: `scn-prop-menu-<rotate|hide|lock|front|back|duplicate|image|delete>`, `scn-prop-image`.
  - AoE: `scn-aoe-shape-<cone|sphere|cylinder|cube|line>`, `scn-aoe-<size|width|label|keep|clear>`, `scn-template-menu-<hide|delete>`.
  - Other: `scn-layer-toggle-<key>`, `scn-diagonal-rule` (`data-value`), `scn-scene-loading`.
- **Konva** (name = test ID, id = record ID):
  - `scn-walls`: one shape; attr `count`.
  - `scn-door`: id `door-<n>`; attr `state` = `open` \| `closed` \| `locked`.
  - `scn-prop`: attr `hidden`.
  - `scn-template`: id = record ID or `eph-<key>`; attrs `shape`, `cells`, `ephemeral`.
  - `scn-blocked-cell`, `scn-through-wall`.
  - *(Sprint 3)* `scn-wall-hint` (player, one shape per piece; attr `segment`); DM crossed segments: `scn-wall-crossed`; `scn-draft-point` (id = index, attr `free`); DOM chip `scn-free-chip`.
  - *(Sprint 4)* `scn-template` gains attrs `origin` ("x,y" in grid units) and `angle`; `cells` = the FR-SCN-41 squares as "c,r c,r …" (row-major); handles `scn-template-handle-origin` / `-end` (id = template id). DOM: `scn-free-chip` also in the AoE tool; Clear dialog `scn-aoe-clear-dialog`, Checkbox `scn-aoe-clear-players` (`data-count`), `scn-aoe-clear-confirm` (`data-count`), `scn-aoe-clear-cancel`.

## Appendix B: snapshot arithmetic

"Typical prepped scene" = 150 walls, 10 doors, 15 props, 3 kept templates. Per-item estimates; the measured combined table is in §12 (one typical scene measured: 7,384 B DM).

| Item | Wire size | Typical scene | Max scene |
|---|---|---|---|
| Wall / door tuple | ≈ 21 / 25 B | 3.5 KB (+ envelope) | 2,000 → 44 KB |
| Prop (DM / player) | ≈ 205 / 190 B | 3.1 KB | 200 → 41 KB |
| Kept template | ≈ 250 B | 0.75 KB | 20 → 5 KB |
| `map-settings` | ≈ 60 B | 0.06 KB | — |
| **Per scene** | | **≈ 7.3 KB DM**, ≈ 3.6 KB player | ≈ 90 KB |

- Without the window, 30 prepped scenes would add ≈ 216 KB to the DM frame.
- Measured on `main` (review): `token` 300 rows = 148,153 B (494 B/row), 240 of them on non-active scenes ≈ 121,125 B with `fogged` (phase-2 table); `effect-preset` 16 rows = 18,461 B (10 campaign ≈ 11.5 KB, 6 character ≈ 6.9 KB).
