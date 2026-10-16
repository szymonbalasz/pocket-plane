---
title: Fog of war
prefix: FOG
status: in-review
owner: spec-vision
phase: post-mvp-3
---

# Fog of war (FOG v2: freeform fog, dynamic vision, magical darkness)

> **FOG v2** (sprint 3, track V; DM decisions [#201](../decisions-log.md), [#202](../decisions-log.md)) replaces sprint 2's static cell fog. FR IDs are kept where the behaviour survives (text amended in place), retired IDs are struck through, new ones start at FR-FOG-26. One vision design across this spec, [scene-tools](scene-tools.md) (walls, SCN) and [character-sheet-full](character-sheet-full.md) (senses, CHARX); ADR: [proposed-dynamic-vision](../architecture/adr/proposed-dynamic-vision.md). **Bold** in §15 = suggested pick, not decided. *Seams pass (orchestrator ruling, 2026-10-16):* View-as data on demand (FR-FOG-43, S1, re-measured §12), build order (S3), senses via compendium (S6), terms (S9), composable fixtures (S10), BL-09 (S11). *Review pass (rulings 2026-10-16, review-a A1–A29):* fixture darkness moved off Goblin and §13 recomputed from coordinates; darkness filtered per player (FR-FOG-44, OQ-FOG-32 B); darkness in the undo stack (OQ-FOG-44); senses ≤ 120 ft and ≤ 4 sources per player; V0 benchmark is an exit gate; build order V0 → V5 → V1 → (V4 ∥ V2) → V3.

## 1. Summary

- The DM draws **freeform fog** with rectangle, polygon and circle tools (grid snap unless **Ctrl** is held) in four modes: **Reveal**, **Fog**, **Explored**, **Darkness**. Sprint 2's cell mask stays as the base the shapes paint over, so existing scenes look the same.
- **Dynamic vision:** each player-owned token is a **vision source** with its creature's vision and darkvision radius; line of sight stops at walls and closed doors. Vision pierces Fog; a per-map **Explored** memory keeps seen areas visible (map, not records). **Magical darkness** blocks vision unless the character "sees through magical darkness"; standing in it without that gives the player a dark screen.
- Hiding stays **server-side**, now **per player**: each fog subject carries a server-written `seenBy` copy, so visibility fns stay pure (record + viewer, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md)). The server computes each player's vision polygons and sends them to that player only; walls never reach players.

## 2. Scope

- DM, per scene (any scene, prep or live): shape tools × modes; Reveal all, Fog all, Undo (shapes); Darkness add / move / delete / clear; per-map **Explored memory** on / off and **Forget explored**; **View as player** preview *(pick, OQ-FOG-31)*.
- Vision for every token with an owner: radius from the creature's senses (CHARX FR-CHARX-49), blocked by walls and non-open doors (SCN FR-SCN-37) *(picks, OQ-FOG-21 / -24)*, by darkness for sources without "sees through". Each player sees through **their own characters only** *(pick, OQ-FOG-20)*.
- Server-side, per player: tokens, props, DM templates and doors outside a player's sight and not in revealed area never reach that player. Fog-hidden monsters stay hidden in combat until **any** player sees them *(pick, OQ-FOG-25)*.
- Decided by the DM (#201, #202), not open:

| Topic | DM decision |
|---|---|
| Shapes | Freeform shapes with drawing tools (rectangle, polygon, circle); vertices snap to the grid unless Ctrl is held |
| Vision | Each character has a vision / darkvision radius that pierces fog; recomputed as tokens move |
| Fog kinds | **Fog**: hides map and records until in a player's vision, returns when vision leaves. **Explored**: map visible, records hidden (RTS memory). **Magical darkness**: DM-placed ad hoc shapes that block all player vision |
| Explored toggle | Per map: Explored memory on / off for the whole map (on for dungeons, off for open spaces) |
| Darkness vs sheet | Sheet setting "sees through magical darkness". Without it, a character standing in darkness → that player's screen is **fully dark** (own tokens and the grid only). With it, the darkness shape is a **darker, more transparent overlay than Explored** |
| Scope | Vision (radius, darkvision, walls blocking sight) is in; dynamic lighting (light sources, colour, shadows) stays out |

## 3. Goals

- **Zero leakage per player, except §11's accepted list:** no player frame (snapshot, event, signal, ack) carries the id, name, position, image or any field of a record that player can't see, before or after a reconnect; nor another player's vision, explored memory or senses.
- A token move = one transaction, one event, one frame per connection; commit → player frame ≤ 1 s; vision work ≤ 10 ms typical, ≤ 30 ms at caps (V0 benchmark, an exit gate, §12).
- Fits CON-44 (measured, §12). Existing scenes, bundles and tests keep behaving: no senses set → exactly sprint 2.

## 4. Non-goals

- Dynamic lighting: light sources, bright / dim light, colour, shadows, per-token torches ([ADR-0007](../architecture/adr/0007-product-scope.md) as superseded in part by the dynamic-vision ADR). "Vision 30 ft" stands in for a carried light.
- Vision for tokens without an owner (monsters see nothing; the DM sees everything). Darkness attached to a moving token. One-way, terrain or windowed walls.
- Hiding map **pixels**: the map image still reaches players whole (OQ-FOG-09 stands); fog draws over it.
- Brush; player fog tools; live vision while dragging *(pick, OQ-FOG-26)*; redo.

## 5. User stories

**DM**
- As the DM, I want to trace a cave's fog with a few free polygon clicks (Ctrl) and let the party's torches and darkvision peel it back as they walk, so that I don't reveal rooms by hand.
- As the DM, I want to drop a 15 ft sphere of magical darkness mid-fight and move it, so that only the warlock with Devil's Sight sees the goblins inside.
- As the DM, I want to see what Player 2 sees, so that I trust the fog before the session.

**Player**
- As a player, I want my torch to show 30 ft around Mira, the corridor I walked to stay remembered (but empty), and nothing I couldn't see.
- As a player with Devil's Sight, I want to see inside magical darkness, darker than the rest.

## 6. Functional requirements

**Units.** Shape and wall coordinates are **grid units**: corner (i, j) = map point `(offsetX + i·cellSize, offsetY + j·cellSize)`; cell (col, row) has centre `(col + 0.5, row + 0.5)`. Numbers carry ≤ 2 decimals (1/100 cell); integers = grid corners. Stored in grid units, so content follows recalibration ([FR-MAP-10](scenes-map.md#6-functional-requirements)).

| ID | Requirement | Notes |
|---|---|---|
| **Model** | | |
| FR-FOG-01 | *(amended)* A scene's **fog layer** = a **base mask** (sprint 2's cell mask: `fill`, box, `runs`) + an ordered list of **fog shapes** painted over it. The **static state** of a point is the base mask value of the cell containing it (outside the box: `fill`), then every shape containing the point, in list order, overrides it: `reveal` → clear, `fog` → fog, `explored` → explored. Containment is boundary-inclusive; polygons even-odd. **No row = every point clear.** | Migration: OQ-FOG-27 |
| FR-FOG-02 | New scene fully fogged *(decided #196)*: fog's `created` line writes `{fill: fog, runs: "", shapes: [], darkness: [], explored: false}`; `duplicated` copies the source's row (shapes, darkness, setting), not its undo stack, explored memory or `visionStale`. | Unchanged otherwise |
| FR-FOG-03 | *(amended)* **Box** applies to the base mask only (≤ 513 × 513 cells, sprint-2 formula). ~~Each edit re-bases the mask~~ *(retired: shapes no longer touch the mask)*; `fog.setAll` writes `{fill, runs: ""}` over the current box. | |
| FR-FOG-04 | Run-length codec unchanged (`@shared/fog-of-war/mask.ts`); also encodes explored memory (FR-FOG-37). Bad sum → fully fogged + `error` log (fail closed). | |
| FR-FOG-26 | **Shapes** (zod, `@shared/fog-of-war/shapes.ts`): `rect [x0, y0, x1, y1]` (normalised), `polygon [x, y, …]` 3–64 vertices, simple (no crossing edges), area > 0, `circle [cx, cy, r]` r 0.5–60 cells. \|coord\| ≤ 1,024. Fog shape = `{op: reveal \| fog \| explored, <shape>}`; darkness = `{id, <shape>}`. Crossing / zero area → `invalid`. | |
| FR-FOG-27 | **Caps** *(OQ-FOG-35)*: ≤ 100 fog shapes and ≤ 20 darkness shapes per scene; the serialized `fog` row ≤ 16 KiB. Over → `conflict` "Fog too detailed — use Fog all or Reveal all to start over" / "Too many darkness areas". Nothing written. | §12 |
| FR-FOG-28 | **Magical darkness** = the row's `darkness` list (ids from `ctx.ids`): a union, independent of fog state; Fog all and Reveal all never touch it; Undo does (FR-FOG-07, *pick OQ-FOG-44*). A point is **in darkness** iff inside any darkness shape. | |
| FR-FOG-44 | **Darkness per player** *(pick, OQ-FOG-32 B)*: each darkness shape carries a server-written **`seenBy`** = the players whose sight polygons meet its bounding box, or who have a cell centre inside its bounding box that is statically clear / explored or in their explored memory. Written by every re-derive of that player (≤ 20 shapes). The player's `fog` row lists only shapes with the viewer ∈ `seenBy`, never `seenBy` (DM wire: never either). A shape entering a player's set → `fog` upsert for that player only. | Review A5 |
| FR-FOG-29 | **Explored memory setting** per scene: `explored` on the fog row, default **off** (new and existing scenes), `fog.setExplored {sceneId, on}`. Off: memory neither grows nor draws; rows are kept. | OQ-FOG-35 |
| **Editing** (DM only; WS intents, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D) | | |
| FR-FOG-05 | *(amended)* `fog.edit {sceneId, op: reveal \| fog \| explored, shape}` appends one fog shape. **Legacy forms** stay valid, so fixtures and tests behave as before: `op: hide` = `fog`; `{kind: rect, c0, r0, c1, r1}` (cells) = `rect [c0, r0, c1 + 1, r1 + 1]`; `{kind: polygon, points}` (grid corners) = that polygon. Same cells result: a cell's state is its centre's (FR-FOG-34). ~~No cell changes → no event~~ *(retired: every edit appends; sprint-2 bundles pass unchanged, V1 rewrites the sprint-2 no-op tests)*. | Raster retired |
| FR-FOG-06 | `fog.setAll {sceneId, fogged}`: base → `{fill: fog \| clear, runs: ""}`, `shapes: []`. Darkness, setting and explored memory untouched. Same value and no shapes → no-op. | |
| FR-FOG-07 | *(amended)* Undo `fog.undo {sceneId, expectedEditId}` restores **base + shapes + darkness** from before the latest `fog.edit` / `fog.setAll` / darkness intent (FR-FOG-30) *(darkness in the same stack: pick, OQ-FOG-44, as #196 "undo for scene editing")*; strict LIFO, ≤ 20, persisted, `expectedEditId` guard, no redo. Undoing a darkness remove / clear restores the same ids. Pre-v2 rows (`prevShapes` / `prevDarkness` null): shapes → `[]`, darkness unchanged. The Explored setting and memory are not in the stack. | Contract kept |
| FR-FOG-30 | **Darkness intents:** `fog.placeDarkness {sceneId, shape}` → `{darknessId, editId}`; `fog.moveDarkness {sceneId, darknessId, dx, dy}` (translate, grid units); `fog.removeDarkness {sceneId, darknessId}`; `fog.clearDarkness {sceneId}`; each writes an undo row (FR-FOG-07). Unknown id → `not_found`. | |
| FR-FOG-31 | `fog.forgetExplored {sceneId}` (DM, confirm): deletes every `fog-explored` row of the scene. | |
| FR-FOG-08 | *(amended)* Every fog command = one transaction: `fog` row (`rev` + 1) + undo row + the scene **re-derive** (FR-FOG-35) + one event-log entry; then one event (§9). IDs, time from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). | |
| FR-FOG-09 | Fog intents work on any scene; disabled in the UI while not `live`. A player sending any `fog.*` → `forbidden`. | Unchanged |
| **Vision** | | |
| FR-FOG-32 | **Vision source:** a token with `ownerPlayerId = P`, not `hidden`. Senses come from its definition's `statBlock.senses` (CHARX FR-CHARX-49; absent = vision 0, darkvision 0, no see-through). Origin = footprint centre. Reach `r = max(visionFt, darkvisionFt) / 5` cells, ≤ 24 (senses ≤ 120 ft, FR-CHARX-49). Sources of P = **P's own tokens** on that scene *(pick, OQ-FOG-20)*, **at most 4** (oldest `seq` first; more are ignored with a `warn` log) *(OQ-FOG-35)*. | Review A9, A28 |
| FR-FOG-33 | **Sight polygon** per source (pure `sightPolygon(origin, r, occluders)`, `@shared/fog-of-war/vision.ts`, exact orientation tests on integer-scaled coordinates): the visibility polygon from the origin, bounded by a 64-gon of radius `r`, cut by **occluders** = walls + doors not open (SCN FR-SCN-37) *(picks, OQ-FOG-21 / -24)* + for a source **without** see-through, the edges of every darkness shape. **A source without see-through whose origin is in darkness has no polygon.** Two polygons per source: `see` (radius vision) and `dark` (radius darkvision); records use the larger *(pick, OQ-FOG-23)*. r = 0 → none. Polygons are rounded to 2 decimals once; `seenBy`, the `vision` record and View as all use the rounded polygon. | Hand-rolled (OQ-FOG-29); review A2, A20 |
| FR-FOG-34 | **Visible to P** (pure `pointVisible(scene, P, pt)`): P not blind (FR-FOG-36) and either the point's static state is clear and it is not in darkness, or it lies in one of P's sight polygons (a see-through source's polygon includes darkness; another's stops at it). Explored counts as hidden for records. A **subject** is visible to P iff any **sample point** is: token = every footprint cell centre ([FR-MAP-14](scenes-map.md#6-functional-requirements)); prop, template = SCN's uncut cell centres; door = FR-SCN-36's sample points. An **owned** token is always visible to its owner (the owner is always in its `seenBy`, blind or not), and to every other non-blind player (party exemption, #196). | Same cells as sprint 2 when no vision; review A19 |
| FR-FOG-35 | **Re-derive** (server, in the writing command's transaction): recompute the affected players' sources and polygons (cache, FR-FOG-38), the `seenBy` of affected subjects and darkness shapes (FR-FOG-44), P's explored row (FR-FOG-37) and `vision` record; list every flipped row in the command's event. Each sample point's static state is computed **once per re-derive**, not per player. Triggers below; token-changed hooks ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) run for every token whose `tokenHiddenForPlayers` flips (FR-FOG-13). Writes that would re-derive **non-active** scenes for a campaign-wide reason (senses edit, player added) re-derive the active scene only and set `visionStale` on the others' fog rows; activating a stale scene re-derives it inside the activation transaction and clears the flag. | Table below; review A9 |
| FR-FOG-36 | **Blind:** P is blind on a scene iff P has ≥ 1 source there, every source's origin is in darkness and none sees through. Blind P receives **no fog subject** (token, prop, DM template, door) **but their own tokens** (party tokens too are dropped; combat rows stay party-level, FR-FOG-14) and draws the dark screen (FR-FOG-21); `vision {blind: true, see: [], dark: []}`. While blind, P's client draws no other placer's AoE templates, pings or laser over the dark map (they still arrive; own template placement still draws). Leaving darkness restores the view in the same event. | DM #201; review A24 |
| FR-FOG-37 | **Explored memory** (scene setting on, **active scene only**: moves and re-derives on a prep scene write `seenBy` and `vision` but never memory, so View-as testing grows nothing): every cell whose centre lies in one of P's polygons becomes explored for P; one `fog-explored` row per (scene, player) (box + runs, FR-FOG-04 codec), written in the same transaction as the move / re-derive, **never shrinks** *(per player, OQ-FOG-22)*. > 2,000 runs → memory stops growing, `warn` log (map pixels only, never records). Visible to its player; the DM loads it on demand (FR-FOG-43). | |
| FR-FOG-10 | *(amended)* **Copies:** each fog subject stores **`seenBy`** = ids of the campaign's players for whom FR-FOG-34 holds (server-only column, **never on the wire**) and **`fogged`**: unowned subject = `seenBy` empty, or **statically hidden** while the campaign has no players; owned token = statically hidden (sprint 2's value; its owner is always in `seenBy`). Statically hidden = no sample point is statically clear and outside darkness. Wire: DM when true; the owner on own tokens when true (as sprint 2, `visibility.ts`); other players never. Written by `derive` before every subject write (call sites as sprint 2: place, `placeTokenIn`, duplicate, move, size refresh, SCN prop / template writes) and by re-derive. Doors: `scene-structure.doorSeen {<n>: playerId[]}`; door `f` = seen by nobody. In an intent → `invalid`. Order (S4): guards → `derive` → one write → **re-derive dependants** → token-changed hooks. | ADR-0039 pattern, per player |
| FR-FOG-11 | *(amended)* **Fog-hidden for P** (pure, record + viewer): `fogHidden(type, record, playerId)` = P ∉ `seenBy` and not P's own token. `hidden` stays independent: hidden **or** fog-hidden → hidden for P. An intent or signal from P naming a token P **can't see** (hidden or fog-hidden: `map.checkMove`, `map.moveToken`, `map.drag`) → `not_found`, checked before ownership, so no existence oracle (V0, scenes-map). | `@shared/fog-of-war`; review A4 |
| FR-FOG-12 | *(amended)* Visibility via `hides(type, record, viewer)` (FR-FOG-24). Snapshot and events share the fn; per connection the transition matrix (FR-SYNC-19) turns a flip into `upsert` / `delete`; a `visible → visible` change whose wire data is identical for that connection is **dropped** (OQ-FOG-37, live-sync; built in V0, supersedes backlog BL-09, seams S11). The drop is **per change**: an event left with no changes for a connection still goes out (keeps `seq`); V0 runs the full e2e suite as its regression gate (the drop applies to every record type). | Per player; review A15 |
| FR-FOG-13 | Token-changed hooks on flips: fog commands, re-derive and the size refresh run them for every token whose **party-level** hidden (FR-FOG-14) flips; rows join the event. | Unchanged contract |
| FR-FOG-14 | *(amended meaning)* **Combat:** every combatant / effect hidden copy keeps using `tokenHiddenForPlayers(token)`, which now = `hidden` or **seen by no player** (`fogged`); V0 re-implements it from ADR-0039's "any `hides`" to `hidden || fogged` (OQ-FOG-36). A monster seen by any player is a visible combatant for every player *(pick, OQ-FOG-25)*; no combat call site changes. Targeting stays DM-only (#134). | combat-tracker / -extras: no code change |
| FR-FOG-15 | *(amended)* **Signals** ([ADR-0033](../architecture/adr/0033-signal-audience.md)): `map.drag` position frames route to the DM plus the players who see **both** the stored token and the token at the previewed cell (FR-FOG-34 on cached polygons; a frame never names a token missing from P's store); an `end` frame to the players who see the stored token. DM-placed ephemeral `scn.template`: players for whom any uncut cell centre is visible. Needs `audience` → player-id lists (OQ-FOG-37). | Per player |
| FR-FOG-16 | Camera fit: no change (a player's content box uses its own store). | |
| FR-FOG-38 | **Vision cache** (server memory, never authoritative): `(sceneId, playerId)` → polygons + blind, keyed by fog `rev`, structure `rev` and the sources' `(tokenId, col, row, size, senses)`; LRU 256 entries; a miss recomputes from the DB. Entries computed inside a transaction are **written to the cache only after commit** (a rollback leaves no entry for a rev that never committed). Restart → empty cache, same results. | §12; review A6 |
| FR-FOG-39 | **`vision` record** (derived, not stored): one per (scene, player) with ≥ 1 source: `{id = sceneId:playerId, sceneId, playerId, blind, see: number[][], dark: number[][]}`, flat coordinates, the rounded polygons of FR-FOG-33; ≤ 4 sources → ≤ 8 polygons (size at caps: §12). Snapshot computes it from the DB; commands list before / after when a source or occluder changes. Visible to that player; the DM loads it on demand (FR-FOG-43). | |
| FR-FOG-43 | **View-as data on demand** *(seams S1)*: `vision` and `fog-explored` are registered with **`dmWindow: "view-as"`** (scene scope): the DM snapshot carries **none** of them. Picking **View as P** on the viewed scene sends `sync.loadScene {sceneId, viewAs: P}` → `ack {records {vision, fog-explored}}` = P's rows on that scene only (through the scope gate and visibility fn, in hub frame order, as [ADR-0041](../architecture/adr/0041-active-scene-window.md)); P not in the campaign → `not_found`. Live events are unchanged (ADR-0041: they still reach the DM). The DM client keeps one loaded `(sceneId, playerId)` pair: View as off, another player or another viewed scene drops it (and loads the new pair); a snapshot resets it and reloads if View as is still on. Convergence (FR-SYNC-20) compares `view-as` types only for the loaded pair. One load in flight; reject → Toast, View as back to "DM". | Lazy record types are campaign / global only (S1) |
| FR-FOG-40 | **Migration** *(pick, OQ-FOG-27)*: schema push adds the columns (`shapes`, `darkness` `[]`, `explored` false, `rev` 0; `seenBy` null). An idempotent **boot backfill** re-derives every scene whose subjects still have `seenBy = null` (FR-MAP-50's pattern): at feature start, **before the server listens**, one transaction per scene. Until then `seenBy = null` reads as hidden for every player (fail closed). With no senses set, every player's view and the DM's equal sprint 2's: same cells, same tokens, same `fogged` (FR-FOG-10), same doors (FR-SCN-36's samples on integer doors = `doorCells`). Fixture units and FR-FOG-25's ripple stay as they are. | Neutral; review A8, A17 |
| **Client** | | |
| FR-FOG-17 | *(amended)* **Fog tool** (DM, `canvas-tools.ts` line, floating fog bar): **Mode** Reveal \| Fog \| Explored \| Darkness; **Shape** Rectangle \| Polygon \| Circle (defaults Reveal, Rectangle); Reveal all; Fog all… (AlertDialog as sprint 2); Undo (Tooltip "Undo: ‹reveal \| fog \| explored› ‹rectangle \| polygon \| circle \| all›" or "Undo: darkness ‹place \| move \| remove \| clear›"); Switch **Remember explored areas** (FR-FOG-29); DM-only hint **"No vision set for: ‹names›"** (`fog-no-vision`) listing the owned tokens on the viewed scene whose senses are all 0 (hidden when none); **Forget explored…** (AlertDialog "Players lose the explored map of this scene."); **View as** Select (DM, Players + "DM", OQ-FOG-31; picking a player loads that player's rows, FR-FOG-43, with a spinner in the Select until the ack); in Darkness mode: **Clear darkness…**. Stage-level dispatch, Space + drag pans (sprint 2). | |
| FR-FOG-18 | *(amended)* **Rectangle:** left-drag corner to corner; corners snap to the nearest grid corner **unless Ctrl** is held (read on every move: free, rounded to 0.01). < 4 px = the cell under the press. Esc cancels. Release sends; the draft stays until the event or reject (Toast). | |
| FR-FOG-19 | *(amended)* **Polygon:** each click adds a vertex at the nearest grid corner, or **free with Ctrl**; < 4 px from the last ignored; crossing refused (Tooltip "Edges can't cross"); Enter / double-click / first vertex closes (≥ 3); Backspace; Esc; 64 max. | |
| FR-FOG-41 | **Circle:** press = centre (nearest grid corner, free with Ctrl), drag = radius in whole cells (label "15 ft"), free with Ctrl (label rounded to ft). < 4 px → 1 cell. Esc cancels. Darkness + Circle is the usual Darkness spell (15 ft). | |
| FR-FOG-42 | **Darkness editing** (Darkness mode): click a darkness shape selects it (outline handles); drag moves it (snapped by whole cells, free with Ctrl) → `fog.moveDarkness` on release; Delete / Backspace or its right-click menu **Remove** → `fog.removeDarkness`. Drawing starts only on empty space. | |
| FR-FOG-20 | *(amended)* **DM render** (`fog` layer, order 30; one cached Konva shape, no new Konva layer: the stage already warns at 8–9, session-sim-6): Fog ≈ 50 % (`fog.dm`), Explored ≈ 25 % (`fog.dm-explored`), darkness hatched (`fog.dm-darkness`), shapes' edges hairline. **View as P:** that player's render (FR-FOG-21) at 70 % over the DM view, from P's loaded `vision` + `fog-explored` (FR-FOG-43; the server's result, not a client recompute), tokens P can't see dimmed (FR-FOG-34 on those polygons, same pure fns). Fog badge (`fog-token-fogged`) = seen by no player. | |
| FR-FOG-21 | *(amended)* **Player render** (same layer, under templates / tokens / labels; one cached shape): unseen **Fog** opaque (`fog.player`); **Explored** (static, or the player's memory) and not in sight: map dimmed (`fog.explored`), records absent; in sight: clear; beyond `see` but inside `dark`: dimmed + desaturated (`fog.darkvision`); **darkness** draws only where the point is statically clear or in sight (over Fog and Explored it never shows): without see-through opaque (`fog.darkness`), with see-through inside sight a darker, more transparent tint (`fog.darkness-seen`). **Blind:** the whole map dark, grid lines redrawn on top, own tokens only, chip "Magical darkness — you can't see" (`fog-blind`). Drawn from the snapshot + `vision` + `fog-explored` records. | Tokens: OQ-FOG-17 |
| FR-FOG-22 | A gesture in progress is dropped when the client leaves `live`, the viewed scene changes or another tool is picked. | Unchanged |
| **Lifecycle** | | |
| FR-FOG-23 | *(amended)* Scene delete: `deleting` lists the `fog` delete and every `fog-explored` / `vision` row of the scene; FK cascade removes rows and stack. Activation: a `visionStale` scene re-derives first, inside the activation transaction (FR-FOG-35); players get the new scene's `fog`, their `vision` and `fog-explored` in the resync snapshot. | |
| FR-FOG-24 | *(amended)* **Registries** (scenes-map's, append-only): `visibility-hooks.ts` members become `derive(read, obj) → {fogged, seenBy}`, `hides(type, record, viewer)`, `dragAudience(read, token, at) → playerId[]` (replaces `dragToDm`), new `rederive(env, before, after) → RecordChange[]` (dependants of a token / subject write, run after the write); `scene-hooks.ts` gains the member `activated(env, scene)` (run in the activation transaction; fog re-derives a `visionStale` scene, FR-FOG-35). Fog also appends a line to entities' definition-changed hooks (senses, FR-FOG-35). **V0 creates** `src/server/features/campaign-management/player-hooks.ts` (append-only, `added(env, player) → RecordChange[]`, called in the REST player-add transaction, [CAMP §9](campaign-management.md#9-api--events)); fog's line re-derives that player's membership (OQ-FOG-39). Both registries go on the AGENTS §9.9 list (integrator, at the gate). | Call sites in `fix/vision-core`; review A11 |
| FR-FOG-25 | Ripple unchanged: units / helpers that create scenes reveal them; nothing new to ripple (senses default to 0). | |

**Re-derive triggers** (FR-FOG-35)

| Write | Players | Subjects |
|---|---|---|
| Fog edit / setAll / undo; darkness place / move / remove / clear | all | every subject on the scene |
| SCN structure edit, door state (FR-SCN-39) | all | every subject on the scene |
| Vision source placed (incl. combat `placeTokenIn` / Start placing a PC token), moved, duplicated, deleted, resized, hidden / revealed, owner changed | old and new owner | every subject on the scene + the token itself; memory only on the active scene (FR-FOG-37) |
| Other subject written | all | that subject (`derive`) |
| Senses edit (definition-changed hook) | owners of that definition's tokens | the **active** scene; other scenes with such a token → `visionStale` (FR-FOG-35) |
| Player added (`player-hooks.ts`, OQ-FOG-39) | that player | the active scene; other scenes → `visionStale`. Player removal is out of scope (CAMP §2) |
| Scene activation (`scene-hooks.ts` `activated`) | all | only if `visionStale`; otherwise none: `seenBy` is kept on every scene |
| Scene duplicated | all | the copy's subjects, derived as they are copied (sprint-2 order: fog row first, then tokens and SCN rows), so the copy starts fresh (`visionStale` false); never active, so no player frame |
| Grid recalibration | — | none: shapes, walls and memory are in grid units / cells |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, the map is the hero; lucide `cloud-fog`, `moon` (Darkness), `eye` (View as). Colours are placeholder semantic tokens (`fog.player`, `fog.explored`, `fog.darkvision`, `fog.darkness`, `fog.darkness-seen`, `fog.dm*`) until theme-system (OQ-FOG-17).

- **Screens:** no window. Tool line + floating fog bar + the `fog` canvas layer + one overlay badge + the blind chip.
- **States:** empty = no row (clear) or fully fogged with no sources (black map, party tokens). Loading = scene loading. Error = Toast, draft removed. Disconnected = fog bar disabled, gestures dropped, last fog / vision drawn.
- **DM view:** everything; fog translucent; Explored lighter; darkness hatched with handles when selected; Ctrl shows a "Free" hint chip at the cursor while drawing; View as P overlay.
- **Player view:** FR-FOG-21. No fog controls. Party tokens over fog (unless blind).
- **Test IDs:** `map-tool-fog` (rail), `fog-bar`, `fog-mode-<reveal|fog|explored|darkness>`, `fog-shape-<rect|polygon|circle>`, `fog-reveal-all`, `fog-fog-all`, `fog-fog-all-confirm`, `fog-undo` (`data-depth`), `fog-explored-toggle` (`data-state`), `fog-forget-explored`, `fog-forget-explored-confirm`, `fog-clear-darkness`, `fog-clear-darkness-confirm`, `fog-view-as` (`data-value` = playerId \| `dm`, `data-loading` while the FR-FOG-43 load is in flight), `fog-darkness-menu-remove`, `fog-blind`, `fog-no-vision` (DM; text lists the names). Konva: layer `fog-layer`; shape `fog-mask` (attrs `shapes`, `darkness`, `fogged-cells`); `fog-darkness` (id = darkness id, attr `selected`); `fog-vision` (attrs `sources`, `blind`, `see`, `dark` = the record's flat polygons, so a walkthrough can assert where sight is cut); `fog-explored` (attr `cells`); `fog-draft`, `fog-draft-vertex` (id = index, attr `free`); badge `fog-token-fogged`.

## 8. Data model

JSON leaf fields per [ADR-0006](../architecture/adr/0006-persistence.md): `shapes`, `darkness`, `prevShapes`, `prevDarkness`, `seenBy`, `doorSeen`. Rows per campaign; time from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Fog (`scene_fog`) | sceneId (PK), campaignId; fill; col0, row0, cols, rows; runs; updatedAt | as sprint 2 | Base mask |
| | **shapes**; **darkness**; **explored**; **rev**; **visionStale** | **JSON** `{op, rect \| polygon \| circle}[]` ≤ 100; **JSON** `{id, seenBy, rect \| polygon \| circle}[]` ≤ 20 (`seenBy` server only, FR-FOG-44); bool; int; bool (FR-FOG-35) | Row ≤ 16 KiB on the DM wire |
| Fog edit (`scene_fog_edit`) | + **prevShapes**, **prevDarkness**; kinds + `reveal-shape`, `fog-shape`, `explored-shape`, `darkness-place`, `darkness-move`, `darkness-remove`, `darkness-clear` | **JSON** ×2 (null on pre-v2 rows); enum | Sprint-2 kinds stay valid |
| Explored memory *(new, `fog_explored`)* | sceneId + playerId (PK), campaignId; col0, row0, cols, rows; runs; updatedAt | ID → Scene (cascade), ID → Player (cascade), ID; int ×4; text ≤ 10 KB; timestamp | Wire id `sceneId:playerId` |
| Token *(scenes-map)*, Prop, AoE template *(SCN)* | **seenBy**; fogged | **JSON** playerId[] \| null (server only); bool | null = pre-v2 (backfill) |
| Scene structure *(SCN)* | **doorSeen** | **JSON** `{<n>: playerId[]}` | Server only |
| Creature `statBlock.senses` *(CHARX)* | visionFt, darkvisionFt, seesMagicalDarkness | int 0–120 step 5 ×2, bool | JSON leaf, zod only |
| Vision *(derived, no table)* | id, sceneId, playerId, blind, see, dark | computed | FR-FOG-39 |

- **Relations:** Scene 1—0..1 Fog; Scene 1—* Fog edit; Scene × Player 1—0..1 Explored memory; fog subjects → Scene; vision source = Token → Entity (senses), Player (owner).
- **Derived:** static state, darkness, sight polygons, blind, `seenBy` (subjects and darkness shapes), `fogged`, `vision`, undo depth. Client only: draft, selection, View as + its loaded `(sceneId, playerId)` pair.
- **Persisted runtime state:** fog rows, undo stacks, explored memory, `seenBy` / `fogged` / `doorSeen` copies, committed together. The vision cache is memory only.

## 9. API & events

**REST:** none.

| WS intent (DM only) | Validation / ownership |
|---|---|
| `fog.edit {sceneId, op, shape}` → `{editId}` | Scene in `ctx.campaignId` (`not_found`); FR-FOG-26 zod (legacy forms FR-FOG-05); caps → `conflict` |
| `fog.setAll {sceneId, fogged}` → `{editId \| null}`; `fog.undo {sceneId, expectedEditId}` | As sprint 2 |
| `fog.placeDarkness {sceneId, shape}` → `{darknessId, editId}`; `fog.moveDarkness {sceneId, darknessId, dx, dy}`; `fog.removeDarkness {…, darknessId}`; `fog.clearDarkness {sceneId}` | Id on the scene, else `not_found`; caps; moved shape must stay within ±1,024 |
| `fog.setExplored {sceneId, on}`; `fog.forgetExplored {sceneId}` | Same value / no rows → no-op |
| `sync.loadScene {sceneId, viewAs?}` *(live-sync's intent, extended in V0; seams S1)* → `ack {records}` | DM only, read-only; `viewAs` = a player of the campaign, else `not_found`; with `viewAs` the result is that player's `view-as` rows only (FR-FOG-43) |

| Record type | Scope | DM wire | Player visibility | Snapshot |
|---|---|---|---|---|
| `fog` | scene, `sceneOf = id`, **`dmWindow`** *(pick, OQ-FOG-30)* | `{id, campaignId, fill, box, runs, shapes, darkness, explored, undo}` (darkness without `seenBy`) | redacted: no `campaignId`, `undo`; `darkness` = only shapes with the viewer ∈ `seenBy` (FR-FOG-44), never `seenBy` | DM: active scene (+ `sync.loadScene`); player: active scene |
| `fog-explored` *(new)* | scene, **`dmWindow: "view-as"`** *(seams S1)* | `{id, sceneId, playerId, box, runs}` | full iff `playerId = viewer`, else hidden | player: own row, active scene; DM: none, `sync.loadScene {sceneId, viewAs}` (FR-FOG-43) |
| `vision` *(new, derived)* | scene, **`dmWindow: "view-as"`** | `{id, sceneId, playerId, blind, see, dark}` | full iff `playerId = viewer`, else hidden | same |
| `token`, `scene-prop`, `aoe-template`, `scene-structure` | unchanged | + `fogged` (DM only) | `hidden` or fog-hidden for that player → hidden; doors filtered by `doorSeen`; never `seenBy`, `doorSeen`, `fogged` | unchanged |

| Change (per player P) | P | Other players |
|---|---|---|
| P's source moves; a monster enters P's sight | `token` upsert(s), `vision` upsert, `fog-explored` upsert | the moved token only (party exemption) |
| Monster leaves P's sight | `delete` | — |
| P becomes blind / sees again | `delete` / `upsert` of every visible fog subject but own tokens; `vision {blind}` | unchanged |
| `fog` edit | `fog` upsert + flips | same |
| Darkness edit | `fog` upsert only if P's filtered `darkness` changed (FR-FOG-44), + flips | per their filter |
| `map.drag` of a monster | frames only while P sees the stored token and the previewed cell | per their sight |
| Combatant / effect of a token seen by nobody → by someone | `upsert` (party-level) | `upsert` |

| Domain event (logged; not ADR-0016-undoable) | Payload | Changes |
|---|---|---|
| `FogEdited` / `FogUndone` | `{sceneId, editId, kind}` (`FogUndone` may undo a darkness edit) | `fog`; flipped subjects; `scene-structure`; `vision`; token-hook rows |
| `DarknessPlaced` / `DarknessMoved` / `DarknessRemoved` / `DarknessCleared` | `{sceneId, editId, darknessId?}` | same as `FogEdited` |
| `FogExploredSet` / `ExploredForgotten` | `{sceneId, on}` / `{sceneId}` | `fog` / `fog-explored` deletes |
| Token events, `StructureEdited`, `EntityUpdated` (senses), player added (CAMP, `player-hooks.ts`), `SceneActivated` (stale scene) | unchanged | + flipped subjects, `vision`, `fog-explored` (re-derive) |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Fog shapes, darkness, Explored setting, Forget, Undo | ✓ any scene | ✗ | Default-DM intents |
| See fog layer | translucent, every scene; View as | own render, active scene | `fog` + scene gate |
| See records | all | in own sight or revealed (party tokens unless blind) | `seenBy` copy + `hides` |
| See vision / explored | one player's at a time, on demand (View as, FR-FOG-43) | own only | record visibility + `dmWindow` |
| Edit senses | any creature | own character, unless locked | CHARX FR-CHARX-49 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** banner, stale view. The reconnect snapshot carries current fog, own `vision` and `fog-explored`, and only records visible now; nothing seen meanwhile leaks into the old store (snapshot replaces it).
- **DM disconnect / reconnect:** fog bar disabled, gestures dropped; players unaffected; undo stack server-side; the window reloads the viewed scene (ADR-0041) and, if View as is on, that player's rows (FR-FOG-43).
- **Server crash mid-action:** one transaction per command (move + `seenBy` + explored + log): before commit nothing, after commit all. Cache lost, recomputed. `PP_TEST_CRASH map.moveToken:after-commit`, `fog.placeDarkness:before-commit` → `state:digest` equal to the expected state; per-player snapshots identical after restart.
- **Rollback after a re-derive** (a hook throws, internal error): nothing commits and the vision cache keeps no entry for that rev (FR-FOG-38); the next edit reuses the rev and recomputes.
- **Concurrent edits:** serialised; each derive reads committed state. A door closed while a player drags: the drop re-derives against it. Two DM tabs undoing → `conflict`.
- **Prep scenes after a senses edit / new player:** `visionStale` until activation, so the DM's Fog badges there may be stale until then (players never see a non-active scene); View as computes `vision` from the DB, so its polygons are current.
- **Source edge cases:** two own tokens → union; one in darkness without see-through, one outside → not blind, sight from the outside one only (the inside one has no polygon, FR-FOG-33); more than 4 own tokens → the oldest 4 count (FR-FOG-32); senses all 0 → no polygon (revealed area still visible); token hidden by the DM → no vision; owner removed → that player loses its vision in the same event.
- **Grid / map change:** shapes and memory are in grid units / cells and follow the grid; subjects re-derive on the next edit or move (static state uses uncut cells, as sprint 2).
- **Invalid / malicious input:** player `fog.*` → `forbidden`; `seenBy` / `fogged` in any intent → `invalid`; zod caps; frame cap 64 KB; corrupt runs → fogged.
- **Accepted leaks** (the only exceptions to §3):
  - the map image (OQ-FOG-09); the active scene's fog shapes (not darkness: filtered per player, FR-FOG-44, OQ-FOG-32 B); a darkness shape whose bounding box meets P's view, also where the shape itself is out of sight; party tokens;
  - under OQ-FOG-25 B: a monster's Initiative row while only another player sees it, and the player combatant row's `tokenId` (CBT §9) for a token P can't see;
  - wall pieces inside one's own sight (polygon edges); ≤ 1 cell of the **first** wall a drag line crosses, and the "something blocks this line" oracle of `map.checkMove` (SCN FR-SCN-38);
  - events with no changes for P still reach P with their `cause` name (e.g. `TokenMoved`, `DarknessMoved` for an unseen move): a timing side channel.

## 12. Performance & bandwidth

**Measured** on `main`'s realistic-heavy harness (`buildRealisticHeavy`, `snapshotSizes`, `snapshotTypeBytes`) with prototype FOG v2 rows in the spec's wire shapes and a real sight sweep against the typical scene's 150 walls (throwaway probe, not committed). Typical scene: 12 fog shapes (5 rect, 5 ten-vertex polygons, 2 circles, freeform coordinates) + 2 darkness shapes; PCs vision 30 ft / darkvision 60 ft.

| Item | Bytes | Kind |
|---|---|---|
| Heavy DM today | 676,045 (110,387 left of 786,432) | measured |
| `fog` row: today / v2 typical / v2 at the 16 KiB cap | 150 / 1,219 / 16,542 | measured |
| DM `fog` type, 30 scenes: today / v2 typical not windowed / **windowed** (active only) | 4,756 / 36,774 / **1,309** | measured |
| `vision` per player (1 PC, 2 polygons, 45–85 vertices) | 1,211–1,694 | measured |
| `fog-explored` per player after 10 steps (31–39 runs) | 204–218 | measured |
| `senses` on all 19 DM entity rows (seams re-run: 21 stat-block rows) | +1,349 (+1,491) | measured |
| Sight polygon at caps: 2,000 walls, r 12 cells / 300 walls, r 24 | 217 vertices, 2,559 B / 346, 4,017 B | measured |
| `fog-explored` per player at the 2,000-run cap | 4,436 | measured (seams) |
| **View-as load ack** (`sync.loadScene {viewAs}`, one player's `vision` + `fog-explored`): typical / at caps | **1,315–1,810 / 12,676** | measured (seams) |

**Seams re-run (S1, 2026-10-16):** same harness, throwaway probe (deleted), `vision` / `fog-explored` flagged `view-as` (FR-FOG-43). Heavy DM today on this branch: **676,038 B** (110,394 left). Vision rows in the seams re-run are synthetic polygons at the sweep's vertex counts (949–1,408 B; the sprint-3 sweep measured 1,211–1,694, used for option C below).

| Option (OQ-FOG-30) | Heavy DM | Left | Kind |
|---|---|---|---|
| (A) `fog` not windowed, View-as data in the snapshot | 720,091 | 66,341 (30 rows at cap: 1,168,928, over) | measured (sprint 3) |
| **(B) `fog` windowed, View-as data on demand** *(seams S1)* | **674,186** (−1,852 vs today) | **112,246** | measured (seams) |
| (C) `fog` windowed, View-as data in the snapshot (pre-seams pick) | 684,626; 708,019 with every player's memory at the run cap | 101,806; 78,413 | measured |

- **S1 saves** 10,440 B typical and ≈ 33.8 KB with explored memory at its cap (6 players × 4,436 B + vision); the DM pays 1.3–1.8 KB per View-as pick instead. Worth it. With B, "no View as" (OQ-FOG-31 B) costs the same snapshot bytes: the preview no longer competes for CON-44.
- **Players:** 277,028–280,088 → 279,444–282,759 B (≥ 241,529 left of 512 KiB), measured (seams re-run; sprint 3: 279,625–283,126).
- **Review pass (2026-10-16): not re-measured**, no ruling changes the DM snapshot beyond arithmetic: darkness `seenBy` is never on a wire; own-token `fogged` (FR-FOG-10, sprint 2's value kept) adds ≤ 84 B (6 PC tokens × `,"fogged":true`). Players: filtered darkness only removes bytes; own-token `fogged` ≤ 14 B per owned token.
- **Sprint budget (seams S2):** V's share is −1,852 B under B; the combined sprint-3 run (after V0 + R0 + P core + C1) and the 100 KiB guard are the orchestrator's (DM question at gate 1). V0 re-measures in the heavy harness.
- **Per move** (frames, measured): mover's player 5,042 B (token + `vision` + `fog-explored` + 5 newly seen tokens + 2 deletes); other players 658 B; DM 2,355 B with the identical-upsert drop (14,238 B without it, if 20 `seenBy`-only flips were resent): the drop is required (OQ-FOG-37). Moves stay drop-only (few/s).
- **CPU** (only a naive sweep is measured; the rest are **targets**): a naive O(n²) probe sweep took 0.6–3.9 ms per polygon on the typical scene and 105 ms at 2,000 walls. The build uses an angular sweep with radius culling. **Caps** = the true caps: 2,000 segments all within r = 24 cells (120 ft, FR-FOG-32), 100 fog + 20 darkness shapes, 200 tokens up to 16 cells each, 6 players × 4 sources.

| Target (V0 benchmark) | Typical | At caps |
|---|---|---|
| One sight polygon | ≤ 2 ms | ≤ 10 ms |
| A move (mover's polygons + sample tests + explored cells) | ≤ 10 ms | ≤ 30 ms |
| Full-scene re-derive (static state once per point, then per player) | ≤ 20 ms | ≤ 60 ms |
| `vision` record, one player at 4 sources | ≈ 1.2–1.7 KB | ≤ 48 KiB (frame cap 64 KB) |

  - **Exit gate:** V0 merges only when its benchmark meets the caps column. **Fallback**, in order: occluders pre-filtered to the segments within the source's radius before the sweep; the source cap (4) lowered. Still missing → V0 stops and the orchestrator takes it to the DM.
  - Senses edits and new players re-derive the active scene only (others on activation, FR-FOG-35), so no command re-derives 30 scenes in one transaction (was ≈ 30 × 60 ms).
  - `vision` at caps, **arithmetic** from the measured 346-vertex polygon (4,017 B): 4 sources × 2 polygons ≈ 32.1 KB; the View-as ack ≈ 36.6 KB with memory at its cap. V0 measures it in the benchmark.
- **Render:** one cached Konva shape for fog + vision + explored + darkness, redrawn on `fog` / `vision` / `fog-explored` change only; no new Konva layer. Review check: Chrome trace, DM pan on the `vision` bundle with View as on: median frame ≤ 20 ms.

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:`, temp asset dir, port 0; walkthrough on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests named after FRs; setups run as DM. Sprint-2 fixtures `fog-ambush`, `fog-ambush-partial`, `fog-scn` and bundles `fog`, `fog-scn` stay and must pass unchanged (migration proof).

| Key | Contents | Requires |
|---|---|---|
| `vision-senses` (owner CHARX) | Patch, `char.edit {set: {senses}}` only *(seams S10)*: Mira: vision 30 ft, no darkvision ("torch"). Thorn: darkvision 60 ft, sees through magical darkness (Devil's Sight) | `char-mira`, `char-thorn` |
| `vision-crypt` | Patch on Goblin Ambush only (Fog all from `fog-ambush`): reveal rect `[0, 6, 3, 11]` (snapped); Explored polygon `[8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5]` (free); darkness circle `[12.5, 9, 1.5]` (Goblin 2 inside, d 0.5; Goblin outside, d 2.5); one `scn.addWalls` freeform wall `[4.5, 3.25, 6.75, 5.5]`; `fog.setExplored` on. No token, sheet or other scene touched | `fog-ambush`, `scn-walls`, `goblin-2` |

- **Bundle `vision`** = `scenes` + `goblin-2` + `encounter-1` + `fog-ambush` + `scn-walls` + `vision-senses` + `vision-crypt`. Positions (cell → centre): Mira (2, 7) → (2.5, 7.5), Thorn (2, 9) → (2.5, 9.5), Goblin (12, 6) → (12.5, 6.5), Goblin 2 (12, 8) → (12.5, 8.5), Lurker (17, 11) → (17.5, 11.5) (visible flag, not a combatant); hidden: Wolf (14, 4), Elite (15, 8); walls x = 8, d1 (8, 5)–(8, 6) closed, d2 (8, 11)–(8, 12) locked. Mira r = 6 cells (`see`), Thorn r = 12 (`dark`). `session-sim` unchanged.
- **Checked geometry** (all expectations below follow from these):
  - Mira (7, 5) → (7.5, 5.5) with d1 open: Goblin d 5.10 < 6, the line crosses x = 8 at y 5.6 (d1); Goblin 2 d 5.83 but in darkness (no see-through) → not seen; Lurker d 11.7 → not seen. Cell (11, 6) (d 4.12, through d1, outside darkness and the Explored polygon) becomes Explored for P1.
  - Thorn (2, 9) with d1 open: lines to Goblin / Goblin 2 cross x = 8 at y 7.85 / 8.95 (wall) → not seen; the d1 wedge reaches only y ≈ 1.3–3.1 at x = 12.5, no token there.
  - Thorn at (11, 9) → (11.5, 9.5), in darkness (d 1.12), see-through: Goblin 2 d 1.41, Goblin d 3.16, Lurker d 6.32, no wall east of x = 8 → all three seen. Without see-through: blind.
  - Goblin dragged to (6, 2) → (6.5, 2.5): Mira at (2, 7) d 6.40 > 6; Thorn at (2, 9): the line meets the freeform wall at (5.5, 4.25); Thorn at (11, 9): the line crosses x = 8 at y 4.6 (wall) → seen by nobody.
  - Mira (2, 7) → (7, 5) crosses no wall (the freeform wall's line is met at x 6.96, past its end 6.75); → (10, 7) crosses x = 8 at (8, 7.5); → (6, 3) crosses the freeform wall at (5.625, 4.375).
- **Composition *(seams S10)*:** both units are patches that touch only V-owned fields (`statBlock.senses`; Goblin Ambush's fog row and one wall), so they compose with R's `trg-thorn`, C's `cmp-*`, P's `handouts-*`, D's `dicex-*` in the orchestrator's `session-sim-7`. Test: `vision` loaded after `trg-thorn` (and the reverse) leaves Thorn's Rogue 5 / Sneak Attack and senses both intact. Sprint-2 bundles `fog`, `fog-scn`, `scene-tools` pass unchanged.
- **Leak strings / properties** (each player's frames incl. acks and signals): ids, names, `col`/`row` of tokens that player can't see (Goblin's id while P can't see it, incl. in `map.checkMove` / `map.moveToken` rejects); "Goblin Lurker" (`player-1` always; `player-2` until Thorn stands east of the wall); `seenBy`, `doorSeen`, `walls` keys; `fogged` except on the viewer's own tokens; darkness shapes outside the viewer's filter (FR-FOG-44); another player's `vision` / `fog-explored` id; Thorn's `senses` in `player-1` frames and Mira's in `player-2`'s; while blind, any fog subject but own tokens.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-FOG-26 shapes` (zod, crossing, zero area, caps); `FR-FOG-01 static state` (painter order, boundary, base mask + shapes, legacy forms = sprint-2 cells for every `fog-ambush-partial` cell); `FR-FOG-33 sightPolygon` golden cases (empty room, wall shadow, ray through a wall endpoint, collinear wall, door open / closed, darkness occluder vs see-through, **origin in darkness without see-through → no polygon**, origin exactly on a wall (both sides seen, the wall still cuts beyond), origin on a darkness edge (= in darkness), r = 0, freeform decimals, rounded polygon = the one `seenBy` uses) + **property test** vs brute-force ray sampling + **benchmark = V0 exit gate** (150 / 2,000 walls at r 24, the §12 caps column, the `vision` record at 4 sources); `FR-FOG-34` samples (Large token one cell seen, door samples both sides, owner always in `seenBy` incl. blind); `FR-FOG-36 blind` matrix (one / two sources, see-through, one in / one out); `FR-FOG-37` memory union + cap; `FR-FOG-38` cache keys (each input invalidates) + **rollback then same-rev edit → no stale hit**; `FR-FOG-44` darkness filter (bbox meets polygon / clear cell / memory cell; none → dropped). Client: gestures per shape × snap / Ctrl, circle radius label, darkness select / move / remove, View as; render (painter, darkvision ring, darkness both ways and never over Fog / Explored, blind chip, no others' templates / pings / laser while blind); `fog-no-vision` hint (names with senses 0, hidden when none, DM only) | In-code |
| Integration | Each command: rows + undo + log + one event, IDs from `ctx`, rollback → nothing. **Per-player leak tests** (`player-1`, `player-2`, snapshot + every frame, then again after `resync` at each state; coordinates as checked above): d1 open, Mira → (7, 5) (P1 gets Goblin and cell (11, 6) explored; P2 nothing); back to (2, 7) → P1 Goblin delete, (11, 6) kept; DM moves Thorn to (11, 9) with see-through (P2 gets Goblin 2, Goblin, Lurker) and with it switched off (P2 blind: deletes all but Thorn, Mira too); Mira at (7, 5) again, DM adds wall `[10, 5, 10, 8]` (crosses Mira → Goblin at (10, 6)) → P1 Goblin delete; wall removed, d1 closed → P1 Goblin delete; Fog all / Reveal all; `map.drag` of Goblin per player (frames only to players who see the stored token, FR-FOG-15); DM ephemeral template routing; `map.checkMove` / `map.moveToken` / `map.drag` from P1 naming Goblin while unseen → `not_found` (FR-FOG-11). Darkness filter (Mira (2, 7), Thorn (2, 9)): darkness `[17.5, 11.5, 1]` (box in static fog, outside every polygon and memory) → no `fog` upsert to P1 or P2 (event `cause` only); `[1.5, 8.5, 1]` over the nook → both. **Convergence** per player (FR-SYNC-20) with the identical-upsert drop; an event left empty for a connection still arrives (`seq` kept). `FR-FOG-14`: Goblin seen by P1 only → combatant reaches both; seen by nobody → hidden; Lurker is not a combatant. `FR-FOG-07`: darkness place → Undo removes it (same id back after undoing a remove); a pre-v2 undo row → shapes `[]`, darkness kept. `FR-FOG-37`: Mira moved on a non-active scene with Explored on → no `fog-explored` row. `FR-FOG-40 migration`: rows with `seenBy = null` from the `fog` and `fog-scn` bundles → backfill → per-player **and DM** snapshots byte-equal the pre-backfill sprint-2 filter (incl. own-token `fogged`, doors, a campaign with no players); before the backfill every subject is hidden for players; rerun no-op. `FR-FOG-35` stale: a senses edit re-derives the active scene only, marks the other; activating it re-derives in the activation event. Re-derive triggers table (one test per row, incl. `player-hooks.ts` `added`, `placeTokenIn`, duplicate, recalibration no-op). Crash hooks → digest; restart → identical per-player snapshots. `FR-FOG-43`: DM snapshot has no `vision` / `fog-explored`; `sync.loadScene {viewAs: player-1}` returns P1's rows only (none of P2's), `viewAs` of another campaign's player → `not_found`, a move committed before the read is in the ack and a later one follows as an event; convergence on the loaded pair; DM resync → reload. **CON-44:** heavy harness + v2 rows under the picked option (§12): no `view-as` rows in the DM snapshot; the View-as ack at caps ≤ 48 KiB | `vision`, `fog` |
| E2E (thin) | `// e2e-bundle: vision`: the DM opens d1, `player-1` moves Mira to (7, 5) → Goblin appears for P1 only (`player-2` context: absent); reload P1 → still there; DM places darkness circle `[12.5, 6.5, 1.5]` over Goblin → gone for P1 | `vision` |

**Browser walkthrough.** `PP_TEST_MODE=1`; `bun run build`, `fixtures:reset-load vision --profile verify`, `start --profile verify` (Herdr pane). **A** DM, **B** `player-1` (Mira), **C** `player-2` (Thorn). Evidence and teardown per AGENTS §9.6; WS frames of B and C logged.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, Show to players | B, C open links | A: translucent fog, Explored corridor lighter, hatched darkness, freeform wall, all tokens; Fog badge on Goblin, Goblin 2, Lurker; no `fog-no-vision` hint. B: `fog-vision` `see` = one polygon, every vertex x ≤ 8 (cut at x = 8, shadow of the freeform wall), `dark` empty; nook clear, corridor dim and empty. C: `dark` = one polygon, every vertex with 0 ≤ y ≤ 14 has x ≤ 8, `see` empty; dimmed darkvision area |
| 2 | Fog tool: Fog + Polygon, Ctrl-click (15.3, 10.2), (18.6, 10.2), (18.6, 12.7), (15.3, 12.7), click the first vertex; Darkness + Circle, Ctrl-press at (16.4, 3.7), drag to radius 2.2 cells | — | Draft vertices off-grid (`free`); label "≈ 11 ft"; the polygon reaches B, C ≤ 1 s; the darkness reaches both (its box meets the static Explored polygon, FR-FOG-44) but draws nothing for them (over Explored, FR-FOG-21); Undo removes the darkness, Undo again the polygon (depth −2) |
| 3 | Structure → Wall, hold Ctrl: polyline (9.3, 1.2) → (11.7, 3.9) → (10.2, 5.6), double-click | — | Off-grid wall for A; B, C frames: no `walls` key |
| 4 | Open d1 | B drags Mira → (7, 5) | B: Goblin (12, 6) appears through the doorway; Goblin 2 stays hidden (in darkness); C: no Goblin frame. Cell (11, 6) turns Explored for B only (`fog-explored` `cells`) |
| 5 | — | B drags Mira back → (2, 7) | B: Goblin `delete` (d 10 > 6); (11, 6) stays dim (memory); C unchanged |
| 6 | Drag Goblin (12, 6) → (6, 2) | B drags Mira slowly toward (10, 7), then toward (6, 3), drops on (6, 3) | A: the x = 8 segment red + "through wall" (crossing at (8, 3.5)), drop accepted; Goblin at (6, 2) seen by nobody: B, C get no frame naming it. B: one red piece (8, 7)–(8, 8) while over (10, 7), then one piece ≈ (5.27, 4.02)–(5.98, 4.73) of the freeform wall; drop refused, Toast, cell flash (SCN) |
| 7 | Drag Thorn into the darkness (11, 9) | — | C: darkness as a darker see-through tint, Goblin 2 visible inside, Goblin Lurker (17, 11) appears in darkvision beyond it; B: only Thorn's move |
| 8 | Thorn's sheet: switch "Sees through magical darkness" off; then on again | — | Off: C's screen dark, grid + Thorn only, chip "Magical darkness — you can't see"; C frames: one `CharacterSheetEdited` with deletes for every other token, prop and door (Mira too). On: view restored in one event. B unaffected throughout |
| 9 | Start "Ambush at the Ford" | — | B, C Initiative: Goblin 2 (seen by C) and party; Goblin (6, 2) absent (seen by nobody); Wolf, Elite hidden; Lurker is not a combatant |
| 10 | View as Player 1; Remember explored off, then on; Forget explored…; View as Player 2 | — | A's frames: one `sync.loadScene {viewAs}` ack per pick, with only that player's `vision` / `fog-explored`; A sees B's render overlaid; B's memory hidden then back; after Forget, B's cell (11, 6) fogged again (the static Explored polygon stays); then C's render |
| 11 | Place a darkness while B is dropped (Probes) | B back | B: banner, then current state; frames after resync carry no record B can't see |
| 12 | Hard-kill server; restart | All rejoin | Shapes, darkness, memory, undo depth, per-player views as before; `state:digest` equal; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [scene-tools](scene-tools.md) | Freeform segments, walls + non-open doors as occluders (FR-SCN-37), door samples, `doorSeen`, structure edits re-derive (FR-SCN-39), `map.checkMove` wall hint (FR-SCN-38) | revised here |
| [character-sheet-full](character-sheet-full.md) | `statBlock.senses` + sheet UI (FR-CHARX-49–52) | revised here |
| [scenes-map](scenes-map.md) | Registry members + call sites (FR-FOG-24), `rederive` after token writes, `fogged` DM-only on the wire, `seenBy` column, `map.checkMove` (OQ-FOG-36) | open question |
| [live-sync](live-sync.md) | Identical-upsert drop (FR-SYNC-19), per-player signal audience (FR-SYNC-28), derived record type, `fog` windowed, `dmWindow: "view-as"` + `sync.loadScene {viewAs}` (OQ-FOG-37, FR-FOG-43) | open question; ws in V0 (seams S3) |
| [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md) | Nothing in code under OQ-FOG-25 B; the meaning of `tokenHiddenForPlayers` changes (OQ-FOG-38) | open question |
| [campaign-management](campaign-management.md) | V0 creates `player-hooks.ts` (`added`, called in the REST add transaction); fog's line in V2 (OQ-FOG-39). No edit to CAMP's route beyond the call site | settled, review A11 |
| [play-shell](play-shell.md) | Nothing: the dark screen covers the canvas only (OQ-FOG-40) | open question |
| [entities](entities.md), compendium (track C) | `senses` in the creature core zod (V0); C's adapter fills `darkvisionFt` from SRD "darkvision N ft" (C1 after V0) | settled, seams S6 |
| [fixtures-adapters](fixtures-adapters.md) | Units `vision-senses`, `vision-crypt`, bundle `vision` | at merge |

**Shared changes** (builders report `shared change needed:` per AGENTS §9.9)

| Path | Change | Slice |
|---|---|---|
| ★ `src/server/db/` (schema lock) | `scene_fog` columns, `scene_fog_edit.prevShapes`, `fog_explored`, `seen_by` on `token` / `prop` / `aoe_template`, `scene_structure.door_seen` | V0 |
| ★ `src/server/ws/`, `src/shared/protocol/`, common store (ws lock; V0 first, then `fix/lazy-records`, nobody else, seams S3) | identical-upsert drop; `SignalAudience` player lists; derived record types; `fog` flagged `dmWindow`; `dmWindow: "view-as"` + `sync.loadScene {viewAs}` + the DM client's loaded pair (FR-FOG-43; only if OQ-FOG-31 = A); leak / convergence helpers per player (incl. the View-as ack); CON-44 test re-baselined | V0 |
| `src/server/features/scenes-map/` (MAP lock) | `visibility-hooks.ts` members + `rederive` call sites in every token write, `tokenHiddenForPlayers` = `hidden \|\| fogged`, `drag.ts` per-player audience, token wire without `seenBy`, `fogged` per FR-FOG-10, `map.checkMove` + guard hints ([ADR-0040](../architecture/adr/0040-token-move-guards.md)), can't-see → `not_found` in `map.checkMove` / `moveToken` / `drag` (FR-FOG-11), `scene-hooks.ts` member `activated` + its call in scene activation | V0 |
| scene-tools folders (`src/shared/scene-tools/*`, `src/server/features/scene-tools/`) | decimal zod, scaled `blockingSegments` + `sightOccluders` + door sample points (geometry), structure commands calling fog's re-derive (no-op until V2), prop / template `seenBy` writes via `derive` (SCN §14 V0 row) | V0 |
| `src/server/features/campaign-management/player-hooks.ts` (new, append-only) | `added(env, player) → RecordChange[]`, called in the REST player-add transaction; listed in AGENTS §9.9 by the integrator at the gate | V0 (registry), V2 (fog's line) |
| `src/shared/entities/schemas.ts`, entities `definition-hooks.ts` | `senses` zod; fog's hook line | V0 / V2 |
| `src/shared/events/fog-of-war.ts` | darkness / explored events | V0 |
| Record-type registry, feature list, `fixtures/bundles/index.ts` | `fog-explored`, `vision`; bundle `vision` | V0, V2 |
| Docs: `docs/protocol/`, `docs/data-model/` | in the **same merge** as the matching code (AGENTS §9.9): V0 = tables / columns, record types (`fog` shape + `dmWindow`, `fog-explored`, `vision`, `view-as` window), `map.checkMove`, audience lists, the drop, registries (§35 + `player-hooks.ts`), CON-44 row; V1 = fog / darkness / explored intents and events; V2 = re-derive changes on token / structure / sheet events | V0, V1, V2 |
| Docs: glossary (OQ-FOG-42), AGENTS §9.9 registry list | integrator after the gate | — |

**Build slices** (after DM gate 1; order per seams S3 and review A10). Order: **V0 → V5 → V1 → (V4 ∥ V2) → V3**: V2 needs V5's `vision-senses` and `char.edit` `senses` key. V6 only if OQ-FOG-25 ≠ B, and then before R7 (combat lock). Every intermediate `main` is neutral for players: no senses are set outside fixtures until V5, and no fixture sets them until V2's bundle.

- **Schema:** V0 is the first sprint-3 schema core (V0 → R0 → P core → C1 → D style).
- **ws / protocol / common store:** V0, then `fix/lazy-records` (P's ADR); V needs nothing from it.
- **Canvas** (MapCanvas, layers, tools): V1 → V4 → V3, one at a time; no new Konva layer.
- **Character-sheet folder:** V5 first (V5 → R3 → R6 → C2 → D4 → P4 / C4, rulings X2).

| # | Branch | Contents | Shared files | Players see |
|---|---|---|---|---|
| V0 | `fix/vision-core` (L; schema + ws + MAP locks) | Schema + migration backfill, `@shared/fog-of-war/{shapes,vision}.ts` (sweep + **benchmark = exit gate**, §12), registry members + call sites (no-op lines), `player-hooks.ts`, ws changes (the `view-as` window and `sync.loadScene {viewAs}`, FR-FOG-43, **only if OQ-FOG-31 = A**), `senses` zod, record types registered empty, scene-tools shared parts, protocol + data-model docs, CON-44, full e2e as regression gate | ★ db, ★ ws / protocol, scenes-map, scene-tools folders, campaign-management `player-hooks.ts`, entities schemas, events | nothing new |
| V1 | `build/fog-shapes` (M, canvas lock 1st) | Shape / darkness / explored intents, undo over shapes + darkness, static derive with darkness, tools (Ctrl, circle, darkness edit), DM + player static render | own folders; `canvas-tools.ts` line exists | DM's freeform fog + darkness (static) |
| V4 | `build/walls-freeform` (M, SCN; canvas lock 2nd) | Ctrl drawing + magnet, the wall guard's hint line (first crossing, FR-SCN-38), red highlight (player, DM); decimal zod, scaled guard and occluders land in V0 | scene-tools folders (`map.checkMove` itself lands in V0) | red wall highlight |
| V5 | `build/sheet-senses` (S, CHARX; sheet lock 1st; right after V0) | Senses UI, `char.edit` key, `vision-senses` | character-sheet folder lock | senses on own sheet |
| V2 | `build/vision-server` (L; after V5) | Sight + cache + re-derive triggers + stale scenes + explored writes + `vision` records + darkness filter + per-player drag audience + definition / player hook lines + leak tests + `vision-crypt`, bundle `vision` | entities hook line, `player-hooks.ts` line, `fixtures/bundles/index.ts` | records by vision |
| V3 | `build/vision-client` (M, canvas lock 3rd) | Player vision render, darkvision ring, darkness overlay, blind screen, "No vision set" hint, View as (client loaded pair, FR-FOG-43; only if OQ-FOG-31 = A), e2e, walkthrough | own folders | vision |
| V6 | `build/vision-combat` (only if OQ-FOG-25 A / C; before R7) | Per-player combat copies | combat lock | — |

## 15. Open questions

Sprint-2 rows OQ-FOG-01–19 were decided at gate 2 (#196) and stay in force except: **05 / 06** (cell mask, corner snap) superseded by #201 (freeform shapes, Ctrl); **14** (every footprint cell) restated as FR-FOG-34's samples (same cells); **03** (owned tokens visible to all) refined by FR-FOG-36 (blind); **04** (CON-44) continued by OQ-FOG-30; **16 / 17** carry on below.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-FOG-20 | Whose vision does a player see through? | **A own characters only** (DM's wording; dark screen is per player) · B shared party vision (one `seenBy` per party, cheaper; dark screen contradicts it) · C campaign switch (both paths to build and test) | yes | — |
| OQ-FOG-21 | Do walls block sight? | **A yes, walls + doors not open** (the natural reading of #202; vision polygon per source) · B no, radius only (cheap, but vision leaks through walls) · C walls yes, doors never | yes | scene-tools |
| OQ-FOG-22 | Explored memory: per player or party; where; reset | **A per player, cell rows `fog-explored` in the DB, DM "Forget explored" per scene; Fog all keeps it** (follows A of -20; ~210 B per player) · B per party, one row per scene (simpler; a player "remembers" rooms they never saw) · C client memory only (lost on reload) | yes | — |
| OQ-FOG-23 | Darkvision vs vision with no lighting model | **B two radii; records use the larger; between them the map draws dimmed + desaturated** (5e flavour at no rules cost) · A one "sight" radius (simplest; darkvision is just a number) · C per-map light level bright / dim / dark (a lighting model; ADR scope) | yes | character-sheet-full |
| OQ-FOG-24 | Doors and sight | **A closed / locked block sight, open don't; a door is seen from either side** · B doors never block sight (players see through closed doors) | yes | scene-tools |
| OQ-FOG-25 | Vision-hidden combatant: Initiative, targets | **B party-level: hidden only while no player sees the token; no combat change** (P2 may see a row for a goblin only P1 sees, without its position) · A per player (combat copies, outcome lines and ranks per player: big amendments in two complete specs) · C sticky: once seen in an encounter, stays | yes | combat-tracker, combat-extras |
| OQ-FOG-26 | Vision update rate while dragging | **A on drop only** (one recompute per move) · B private live preview ≤ 10 Hz to the dragger, fog peels, records still on drop (~1.6 KB × 10/s per dragger) · C client-side (needs walls on players: leak) | no · DM gate 1 | scenes-map |
| OQ-FOG-27 | Migration from the cell mask | **A keep the mask as the base layer, shapes paint over it; boot backfill fills `seenBy` once** (byte-identical views, no data rewrite) · B convert masks to rectangles (≤ 2,000 runs → over the shape cap) · C convert to polygons (needs a union library) | yes | fixtures |
| OQ-FOG-28 | Where per-player visibility is computed | **A server-written per-player `seenBy` copies (ADR-0039 pattern) + server vision polygons** (fns stay pure; atomic; crash-safe) · B in-memory per-player set read by the filter (breaks ADR-0021; transition matrix needs before-state) · C client render + coarse server filter (leaks positions) | yes | live-sync |
| OQ-FOG-29 | Geometry dependency (needs the DM's OK if a library) | **A hand-rolled** sweep + point-in-shape, ~300 lines + property tests; exact integer-scaled math shared with the move guard · B `visibility-polygon` 1.1.0 (MIT, 5.5 KB min, 0 deps, last release 2020, float) · C `martinez-polygon-clipping` 0.9.0 (MIT, ~11 KB, active, 2026-09) or `polygon-clipping` 0.15.7 (MIT, 29 KB, 2023): only if memory or shapes become polygons (not picked) | yes | — |
| OQ-FOG-30 | CON-44 (measured §12; options re-cut by seams S1) | **B window `fog` to the active scene, View-as data on demand (FR-FOG-43): 674,186 B, 112,246 left (−1,852 vs today)** · A not windowed: 66,341 left, over at caps · C windowed, View-as data in the snapshot (pre-seams pick): 101,806 left, 78,413 at the explored cap | yes | live-sync, ADR-0041 |
| OQ-FOG-31 | DM "View as player" (beyond #201 / #202) | **A in** (no snapshot cost under OQ-FOG-30 B; 1.3–1.8 KB per pick, ≈ 36.6 KB at caps; DM checks the fog before play) · B out (Fog badge only; saves the client code and V0's `view-as` window, which is built only under A) | no · DM gate 1 | live-sync |
| OQ-FOG-43 | **Seam (S1):** how does the DM get other players' `vision` / `fog-explored` for View as? | **Settled by seams S1:** on demand, not in the snapshot; a scene-scope load (lazy record types are campaign / global only): `dmWindow: "view-as"` + `sync.loadScene {sceneId, viewAs}`, one player at a time (FR-FOG-43). Measured: saves 10,440 B typical, ≈ 33.8 KB at caps | no · settled | live-sync, ADR-0041 |
| OQ-FOG-32 | Darkness geometry to players | **B per-player filtered darkness (FR-FOG-44): a shape is sent only if its box meets the player's sight, clear / explored area or memory; ≤ 20 shapes, cheap** · A the whole `fog` row to every player (simpler, but the DM moves darkness by hand to follow a caster, so every `fog.moveDarkness` would tell all players where an unseen enemy is) | yes | — |
| OQ-FOG-33 | "Explored" as a DM drawing mode | **A yes: a known-but-unseen area (map shown, contents hidden)** · B memory only | no · DM gate 1 | — |
| OQ-FOG-35 | Numbers | **≤ 100 fog + 20 darkness shapes, row ≤ 16 KiB, 64 vertices, circle ≤ 60 cells, Explored default off, senses 0–120 ft (5e's largest darkvision; integrator pick) default 0, ≤ 4 sources per player, cache 256, move ≤ 30 ms at caps (V0 exit gate)** | no · DM gate 1 | character-sheet-full |
| OQ-FOG-44 | Is darkness in the fog undo stack? (#196 decided "undo for scene editing") | **A yes, same stack: place / move / remove / clear are undoable, LIFO with fog edits** (one Undo for everything the DM drew; moving darkness each round fills the 20-deep stack) · B no: remove is the inverse of place, Undo skips darkness (a mis-moved darkness can't be put back) | no · DM gate 1 | — |
| OQ-FOG-36 | **scenes-map:** registry members `derive → {fogged, seenBy}`, `hides(…, viewer)`, `dragAudience`, `rederive`; `scene-hooks.ts` `activated`; `tokenHiddenForPlayers` re-implemented as `hidden \|\| fogged` (was "any `hides`"); `seenBy` column; `fogged` per FR-FOG-10; can't-see → `not_found` in `map.checkMove` / `moveToken` / `drag`; `map.checkMove` with guard hints | **Accept as FR-FOG-24 / FR-SCN-38** (one MAP-lock change in V0) · ask scenes-map for another shape | yes | scenes-map, ADR-0039, ADR-0040 |
| OQ-FOG-37 | **live-sync:** FR-SYNC-19 drops `visible → visible` upserts with identical wire data per connection; FR-SYNC-28 audience may be a player list; derived record types; `fog` gets `dmWindow` | **Accept** (V owns the ws lock) · per-connection last-sent cache instead of the before / after compare (memory per connection). Seams: V0 holds ws first, then `fix/lazy-records` (S3); the drop supersedes backlog BL-09 (S11), is per change (an empty event still goes out) and is gated by the full e2e suite (review A15); FR-FOG-43 adds the `view-as` window (S1) | yes | live-sync, ADR-0033, ADR-0041 |
| OQ-FOG-38 | **combat-tracker / combat-extras:** `tokenHiddenForPlayers` = hidden or seen by nobody (OQ-FOG-25 B) | **Accept: note in both specs, no FR change** · per OQ-FOG-25 A: per-player combat copies (V6, before R7: seams S3) | yes | combat-tracker, combat-extras |
| OQ-FOG-39 | **campaign-management:** a new player must get `seenBy` membership | **Settled by review ruling A11:** V0 creates `player-hooks.ts` (append-only, `added(env, player) → RecordChange[]`, called in the REST add transaction; AGENTS §9.9 at the gate); fog's line re-derives the active scene for that player and marks the others stale (FR-FOG-35). No "deleted" trigger: player removal is out of scope (CAMP §2) | no · settled | campaign-management |
| OQ-FOG-40 | **play-shell:** does the dark screen cover windows? | **A canvas only; sheet, Initiative, log stay usable** · B dim the whole shell | no · DM gate 1 | play-shell |
| OQ-FOG-41 | **entities / compendium:** imported SRD monsters' darkvision | **Settled by seams S6:** `senses` lives in the creature core zod (V0); C's adapter fills `darkvisionFt` from SRD "darkvision N ft" (C1 runs after V0); blindsight / truesight stay text; a monster's see-through defaults false (the DM sets Devil's Sight on a custom definition's sheet). Matters only for player-owned tokens | no · settled | entities, compendium |
| OQ-FOG-42 | Glossary | **Settled by seams S9:** integrator adds after the gate; **Reveal** stays fog's word (P uses Share). Terms: **Fog** → "Areas of a scene hidden from players: freeform shapes over a base mask; pierced by vision"; add **Explored**, **Magical darkness**, **Vision source**, **Sight**, **Darkvision**, **Sees through magical darkness**, **Blind (dark screen)**, **Seen by** (server copy), **View as**; **Fog-hidden** → per player | no · integrator | glossary |
| OQ-FOG-17 | Fog colours | Placeholder tokens §7 until theme-system | no · integrator | visual-direction |

OQ-FOG-34 is retired (merged into SCN's OQ-SCN-22 while drafting).

## 16. Out of scope

- Dynamic lighting, light sources, colour, shadows; vision for unowned tokens; darkness attached to tokens; one-way / terrain walls; fogged map images (OQ-FOG-09).
- Layers, walls, doors, props, AoE templates themselves → [scene-tools](scene-tools.md); senses on the sheet → [character-sheet-full](character-sheet-full.md).
