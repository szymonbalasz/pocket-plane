---
title: Fog of war
prefix: FOG
status: in-review
owner: spec-vision
phase: post-mvp-3
---

# Fog of war (FOG v2: freeform fog, dynamic vision, magical darkness)

> **FOG v2** (sprint 3, track V; DM decisions [#201](../decisions-log.md), [#202](../decisions-log.md)) replaces sprint 2's static cell fog. FR IDs are kept where the behaviour survives (text amended in place), retired IDs are struck through, new ones start at FR-FOG-26. One vision design across this spec, [scene-tools](scene-tools.md) (walls, SCN) and [character-sheet-full](character-sheet-full.md) (senses, CHARX); ADR: [proposed-dynamic-vision](../architecture/adr/proposed-dynamic-vision.md). **Bold** in §15 = suggested pick, not decided. *Seams pass (orchestrator ruling, 2026-10-16):* View-as data on demand (FR-FOG-43, S1, re-measured §12), build order (S3), senses via compendium (S6), terms (S9), composable fixtures (S10), BL-09 (S11).

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

- **Zero leakage per player:** no player frame (snapshot, event, signal, ack) carries the id, name, position, image or any field of a record that player can't see, before or after a reconnect; nor another player's vision, explored memory or senses.
- A token move = one transaction, one event, one frame per connection; commit → player frame ≤ 1 s; vision work ≤ 10 ms typical, ≤ 30 ms at caps (benchmark, §12).
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
| FR-FOG-02 | New scene fully fogged *(decided #196)*: fog's `created` line writes `{fill: fog, runs: "", shapes: [], darkness: [], explored: false}`; `duplicated` copies the source's row (shapes, darkness, setting), not its undo stack or explored memory. | Unchanged otherwise |
| FR-FOG-03 | *(amended)* **Box** applies to the base mask only (≤ 513 × 513 cells, sprint-2 formula). ~~Each edit re-bases the mask~~ *(retired: shapes no longer touch the mask)*; `fog.setAll` writes `{fill, runs: ""}` over the current box. | |
| FR-FOG-04 | Run-length codec unchanged (`@shared/fog-of-war/mask.ts`); also encodes explored memory (FR-FOG-37). Bad sum → fully fogged + `error` log (fail closed). | |
| FR-FOG-26 | **Shapes** (zod, `@shared/fog-of-war/shapes.ts`): `rect [x0, y0, x1, y1]` (normalised), `polygon [x, y, …]` 3–64 vertices, simple (no crossing edges), area > 0, `circle [cx, cy, r]` r 0.5–60 cells. \|coord\| ≤ 1,024. Fog shape = `{op: reveal \| fog \| explored, <shape>}`; darkness = `{id, <shape>}`. Crossing / zero area → `invalid`. | |
| FR-FOG-27 | **Caps** *(OQ-FOG-35)*: ≤ 100 fog shapes and ≤ 20 darkness shapes per scene; the serialized `fog` row ≤ 16 KiB. Over → `conflict` "Fog too detailed — use Fog all or Reveal all to start over" / "Too many darkness areas". Nothing written. | §12 |
| FR-FOG-28 | **Magical darkness** = the row's `darkness` list (ids from `ctx.ids`): a union, independent of fog state; Fog all, Reveal all and Undo never touch it. A point is **in darkness** iff inside any darkness shape. | |
| FR-FOG-29 | **Explored memory setting** per scene: `explored` on the fog row, default **off** (new and existing scenes), `fog.setExplored {sceneId, on}`. Off: memory neither grows nor draws; rows are kept. | OQ-FOG-35 |
| **Editing** (DM only; WS intents, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D) | | |
| FR-FOG-05 | *(amended)* `fog.edit {sceneId, op: reveal \| fog \| explored, shape}` appends one fog shape. **Legacy forms** stay valid, so fixtures and tests behave as before: `op: hide` = `fog`; `{kind: rect, c0, r0, c1, r1}` (cells) = `rect [c0, r0, c1 + 1, r1 + 1]`; `{kind: polygon, points}` (grid corners) = that polygon. Same cells result: a cell's state is its centre's (FR-FOG-34). ~~No cell changes → no event~~ *(retired: every edit appends; V1 rewrites the sprint-2 no-op tests)*. | Raster retired |
| FR-FOG-06 | `fog.setAll {sceneId, fogged}`: base → `{fill: fog \| clear, runs: ""}`, `shapes: []`. Darkness, setting and explored memory untouched. Same value and no shapes → no-op. | |
| FR-FOG-07 | Undo `fog.undo {sceneId, expectedEditId}` restores **base + shapes** from before the latest `fog.edit` / `fog.setAll`; strict LIFO, ≤ 20, persisted, `expectedEditId` guard, no redo. Darkness, setting and memory are not in the stack (remove is the inverse of place). | Unchanged contract |
| FR-FOG-30 | **Darkness intents:** `fog.placeDarkness {sceneId, shape}` → `{darknessId}`; `fog.moveDarkness {sceneId, darknessId, dx, dy}` (translate, grid units); `fog.removeDarkness {sceneId, darknessId}`; `fog.clearDarkness {sceneId}`. Unknown id → `not_found`. | |
| FR-FOG-31 | `fog.forgetExplored {sceneId}` (DM, confirm): deletes every `fog-explored` row of the scene. | |
| FR-FOG-08 | *(amended)* Every fog command = one transaction: `fog` row (`rev` + 1) + undo row + the scene **re-derive** (FR-FOG-35) + one event-log entry; then one event (§9). IDs, time from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). | |
| FR-FOG-09 | Fog intents work on any scene; disabled in the UI while not `live`. A player sending any `fog.*` → `forbidden`. | Unchanged |
| **Vision** | | |
| FR-FOG-32 | **Vision source:** a token with `ownerPlayerId = P`, not `hidden`. Senses come from its definition's `statBlock.senses` (CHARX FR-CHARX-49; absent = vision 0, darkvision 0, no see-through). Origin = footprint centre. Reach `r = max(visionFt, darkvisionFt) / 5` cells. Sources of P = **P's own tokens** on that scene *(pick, OQ-FOG-20)*. | |
| FR-FOG-33 | **Sight polygon** per source (pure `sightPolygon(origin, r, occluders)`, `@shared/fog-of-war/vision.ts`, exact orientation tests on integer-scaled coordinates): the visibility polygon from the origin, bounded by a 64-gon of radius `r`, cut by **occluders** = walls + doors not open (SCN FR-SCN-37) *(picks, OQ-FOG-21 / -24)* + for a source **without** see-through, the edges of every darkness shape. Two polygons per source: `see` (radius vision) and `dark` (radius darkvision); records use the larger *(pick, OQ-FOG-23)*. r = 0 → none. | Hand-rolled (OQ-FOG-29) |
| FR-FOG-34 | **Visible to P** (pure `pointVisible(scene, P, pt)`): P not blind (FR-FOG-36) and either the point's static state is clear and it is not in darkness, or it lies in one of P's sight polygons (a see-through source's polygon includes darkness; another's stops at it). Explored counts as hidden for records. A **subject** is visible to P iff any **sample point** is: token = every footprint cell centre ([FR-MAP-14](scenes-map.md#6-functional-requirements)); prop, template = SCN's uncut cell centres; door = 2 points 0.25 cell either side of its midpoint (FR-SCN-36). An **owned** token is always visible to its owner, and to every other non-blind player (party exemption, #196). | Same cells as sprint 2 when no vision |
| FR-FOG-35 | **Re-derive** (server, in the writing command's transaction): recompute the affected players' sources and polygons (cache, FR-FOG-38), the `seenBy` of affected subjects, P's explored row (FR-FOG-37) and `vision` record; list every flipped row in the command's event. Triggers below; token-changed hooks ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) run for every token whose `tokenHiddenForPlayers` flips (FR-FOG-13). | Table below |
| FR-FOG-36 | **Blind:** P is blind on a scene iff P has ≥ 1 source there, every source's origin is in darkness and none sees through. Blind P receives **no fog subject** (token, prop, DM template, door) **but their own tokens** (party tokens too are dropped; combat rows stay party-level, FR-FOG-14) and draws the dark screen (FR-FOG-21); `vision {blind: true, see: [], dark: []}`. Leaving darkness restores the view in the same event. | DM #201 |
| FR-FOG-37 | **Explored memory** (scene setting on): every cell whose centre lies in one of P's polygons becomes explored for P; one `fog-explored` row per (scene, player) (box + runs, FR-FOG-04 codec), written in the same transaction as the move / re-derive, **never shrinks** *(per player, OQ-FOG-22)*. > 2,000 runs → memory stops growing, `warn` log (map pixels only, never records). Visible to its player; the DM loads it on demand (FR-FOG-43). | |
| FR-FOG-10 | *(amended)* **Copies:** each fog subject stores **`seenBy`** = ids of the campaign's players for whom FR-FOG-34 holds (server-only column, **never on the wire**) and **`fogged`** = `seenBy` empty (DM wire only, when true; players never get `fogged`). Written by `derive` before every subject write (call sites as sprint 2: place, `placeTokenIn`, duplicate, move, size refresh, SCN prop / template writes) and by re-derive. Doors: `scene-structure.doorSeen {<n>: playerId[]}`; door `f` = seen by nobody. In an intent → `invalid`. Order (S4): guards → `derive` → one write → **re-derive dependants** → token-changed hooks. | ADR-0039 pattern, per player |
| FR-FOG-11 | *(amended)* **Fog-hidden for P** (pure, record + viewer): `fogHidden(type, record, playerId)` = P ∉ `seenBy` and not P's own token. `hidden` stays independent: hidden **or** fog-hidden → hidden for P. | `@shared/fog-of-war` |
| FR-FOG-12 | *(amended)* Visibility via `hides(type, record, viewer)` (FR-FOG-24). Snapshot and events share the fn; per connection the transition matrix (FR-SYNC-19) turns a flip into `upsert` / `delete`; a `visible → visible` change whose wire data is identical for that connection is **dropped** (OQ-FOG-37, live-sync; built in V0, supersedes backlog BL-09, seams S11). | Per player |
| FR-FOG-13 | Token-changed hooks on flips: fog commands, re-derive and the size refresh run them for every token whose **party-level** hidden (FR-FOG-14) flips; rows join the event. | Unchanged contract |
| FR-FOG-14 | *(amended meaning)* **Combat:** every combatant / effect hidden copy keeps using `tokenHiddenForPlayers(token)`, which now = `hidden` or **seen by no player** (`fogged`). A monster seen by any player is a visible combatant for every player *(pick, OQ-FOG-25)*; no combat call site changes. Targeting stays DM-only (#134). | combat-tracker / -extras: no code change |
| FR-FOG-15 | *(amended)* **Signals** ([ADR-0033](../architecture/adr/0033-signal-audience.md)): `map.drag` position frames route to the DM plus the players for whom the token at the previewed cell is visible (FR-FOG-34 on cached polygons); an `end` frame to the players who see the stored token. DM-placed ephemeral `scn.template`: players for whom any uncut cell centre is visible. Needs `audience` → player-id lists (OQ-FOG-37). | Per player |
| FR-FOG-16 | Camera fit: no change (a player's content box uses its own store). | |
| FR-FOG-38 | **Vision cache** (server memory, never authoritative): `(sceneId, playerId)` → polygons + blind, keyed by fog `rev`, structure `rev` and the sources' `(tokenId, col, row, size, senses)`; LRU 256 entries; a miss recomputes from the DB. Restart → empty cache, same results. | §12 |
| FR-FOG-39 | **`vision` record** (derived, not stored): one per (scene, player) with ≥ 1 source: `{id = sceneId:playerId, sceneId, playerId, blind, see: number[][], dark: number[][]}`, flat coordinates, 2 decimals. Snapshot computes it from the DB; commands list before / after when a source or occluder changes. Visible to that player; the DM loads it on demand (FR-FOG-43). | |
| FR-FOG-43 | **View-as data on demand** *(seams S1)*: `vision` and `fog-explored` are registered with **`dmWindow: "view-as"`** (scene scope): the DM snapshot carries **none** of them. Picking **View as P** on the viewed scene sends `sync.loadScene {sceneId, viewAs: P}` → `ack {records {vision, fog-explored}}` = P's rows on that scene only (through the scope gate and visibility fn, in hub frame order, as [ADR-0041](../architecture/adr/0041-active-scene-window.md)); P not in the campaign → `not_found`. Live events are unchanged (ADR-0041: they still reach the DM). The DM client keeps one loaded `(sceneId, playerId)` pair: View as off, another player or another viewed scene drops it (and loads the new pair); a snapshot resets it and reloads if View as is still on. Convergence (FR-SYNC-20) compares `view-as` types only for the loaded pair. One load in flight; reject → Toast, View as back to "DM". | Lazy record types are campaign / global only (S1) |
| FR-FOG-40 | **Migration** *(pick, OQ-FOG-27)*: schema push adds the columns (`shapes`, `darkness` `[]`, `explored` false, `rev` 0; `seenBy` null). An idempotent **boot backfill** re-derives every scene whose subjects still have `seenBy = null` (FR-MAP-50's pattern). With no senses set, every player's view equals sprint 2's: same cells, same tokens. Fixture units and FR-FOG-25's ripple stay as they are. | Neutral |
| **Client** | | |
| FR-FOG-17 | *(amended)* **Fog tool** (DM, `canvas-tools.ts` line, floating fog bar): **Mode** Reveal \| Fog \| Explored \| Darkness; **Shape** Rectangle \| Polygon \| Circle (defaults Reveal, Rectangle); Reveal all; Fog all… (AlertDialog as sprint 2); Undo (Tooltip "Undo: ‹reveal \| fog \| explored› ‹rectangle \| polygon \| circle \| all›"); Switch **Remember explored areas** (FR-FOG-29); **Forget explored…** (AlertDialog "Players lose the explored map of this scene."); **View as** Select (DM, Players + "DM", OQ-FOG-31; picking a player loads that player's rows, FR-FOG-43, with a spinner in the Select until the ack); in Darkness mode: **Clear darkness…**. Stage-level dispatch, Space + drag pans (sprint 2). | |
| FR-FOG-18 | *(amended)* **Rectangle:** left-drag corner to corner; corners snap to the nearest grid corner **unless Ctrl** is held (read on every move: free, rounded to 0.01). < 4 px = the cell under the press. Esc cancels. Release sends; the draft stays until the event or reject (Toast). | |
| FR-FOG-19 | *(amended)* **Polygon:** each click adds a vertex at the nearest grid corner, or **free with Ctrl**; < 4 px from the last ignored; crossing refused (Tooltip "Edges can't cross"); Enter / double-click / first vertex closes (≥ 3); Backspace; Esc; 64 max. | |
| FR-FOG-41 | **Circle:** press = centre (nearest grid corner, free with Ctrl), drag = radius in whole cells (label "15 ft"), free with Ctrl (label rounded to ft). < 4 px → 1 cell. Esc cancels. Darkness + Circle is the usual Darkness spell (15 ft). | |
| FR-FOG-42 | **Darkness editing** (Darkness mode): click a darkness shape selects it (outline handles); drag moves it (snapped by whole cells, free with Ctrl) → `fog.moveDarkness` on release; Delete / Backspace or its right-click menu **Remove** → `fog.removeDarkness`. Drawing starts only on empty space. | |
| FR-FOG-20 | *(amended)* **DM render** (`fog` layer, order 30; one cached Konva shape, no new Konva layer: the stage already warns at 8–9, session-sim-6): Fog ≈ 50 % (`fog.dm`), Explored ≈ 25 % (`fog.dm-explored`), darkness hatched (`fog.dm-darkness`), shapes' edges hairline. **View as P:** that player's render (FR-FOG-21) at 70 % over the DM view, from P's loaded `vision` + `fog-explored` (FR-FOG-43; the server's result, not a client recompute), tokens P can't see dimmed (FR-FOG-34 on those polygons, same pure fns). Fog badge (`fog-token-fogged`) = seen by no player. | |
| FR-FOG-21 | *(amended)* **Player render** (same layer, under templates / tokens / labels; one cached shape): unseen **Fog** opaque (`fog.player`); **Explored** (static, or the player's memory) and not in sight: map dimmed (`fog.explored`), records absent; in sight: clear; beyond `see` but inside `dark`: dimmed + desaturated (`fog.darkvision`); **darkness**: without see-through opaque (`fog.darkness`), with see-through inside sight a darker, more transparent tint (`fog.darkness-seen`). **Blind:** the whole map dark, grid lines redrawn on top, own tokens only, chip "Magical darkness — you can't see" (`fog-blind`). Drawn from the snapshot + `vision` + `fog-explored` records. | Tokens: OQ-FOG-17 |
| FR-FOG-22 | A gesture in progress is dropped when the client leaves `live`, the viewed scene changes or another tool is picked. | Unchanged |
| **Lifecycle** | | |
| FR-FOG-23 | *(amended)* Scene delete: `deleting` lists the `fog` delete and every `fog-explored` / `vision` row of the scene; FK cascade removes rows and stack. Activation: players get the new scene's `fog`, their `vision` and `fog-explored` in the resync snapshot. | |
| FR-FOG-24 | *(amended)* **Registries** (scenes-map's, append-only): `visibility-hooks.ts` members become `derive(read, obj) → {fogged, seenBy}`, `hides(type, record, viewer)`, `dragAudience(read, token, at) → playerId[]` (replaces `dragToDm`), new `rederive(env, before, after) → RecordChange[]` (dependants of a token / subject write, run after the write); `scene-hooks.ts` unchanged. Fog also appends a line to entities' definition-changed hooks (senses, FR-FOG-35) and to campaign-management's player hook (OQ-FOG-39). | Call sites in `fix/vision-core` |
| FR-FOG-25 | Ripple unchanged: units / helpers that create scenes reveal them; nothing new to ripple (senses default to 0). | |

**Re-derive triggers** (FR-FOG-35)

| Write | Players | Subjects |
|---|---|---|
| Fog edit / setAll / undo; darkness place / move / remove / clear | all | every subject on the scene |
| SCN structure edit, door state (FR-SCN-39) | all | every subject on the scene |
| Vision source placed, moved, duplicated, deleted, resized, hidden / revealed, owner changed | old and new owner | every subject on the scene + the token itself |
| Other subject written | all | that subject (`derive`) |
| Senses edit (definition-changed hook) | owners of that definition's tokens | every scene with such a token |
| Player created / deleted (OQ-FOG-39) | that player | every scene of the campaign |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, the map is the hero; lucide `cloud-fog`, `moon` (Darkness), `eye` (View as). Colours are placeholder semantic tokens (`fog.player`, `fog.explored`, `fog.darkvision`, `fog.darkness`, `fog.darkness-seen`, `fog.dm*`) until theme-system (OQ-FOG-17).

- **Screens:** no window. Tool line + floating fog bar + the `fog` canvas layer + one overlay badge + the blind chip.
- **States:** empty = no row (clear) or fully fogged with no sources (black map, party tokens). Loading = scene loading. Error = Toast, draft removed. Disconnected = fog bar disabled, gestures dropped, last fog / vision drawn.
- **DM view:** everything; fog translucent; Explored lighter; darkness hatched with handles when selected; Ctrl shows a "Free" hint chip at the cursor while drawing; View as P overlay.
- **Player view:** FR-FOG-21. No fog controls. Party tokens over fog (unless blind).
- **Test IDs:** `map-tool-fog` (rail), `fog-bar`, `fog-mode-<reveal|fog|explored|darkness>`, `fog-shape-<rect|polygon|circle>`, `fog-reveal-all`, `fog-fog-all`, `fog-fog-all-confirm`, `fog-undo` (`data-depth`), `fog-explored-toggle` (`data-state`), `fog-forget-explored`, `fog-forget-explored-confirm`, `fog-clear-darkness`, `fog-clear-darkness-confirm`, `fog-view-as` (`data-value` = playerId \| `dm`, `data-loading` while the FR-FOG-43 load is in flight), `fog-darkness-menu-remove`, `fog-blind`. Konva: layer `fog-layer`; shape `fog-mask` (attrs `shapes`, `darkness`, `fogged-cells`); `fog-darkness` (id = darkness id, attr `selected`); `fog-vision` (attr `sources`, `blind`); `fog-explored` (attr `cells`); `fog-draft`, `fog-draft-vertex` (id = index, attr `free`); badge `fog-token-fogged`.

## 8. Data model

JSON leaf fields per [ADR-0006](../architecture/adr/0006-persistence.md): `shapes`, `darkness`, `prevShapes`, `seenBy`, `doorSeen`. Rows per campaign; time from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Fog (`scene_fog`) | sceneId (PK), campaignId; fill; col0, row0, cols, rows; runs; updatedAt | as sprint 2 | Base mask |
| | **shapes**; **darkness**; **explored**; **rev** | **JSON** `{op, rect \| polygon \| circle}[]` ≤ 100; **JSON** `{id, rect \| polygon \| circle}[]` ≤ 20; bool; int | Row ≤ 16 KiB |
| Fog edit (`scene_fog_edit`) | + **prevShapes**; kinds + `reveal-shape`, `fog-shape`, `explored-shape` | **JSON**; enum | Sprint-2 kinds stay valid |
| Explored memory *(new, `fog_explored`)* | sceneId + playerId (PK), campaignId; col0, row0, cols, rows; runs; updatedAt | ID → Scene (cascade), ID → Player (cascade), ID; int ×4; text ≤ 10 KB; timestamp | Wire id `sceneId:playerId` |
| Token *(scenes-map)*, Prop, AoE template *(SCN)* | **seenBy**; fogged | **JSON** playerId[] \| null (server only); bool | null = pre-v2 (backfill) |
| Scene structure *(SCN)* | **doorSeen** | **JSON** `{<n>: playerId[]}` | Server only |
| Creature `statBlock.senses` *(CHARX)* | visionFt, darkvisionFt, seesMagicalDarkness | int 0–300 step 5 ×2, bool | JSON leaf, zod only |
| Vision *(derived, no table)* | id, sceneId, playerId, blind, see, dark | computed | FR-FOG-39 |

- **Relations:** Scene 1—0..1 Fog; Scene 1—* Fog edit; Scene × Player 1—0..1 Explored memory; fog subjects → Scene; vision source = Token → Entity (senses), Player (owner).
- **Derived:** static state, darkness, sight polygons, blind, `seenBy`, `fogged`, `vision`, undo depth. Client only: draft, selection, View as + its loaded `(sceneId, playerId)` pair.
- **Persisted runtime state:** fog rows, undo stacks, explored memory, `seenBy` / `fogged` / `doorSeen` copies, committed together. The vision cache is memory only.

## 9. API & events

**REST:** none.

| WS intent (DM only) | Validation / ownership |
|---|---|
| `fog.edit {sceneId, op, shape}` → `{editId}` | Scene in `ctx.campaignId` (`not_found`); FR-FOG-26 zod (legacy forms FR-FOG-05); caps → `conflict` |
| `fog.setAll {sceneId, fogged}` → `{editId \| null}`; `fog.undo {sceneId, expectedEditId}` | As sprint 2 |
| `fog.placeDarkness {sceneId, shape}` → `{darknessId}`; `fog.moveDarkness {sceneId, darknessId, dx, dy}`; `fog.removeDarkness {…, darknessId}`; `fog.clearDarkness {sceneId}` | Id on the scene, else `not_found`; caps; moved shape must stay within ±1,024 |
| `fog.setExplored {sceneId, on}`; `fog.forgetExplored {sceneId}` | Same value / no rows → no-op |
| `sync.loadScene {sceneId, viewAs?}` *(live-sync's intent, extended in V0; seams S1)* → `ack {records}` | DM only, read-only; `viewAs` = a player of the campaign, else `not_found`; with `viewAs` the result is that player's `view-as` rows only (FR-FOG-43) |

| Record type | Scope | DM wire | Player visibility | Snapshot |
|---|---|---|---|---|
| `fog` | scene, `sceneOf = id`, **`dmWindow`** *(pick, OQ-FOG-30)* | `{id, campaignId, fill, box, runs, shapes, darkness, explored, undo}` | redacted: no `campaignId`, `undo` | DM: active scene (+ `sync.loadScene`); player: active scene |
| `fog-explored` *(new)* | scene, **`dmWindow: "view-as"`** *(seams S1)* | `{id, sceneId, playerId, box, runs}` | full iff `playerId = viewer`, else hidden | player: own row, active scene; DM: none, `sync.loadScene {sceneId, viewAs}` (FR-FOG-43) |
| `vision` *(new, derived)* | scene, **`dmWindow: "view-as"`** | `{id, sceneId, playerId, blind, see, dark}` | full iff `playerId = viewer`, else hidden | same |
| `token`, `scene-prop`, `aoe-template`, `scene-structure` | unchanged | + `fogged` (DM only) | `hidden` or fog-hidden for that player → hidden; doors filtered by `doorSeen`; never `seenBy`, `doorSeen`, `fogged` | unchanged |

| Change (per player P) | P | Other players |
|---|---|---|
| P's source moves; a monster enters P's sight | `token` upsert(s), `vision` upsert, `fog-explored` upsert | the moved token only (party exemption) |
| Monster leaves P's sight | `delete` | — |
| P becomes blind / sees again | `delete` / `upsert` of every visible fog subject but own tokens; `vision {blind}` | unchanged |
| `fog` / darkness edit | `fog` upsert + flips | same |
| `map.drag` of a monster | frames only while P sees the previewed cell | per their sight |
| Combatant / effect of a token seen by nobody → by someone | `upsert` (party-level) | `upsert` |

| Domain event (logged; not ADR-0016-undoable) | Payload | Changes |
|---|---|---|
| `FogEdited` / `FogUndone` | `{sceneId, editId, kind}` | `fog`; flipped subjects; `scene-structure`; `vision`; token-hook rows |
| `DarknessPlaced` / `DarknessMoved` / `DarknessRemoved` / `DarknessCleared` | `{sceneId, darknessId?}` | same as `FogEdited` |
| `FogExploredSet` / `ExploredForgotten` | `{sceneId, on}` / `{sceneId}` | `fog` / `fog-explored` deletes |
| Token events, `StructureEdited`, `EntityUpdated` (senses), player create (CAMP) | unchanged | + flipped subjects, `vision`, `fog-explored` (re-derive) |

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
- **Concurrent edits:** serialised; each derive reads committed state. A door closed while a player drags: the drop re-derives against it. Two DM tabs undoing → `conflict`.
- **Source edge cases:** two own tokens → union; one in darkness, one outside → not blind; senses all 0 → no polygon (revealed area still visible); token hidden by the DM → no vision; owner removed → that player loses its vision in the same event.
- **Grid / map change:** shapes and memory are in grid units / cells and follow the grid; subjects re-derive on the next edit or move (static state uses uncut cells, as sprint 2).
- **Invalid / malicious input:** player `fog.*` → `forbidden`; `seenBy` / `fogged` in any intent → `invalid`; zod caps; frame cap 64 KB; corrupt runs → fogged.
- **Accepted leaks:** the map image (OQ-FOG-09); the active scene's fog shapes and darkness geometry (OQ-FOG-32); party tokens; a monster's Initiative row while only another player sees it (OQ-FOG-25); wall pieces inside one's own sight (polygon edges) and ≤ 1 cell of a wall a drag crosses (SCN FR-SCN-38); `cause` names (`DarknessPlaced`).

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
- **Sprint budget (seams S2):** V's share is −1,852 B under B; the combined sprint-3 run (after V0 + R0 + P core + C1) and the 100 KiB guard are the orchestrator's (DM question at gate 1). V0 re-measures in the heavy harness.
- **Per move** (frames, measured): mover's player 5,042 B (token + `vision` + `fog-explored` + 5 newly seen tokens + 2 deletes); other players 658 B; DM 2,355 B with the identical-upsert drop (14,238 B without it, if 20 `seenBy`-only flips were resent): the drop is required (OQ-FOG-37). Moves stay drop-only (few/s).
- **CPU:** a naive O(n²) probe sweep took 0.6–3.9 ms per polygon on the typical scene and 105 ms at 2,000 walls. The build uses an angular sweep with radius culling: **target ≤ 2 ms per polygon typical, ≤ 10 ms at caps; a move ≤ 10 ms / ≤ 30 ms** incl. sample tests and explored cells (unit benchmark, `fix/vision-core`). Full-scene re-derive (6 players): ≤ 60 ms at caps.
- **Render:** one cached Konva shape for fog + vision + explored + darkness, redrawn on `fog` / `vision` / `fog-explored` change only; no new Konva layer. Review check: Chrome trace, DM pan on the `vision` bundle with View as on: median frame ≤ 20 ms.

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:`, temp asset dir, port 0; walkthrough on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests named after FRs; setups run as DM. Sprint-2 fixtures `fog-ambush`, `fog-ambush-partial`, `fog-scn` and bundles `fog`, `fog-scn` stay and must pass unchanged (migration proof).

| Key | Contents | Requires |
|---|---|---|
| `vision-senses` (owner CHARX) | Patch, `char.edit {set: {senses}}` only *(seams S10)*: Mira: vision 30 ft, no darkvision ("torch"). Thorn: darkvision 60 ft, sees through magical darkness (Devil's Sight) | `char-mira`, `char-thorn` |
| `vision-crypt` | Patch on Goblin Ambush only (Fog all from `fog-ambush`): reveal rect `[0, 6, 3, 11]` (snapped); Explored polygon `[8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5]` (free); darkness circle `[13, 9, 3]` (Goblin 2 inside); one `scn.addWalls` freeform wall `[4.5, 3.25, 6.75, 5.5]`; `fog.setExplored` on. No token, sheet or other scene touched | `fog-ambush`, `scn-walls`, `goblin-2` |

- **Bundle `vision`** = `scenes` + `goblin-2` + `encounter-1` + `fog-ambush` + `scn-walls` + `vision-senses` + `vision-crypt`. Positions: Mira (2, 7), Thorn (2, 9), Goblin (12, 6), Goblin 2 (12, 8), Lurker (17, 11); walls x = 8, d1 (8, 5)–(8, 6) closed, d2 locked. `session-sim` unchanged.
- **Composition *(seams S10)*:** both units are patches that touch only V-owned fields (`statBlock.senses`; Goblin Ambush's fog row and one wall), so they compose with R's `trg-thorn`, C's `cmp-*`, P's `handouts-*`, D's `dicex-*` in the orchestrator's `session-sim-7`. Test: `vision` loaded after `trg-thorn` (and the reverse) leaves Thorn's Rogue 5 / Sneak Attack and senses both intact. Sprint-2 bundles `fog`, `fog-scn`, `scene-tools` pass unchanged.
- **Leak strings / properties** (each player's frames incl. acks and signals): ids, names, `col`/`row` of tokens that player can't see; "Goblin Lurker"; `seenBy`, `doorSeen`, `fogged`, `walls` keys; another player's `vision` / `fog-explored` id; Thorn's `senses` in `player-1` frames and Mira's in `player-2`'s; while blind, any fog subject but own tokens.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-FOG-26 shapes` (zod, crossing, zero area, caps); `FR-FOG-01 static state` (painter order, boundary, base mask + shapes, legacy forms = sprint-2 cells for every `fog-ambush-partial` cell); `FR-FOG-33 sightPolygon` golden cases (empty room, wall shadow, ray through a wall endpoint, collinear wall, door open / closed, darkness occluder vs see-through, r = 0, freeform decimals) + **property test** vs brute-force ray sampling + **benchmark** (150 / 2,000 walls); `FR-FOG-34` samples (Large token one cell seen, door both sides); `FR-FOG-36 blind` matrix (one / two sources, see-through); `FR-FOG-37` memory union + cap; `FR-FOG-38` cache keys (each input invalidates). Client: gestures per shape × snap / Ctrl, circle radius label, darkness select / move / remove, View as; render (painter, darkvision ring, darkness both ways, blind chip) | In-code |
| Integration | Each command: rows + undo + log + one event, IDs from `ctx`, rollback → nothing. **Per-player leak tests** (`player-1`, `player-2`, snapshot + every frame, then again after `resync` at each state): Mira → (7, 5) with d1 open (P1 gets Goblin, P2 nothing); back → P1 delete, memory kept; Thorn into darkness with see-through (P2 gets Goblin 2) and with it switched off (P2 blind: deletes all but Thorn); DM wall added across Mira's sight (P1 delete); door closed; Fog all / Reveal all; `map.drag` of Goblin per player; DM ephemeral template routing. **Convergence** per player (FR-SYNC-20) with the identical-upsert drop. `FR-FOG-14`: Goblin seen by P1 only → combatant reaches both; seen by nobody → hidden; Lurker never. `FR-FOG-40 migration`: rows with `seenBy = null` from the `fog` bundle → backfill → per-player snapshots byte-equal the pre-backfill sprint-2 filter; rerun no-op. Re-derive triggers table (one test per row). Crash hooks → digest; restart → identical per-player snapshots. `FR-FOG-43`: DM snapshot has no `vision` / `fog-explored`; `sync.loadScene {viewAs: player-1}` returns P1's rows only (none of P2's), `viewAs` of another campaign's player → `not_found`, a move committed before the read is in the ack and a later one follows as an event; convergence on the loaded pair; DM resync → reload. **CON-44:** heavy harness + v2 rows under the picked option (§12): no `view-as` rows in the DM snapshot; the View-as ack at caps ≤ 16 KiB | `vision`, `fog` |
| E2E (thin) | `// e2e-bundle: vision`: `player-1` moves Mira to (7, 5) after the DM opens d1 → Goblin appears for P1 only (`player-2` context: absent); reload P1 → still there; DM places darkness over Goblin → gone for P1 | `vision` |

**Browser walkthrough.** `PP_TEST_MODE=1`; `bun run build`, `fixtures:reset-load vision --profile verify`, `start --profile verify` (Herdr pane). **A** DM, **B** `player-1` (Mira), **C** `player-2` (Thorn). Evidence and teardown per AGENTS §9.6; WS frames of B and C logged.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, Show to players | B, C open links | A: translucent fog, Explored corridor lighter, hatched darkness, freeform wall, all tokens; Fog badge on Goblin, Goblin 2, Lurker. B: 30 ft circle around Mira cut at x = 8, nook clear, corridor dim and empty. C: 60 ft dimmed darkvision area cut at x = 8 |
| 2 | Fog tool: Fog + Polygon, Ctrl-click 4 free vertices over (15.3, 10.2)…; Darkness + Circle, Ctrl-free radius at (16.4, 3.7) | — | Draft vertices off-grid (`free`); label "≈ 11 ft"; shapes appear for B, C ≤ 1 s; Undo removes the polygon (depth −1), not the darkness |
| 3 | Structure → Wall, hold Ctrl: polyline (9.3, 1.2) → (11.7, 3.9) → (10.2, 5.6), double-click | — | Off-grid wall for A; B, C frames: no `walls` key |
| 4 | Open d1 | B drags Mira → (7, 5) | B: Goblin appears in Mira's sight through the doorway; C: no Goblin frame. Corridor cells east of the door turn Explored for B only |
| 5 | — | B drags Mira back → (2, 7) | B: Goblin `delete`; the cells Mira saw stay dim (memory); C unchanged |
| 6 | Drag Goblin across the x = 8 wall | B drags Mira slowly toward (10, 7), then toward (6, 3), drops | A: crossed segment red + "through wall", drop accepted. B: a red wall piece at x = 8 before the drop, then across the freeform wall; drop refused, Toast, cell flash (SCN) |
| 7 | Drag Thorn into the darkness (11, 9) | — | C: darkness as a darker see-through tint, Goblin 2 visible inside; B: nothing new |
| 8 | Thorn's sheet: switch "Sees through magical darkness" off; then on again | — | Off: C's screen dark, grid + Thorn only, chip "Magical darkness — you can't see"; C frames: one `CharacterSheetEdited` with deletes for every other token, prop and door (Mira too). On: view restored in one event. B unaffected throughout |
| 9 | Start "Ambush at the Ford" | — | B, C Initiative: Goblin 2 (seen by C) and party; Goblin (seen by nobody now), Lurker absent; Wolf, Elite hidden |
| 10 | View as Player 1; Remember explored off, then on; Forget explored…; View as Player 2 | — | A's frames: one `sync.loadScene {viewAs}` ack per pick, with only that player's `vision` / `fog-explored`; A sees B's render overlaid; B's memory hidden then back; after Forget, B's corridor fogged again; then C's render |
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
| [campaign-management](campaign-management.md) | A player create / delete hook line (OQ-FOG-39) | open question |
| [play-shell](play-shell.md) | Nothing: the dark screen covers the canvas only (OQ-FOG-40) | open question |
| [entities](entities.md), compendium (track C) | `senses` in the creature core zod (V0); C's adapter fills `darkvisionFt` from SRD "darkvision N ft" (C1 after V0) | settled, seams S6 |
| [fixtures-adapters](fixtures-adapters.md) | Units `vision-senses`, `vision-crypt`, bundle `vision` | at merge |

**Shared changes** (builders report `shared change needed:` per AGENTS §9.9)

| Path | Change | Slice |
|---|---|---|
| ★ `src/server/db/` (schema lock) | `scene_fog` columns, `scene_fog_edit.prevShapes`, `fog_explored`, `seen_by` on `token` / `prop` / `aoe_template`, `scene_structure.door_seen` | V0 |
| ★ `src/server/ws/`, `src/shared/protocol/`, common store (ws lock; V0 first, then `fix/lazy-records`, nobody else, seams S3) | identical-upsert drop; `SignalAudience` player lists; derived record types; `fog` flagged `dmWindow`; `dmWindow: "view-as"` + `sync.loadScene {viewAs}` + the DM client's loaded pair (FR-FOG-43); leak / convergence helpers per player (incl. the View-as ack); CON-44 test re-baselined | V0 |
| `src/server/features/scenes-map/` (MAP lock) | `visibility-hooks.ts` members + `rederive` call sites in every token write, `drag.ts` per-player audience, token wire without `seenBy`, `fogged` DM-only, `map.checkMove` + guard hints ([ADR-0040](../architecture/adr/0040-token-move-guards.md)) | V0 |
| `src/shared/entities/schemas.ts`, entities `definition-hooks.ts` | `senses` zod; fog's hook line | V0 / V2 |
| `src/shared/events/fog-of-war.ts` | darkness / explored events | V0 |
| Record-type registry, feature list, `fixtures/bundles/index.ts` | `fog-explored`, `vision`; bundle `vision` | V0, V2 |
| campaign-management player commands | re-derive line (OQ-FOG-39) | V2 |
| Docs | data model, protocol (§5 `fog`, §35 registries, CON-44 row), glossary (OQ-FOG-42) | consolidation |

**Build slices** (after DM gate 1; order per seams S3). Order: **V0 → V1 → (V4 ∥ V2) → V3**, with **V5** any time after V0; V6 only if OQ-FOG-25 ≠ B, and then before R7 (combat lock). Every intermediate `main` is neutral for players: no senses are set outside fixtures until V5.

- **Schema:** V0 is the first sprint-3 schema core (V0 → R0 → P core → C1 → D style).
- **ws / protocol / common store:** V0, then `fix/lazy-records` (P's ADR); V needs nothing from it.
- **Canvas** (MapCanvas, layers, tools): V1 → V4 → V3, one at a time; no new Konva layer.
- **Character-sheet folder:** V5 first (V5 → R3 → R6 → D4 → P4 / C4).

| # | Branch | Contents | Shared files | Players see |
|---|---|---|---|---|
| V0 | `fix/vision-core` (L; schema + ws + MAP locks) | Schema + migration backfill, `@shared/fog-of-war/{shapes,vision}.ts` (sweep + benchmark), registry members + call sites (no-op lines), ws changes incl. the `view-as` window and `sync.loadScene {viewAs}` (FR-FOG-43), `senses` zod, record types registered empty, CON-44 | ★ db, ★ ws / protocol, scenes-map, entities schemas, events | nothing new |
| V1 | `build/fog-shapes` (M, canvas lock 1st) | Shape / darkness / explored intents, undo over shapes, static derive with darkness, tools (Ctrl, circle, darkness edit), DM + player static render | own folders; `canvas-tools.ts` line exists | DM's freeform fog + darkness (static) |
| V4 | `build/walls-freeform` (M, SCN; canvas lock 2nd) | Decimal segments, Ctrl drawing + magnet, scaled guard, occluder export, `map.checkMove` guard hint, red highlight (player, DM) | scene-tools folders (the wall guard's hint line; `map.checkMove` itself lands in V0) | red wall highlight |
| V5 | `build/sheet-senses` (S, CHARX; sheet lock 1st) | Senses UI, `char.edit` key, `vision-senses` | character-sheet folder lock | senses on own sheet |
| V2 | `build/vision-server` (L) | Sight + cache + re-derive triggers + explored writes + `vision` records + per-player drag audience + definition / player hook lines + leak tests + `vision-crypt`, bundle `vision` | entities hook line, campaign-management line | records by vision |
| V3 | `build/vision-client` (M, canvas lock 3rd) | Player vision render, darkvision ring, darkness overlay, blind screen, View as (client loaded pair, FR-FOG-43), e2e, walkthrough | own folders | vision |
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
| OQ-FOG-31 | DM "View as player" | **A in** (no snapshot cost under OQ-FOG-30 B; 1.3–1.8 KB per pick, 12.7 KB at caps; DM checks the fog before play) · B out (Fog badge only; saves only the client code) | no · DM gate 1 | — |
| OQ-FOG-43 | **Seam (S1):** how does the DM get other players' `vision` / `fog-explored` for View as? | **Settled by seams S1:** on demand, not in the snapshot; a scene-scope load (lazy record types are campaign / global only): `dmWindow: "view-as"` + `sync.loadScene {sceneId, viewAs}`, one player at a time (FR-FOG-43). Measured: saves 10,440 B typical, ≈ 33.8 KB at caps | no · settled | live-sync, ADR-0041 |
| OQ-FOG-32 | Fog shapes and darkness geometry to players | **A the active scene's whole `fog` row to every player; drawn only where seen** (accepted leak: a darkness blob deep in fog is in the frame, not on screen) · B per-player filtered darkness (`seenBy` per shape, more derive work) | no · DM gate 1 | — |
| OQ-FOG-33 | "Explored" as a DM drawing mode | **A yes: a known-but-unseen area (map shown, contents hidden)** · B memory only | no · DM gate 1 | — |
| OQ-FOG-35 | Numbers | **≤ 100 fog + 20 darkness shapes, row ≤ 16 KiB, 64 vertices, circle ≤ 60 cells, Explored default off, senses default 0, cache 256, move ≤ 30 ms at caps** | no · DM gate 1 | — |
| OQ-FOG-36 | **scenes-map:** registry members `derive → {fogged, seenBy}`, `hides(…, viewer)`, `dragAudience`, `rederive`; `seenBy` column; `fogged` DM-only; `map.checkMove` with guard hints | **Accept as FR-FOG-24 / FR-SCN-38** (one MAP-lock change in V0) · ask scenes-map for another shape | yes | scenes-map, ADR-0039, ADR-0040 |
| OQ-FOG-37 | **live-sync:** FR-SYNC-19 drops `visible → visible` upserts with identical wire data per connection; FR-SYNC-28 audience may be a player list; derived record types; `fog` gets `dmWindow` | **Accept** (V owns the ws lock) · per-connection last-sent cache instead of the before / after compare (memory per connection). Seams: V0 holds ws first, then `fix/lazy-records` (S3); the drop supersedes backlog BL-09 (S11); FR-FOG-43 adds the `view-as` window (S1) | yes | live-sync, ADR-0033, ADR-0041 |
| OQ-FOG-38 | **combat-tracker / combat-extras:** `tokenHiddenForPlayers` = hidden or seen by nobody (OQ-FOG-25 B) | **Accept: note in both specs, no FR change** · per OQ-FOG-25 A: per-player combat copies (V6, before R7: seams S3) | yes | combat-tracker, combat-extras |
| OQ-FOG-39 | **campaign-management:** a new player must get `seenBy` membership on every scene | **A a player-created / deleted hook line calling fog's re-derive** · B fog re-derives lazily on that player's first hello (a snapshot-time write: rejected) | no · DM gate 1 | campaign-management |
| OQ-FOG-40 | **play-shell:** does the dark screen cover windows? | **A canvas only; sheet, Initiative, log stay usable** · B dim the whole shell | no · DM gate 1 | play-shell |
| OQ-FOG-41 | **entities / compendium:** imported SRD monsters' darkvision | **Settled by seams S6:** `senses` lives in the creature core zod (V0); C's adapter fills `darkvisionFt` from SRD "darkvision N ft" (C1 runs after V0); blindsight / truesight stay text; a monster's see-through defaults false (the DM sets Devil's Sight on a custom definition's sheet). Matters only for player-owned tokens | no · settled | entities, compendium |
| OQ-FOG-42 | Glossary | **Settled by seams S9:** integrator adds after the gate; **Reveal** stays fog's word (P uses Share). Terms: **Fog** → "Areas of a scene hidden from players: freeform shapes over a base mask; pierced by vision"; add **Explored**, **Magical darkness**, **Vision source**, **Sight**, **Darkvision**, **Sees through magical darkness**, **Blind (dark screen)**, **Seen by** (server copy), **View as**; **Fog-hidden** → per player | no · integrator | glossary |
| OQ-FOG-17 | Fog colours | Placeholder tokens §7 until theme-system | no · integrator | visual-direction |

OQ-FOG-34 is retired (merged into SCN's OQ-SCN-22 while drafting).

## 16. Out of scope

- Dynamic lighting, light sources, colour, shadows; vision for unowned tokens; darkness attached to tokens; one-way / terrain walls; fogged map images (OQ-FOG-09).
- Layers, walls, doors, props, AoE templates themselves → [scene-tools](scene-tools.md); senses on the sheet → [character-sheet-full](character-sheet-full.md).
