---
title: Fog of war
prefix: FOG
status: in-review
owner: spec-fog-of-war
phase: post-mvp-2
---

# Fog of war

## 1. Summary

- The DM covers a scene with **fog** and reveals or hides areas with a **rectangle** or **polygon** tool, plus **Reveal all** / **Fog all** and **Undo**. Sprint 2 phase 2, track F ([sprint-2](../agents/sprint-2.md#track-f-fog-of-war--new-spec-fog-of-war-prefix-fog)); first post-MVP item since [ADR-0014](../architecture/adr/0014-mvp-scope.md).
- Fog is a **cell mask** on the scene's grid, run-length encoded (one small `fog` record per scene). Players see it opaque, the DM translucent.
- Whatever fog covers is **filtered server-side**: a token, prop or DM-placed AoE template wholly under fog never reaches a player socket. A server-written `fogged` copy on each record + a scenes-map **visibility hook registry** keep visibility fns pure ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md)); proposed ADR [fog visibility](../architecture/adr/proposed-fog-visibility.md).

## 2. Scope

- Per scene, DM only: rectangle and polygon tools in **reveal** or **hide** mode; Reveal all; Fog all; Undo (per scene, LIFO). No brush.
- **New scenes start fully fogged** (carried pick, [OQ-FOG-02](#15-open-questions)); scenes that exist before this build stay clear.
- Live: a reveal reaches players ≤ 1 s, one transaction, one event. Fog and its undo stack survive reload, reconnect and a hard kill.
- Server-side hiding of **fog subjects**: tokens (scenes-map), props and AoE templates ([scene-tools](scene-tools.md), prefix SCN). Tokens with an owner stay visible *(proposed: to every player, [OQ-FOG-03](#15-open-questions))*.
- Seams: scenes-map token visibility, drag preview routing, camera fit; scene-tools layer stack and records; combat copies of "hidden" ([OQ-FOG-07](#15-open-questions)).

## 3. Goals

- **Zero leakage:** no player frame (snapshot, event, signal) carries the id, name, position, image or any field of a fog-hidden record, before or after a reconnect.
- A reveal of a large polygon over many tokens = one transaction, one `FogEdited`, one frame per connection, ≤ 1 s to players.
- Fits the DM snapshot ceiling (CON-44) with a stated option ([OQ-FOG-04](#15-open-questions)).

## 4. Non-goals

- Vision, dynamic lighting, line of sight ([ADR-0007](../architecture/adr/0007-product-scope.md)); fog by walls; per-player exploration memory ("seen before" grey fog).
- Brush or freehand fog; smooth (non-grid) fog edges ([OQ-FOG-05](#15-open-questions)); redo.
- Hiding map **pixels**: the map image still reaches players whole ([OQ-FOG-09](#15-open-questions)).
- Player fog tools; fog on non-grid maps (every scene has a grid, [FR-MAP-10](scenes-map.md#6-functional-requirements)).

## 5. User stories

**DM**
- As the DM, I want a new battlemap to start black for players and to reveal the first room with one drag, so that the dungeon unfolds as they explore.
- As the DM, I want goblins I placed in an unrevealed room to stay off players' screens without hiding each one, and to appear the moment I reveal the room or walk them out.
- As the DM, I want to undo a reveal I drew too big, so that a slip doesn't spoil the next room.

**Player**
- As a player, I want to see only the revealed map and my party's tokens, and to keep seeing my own token when it walks into the dark.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| **Model** | | |
| FR-FOG-01 | **Fog cells** = the scene's grid cells (col, row as token positions, [FR-MAP-14](scenes-map.md#6-functional-requirements)); each is fogged or clear. A scene's `fog` row holds `fill` (`fog` \| `clear`), a **box** `[col0, row0, cols, rows]` and `runs` (FR-FOG-04). A cell inside the box takes its run value; outside, `fill`. **No row = every cell clear** (scenes created before this build). | |
| FR-FOG-02 | **New scene fully fogged** *(carried pick, OQ-FOG-02)*: `map.createScene` writes a row `{fill: fog, runs: ""}` in its transaction through scenes-map's scene lifecycle registry `sceneHooks` (SCN's design, created by `fix/fog-core`; settled S3). `map.duplicateScene` (same registry) copies the source's row (no undo stack); a source without a row → copy without a row. | |
| FR-FOG-03 | **Box** = every cell overlapping the map rectangle at the scene's current grid: `col0 = floor(−offsetX / cellSize)`, `cols = ceil((mapWidth − offsetX) / cellSize) − col0`; rows alike (≤ 513 × 513). `map.setGrid` / `map.setSceneMap` never touch fog: cells keep their index, so fog moves with the grid like tokens. Each fog edit **re-bases** the mask to the current box (new cells take `fill`, cells leaving it take nothing): no cell value changes, so no `fogged` copy changes. | |
| FR-FOG-04 | **Encoding** `runs`: row-major over the box, alternating run lengths starting with **fogged**, base 36, comma-separated (`"1k,5,7"`); `""` = every box cell is `fill`. Sum ≠ `cols × rows` on read → treated as fully fogged + `error` log (fail closed). ≤ **2,000 runs** per scene (≤ 10 KB) *(proposed, OQ-FOG-19)*; an edit that would exceed → `conflict` "Fog too detailed — reveal or hide larger areas", nothing written. Pure codec in `@shared/fog-of-war/mask.ts`. | |
| **Editing** (DM only; all WS intents, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D) | | |
| FR-FOG-05 | `fog.edit {sceneId, op: reveal \| hide, shape}`. **Rectangle** `{kind: rect, c0, r0, c1, r1}`: cells c0…c1 × r0…r1 inclusive (normalised). **Polygon** `{kind: polygon, points [[i, j], …]}`: 3–64 vertices on **grid corners** (integers; corner (i, j) = map point `(offsetX + i·cellSize, offsetY + j·cellSize)`); edges that cross, or zero area → `invalid`. A cell is affected iff its **centre** `(c + ½, r + ½)` lies inside or on the boundary (scanline, even-odd). Cells outside the box are ignored. No cell changes → no event, no undo entry, `ack {editId: null}`. | Diagonals are stepped (OQ-FOG-05) |
| FR-FOG-06 | `fog.setAll {sceneId, fogged}`: **Fog all** (`true`) → `{fill: fog, runs: ""}`; **Reveal all** (`false`) → `{fill: clear, runs: ""}`; also writes a row for a scene that had none. Same value already → no-op. | |
| FR-FOG-07 | **Undo** `fog.undo {sceneId, expectedEditId}`: restores the mask from before the scene's latest edit and drops that entry; strict LIFO; ≤ **20** entries per scene, the oldest dropped in the edit's transaction *(proposed, OQ-FOG-08)*. `expectedEditId` ≠ latest → `conflict` "Fog changed — check and undo again"; empty stack → `conflict`. No redo. Persisted, so it survives reload and restart. Fog undo is its own stack, not [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) undo (proposed ADR). Scene-tools undoes with client-side inverse intents instead: different by design (fog is one mask, SCN edits are many records; settled S7). | Two DM tabs: guard like FR-CBT-35 |
| FR-FOG-08 | Every fog command (edit, setAll, undo) is one transaction: `fog` row + undo row(s) + every **fog subject** on the scene whose `fogged` changes (FR-FOG-10) + rows from token-changed hooks (FR-FOG-13) + one event-log entry; then one domain event (`FogEdited` / `FogUndone`, §9). IDs and time from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). | |
| FR-FOG-09 | Fog intents work on any scene, active or not (prep); disabled in the UI while not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)). A player sending any `fog.*` → `forbidden`. | |
| **What fog hides** | | |
| FR-FOG-10 | **`fogged` copy**: a fog subject's `fogged = true` iff **every** cell of its footprint is fogged (one clear cell shows it; OQ-FOG-14). Footprint: token = FR-MAP-14 square; prop, AoE template = the cells scene-tools declares (OQ-FOG-12). Server-written only (never in an intent schema: sending it → `invalid`). Written in the same transaction by: fog commands (FR-FOG-08); and every command that writes a subject's scene, cell or size, via `derive` (FR-FOG-24): `map.placeToken`, `placeTokenIn` ([FR-MAP-48](scenes-map.md#6-functional-requirements)), `map.duplicateToken`, `map.moveToken`, `map.duplicateScene` (copies recomputed against the copy's fog), the definition-changed size refresh ([FR-MAP-20](scenes-map.md#6-functional-requirements)); scene-tools' prop / template writes likewise. | ADR-0024 copy pattern |
| FR-FOG-11 | **Fog-hidden** (pure, reads only the record; the same for every player): `fogged` **and** not exempt. Exempt: a token with `ownerPlayerId` *(proposed: visible to every player, OQ-FOG-03)*; an AoE template placed by a player (OQ-FOG-12). Not exempt: ownerless tokens, props, DM-placed templates. The `hidden` flag ([FR-MAP-19](scenes-map.md#6-functional-requirements)) is independent: hidden **or** fog-hidden → `hidden` for players. Exported as `fogHidden(type, record)` from `@shared/fog-of-war`. | |
| FR-FOG-12 | **Visibility through the hook registry** (FR-FOG-24): scenes-map's token fn and scene-tools' fns return `hidden` when any hook's `hides(type, record)` is true; DM always `full`. Snapshot and events share the fn, so covering = `delete`, revealing = `upsert` ([FR-SYNC-19](live-sync.md#6-functional-requirements)); a token **walking out** of fog arrives as an upsert in `TokenMoved`, one walking in as a `delete`. **`map.moveToken` order** (settled S4): SCN's `moveGuards` (walls / doors) first, may refuse → `derive` computes `fogged` and the row is written, same transaction → token-changed hooks. Players' token shape unchanged otherwise ([FR-MAP-26](scenes-map.md#6-functional-requirements)); wire `fogged` sent only when true. | |
| FR-FOG-13 | **Token-changed hooks on fog flips:** a fog command runs scenes-map's token-changed hooks ([FR-MAP-30](scenes-map.md#6-functional-requirements), [ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) `(env, before, after)` for every token whose fog-hidden value flips; their rows join the event's `changes`; a hook reject rolls the command back. Moves already run them ([ADR-0031](../architecture/adr/0031-token-move-hooks.md)) with `after.fogged` derived. | |
| FR-FOG-14 | **Combat** *(proposed, OQ-FOG-07)*: combat's copies of a token's hidden flag use `tokenHiddenForPlayers(token)` = `hidden` or fog-hidden (scenes-map export): Start binding ([FR-CBT-08](combat-tracker.md#6-functional-requirements)), the token hook ([FR-CBT-09](combat-tracker.md#6-functional-requirements), ranks, player turn), CBTX's effect copy and link ([FR-CBTX-13, -45](combat-extras.md#6-functional-requirements)). So a fog-hidden monster is a hidden combatant: absent from the player Initiative, public outcome lines DM-only ([FR-CBT-36](combat-tracker.md#6-functional-requirements)); revealing its cells shows map token and Initiative row in one event. Targeting stays DM-only (#134); SCN's "Select creatures inside" (DM) includes fog-hidden tokens (S8). | Combat-tracker, combat-extras amend |
| FR-FOG-15 | **Drag preview** ([FR-MAP-41](scenes-map.md#6-functional-requirements), [ADR-0033](../architecture/adr/0033-signal-audience.md)): `map.drag`'s audience routes **`"dm"`** if the token is hidden for players (FR-FOG-14 fn) **or** the previewed footprint (cell under the frame's top-left, rounded as FR-MAP-15) is wholly fogged and the token is not exempt. So players see a monster glide up to the fog edge and vanish on the drop; a fog-hidden token's drag never reaches them. Reads the fog row through the hook's read-only access (FR-SYNC-28). **Ephemeral templates** (settled S5): SCN's `scn.template` signal audience is `"dm"` when a **DM-placed** template's cells are wholly fogged (`deriveSceneObject(read, …)`), else as SCN; player-placed ones are never fog-hidden. | |
| FR-FOG-16 | **Camera fit** ([FR-MAP-44/46](scenes-map.md#6-functional-requirements)): no change. A player's content box uses its store, so fog-hidden tokens never count; the DM's includes them (OQ-FOG-13). | |
| **Client** | | |
| FR-FOG-17 | **Fog tool** (DM tool rail, after Select / Ruler / Ping): a floating fog bar beside the rail (open while the tool is active; not a Popover, so drawing on the canvas keeps it open) with **Reveal \| Hide** and **Rectangle \| Polygon** ToggleGroups (defaults Reveal, Rectangle), **Reveal all**, **Fog all…** (AlertDialog "Fog the whole scene? Players keep only their own tokens." Confirm / Cancel), **Undo** (Tooltip "Undo: ‹reveal \| hide› ‹rectangle \| polygon \| all›"; disabled with an empty stack). Works on the viewed scene (FR-MAP-08). While active: tokens not draggable; the token menu still opens; **Space + left-drag pans** (shared with scene-tools' drawing tools, OQ-FOG-11). | |
| FR-FOG-18 | **Rectangle:** left-drag from a cell to a cell; the draft (cells snapped, outline in the accent, translucent fill) follows; release sends `fog.edit`. Pointer moved < 4 px = that one cell. Esc cancels (no send). The draft stays until the event or reject arrives; reject → Toast. | |
| FR-FOG-19 | **Polygon:** each click adds a vertex at the nearest grid corner (a click < 4 px from the last vertex is ignored); a vertex whose edge would cross another is refused (Tooltip "Edges can't cross"); **Enter**, a double-click or a click on the first vertex closes (≥ 3 vertices) and sends; **Backspace** drops the last vertex; **Esc** cancels; 64 vertices max. Plain drag still pans. Keys via `useBaseKeyDown` ([FR-SHELL-13](play-shell.md#6-functional-requirements)). | |
| FR-FOG-20 | **DM render:** fogged cells as one translucent shape (`fog.dm`, ≈ 50 %) on the `fog` canvas layer (`canvas-layers.ts`, order 30; settled S6): map 0 < grid 10 < scn-props 20 < scn-templates 24 < scn-structure 26 < **fog 30** < tokens 40 < labels 45 < scn-edit 48 < pointers 50. Fog-hidden tokens get a DM-only token overlay badge "Fog" (`fog-token-fogged`, [FR-MAP-34](scenes-map.md#6-functional-requirements) registry; tokens with `hidden` keep their own styling). | |
| FR-FOG-21 | **Player render:** fogged cells opaque (`fog.player`) on the same layer, under tokens and labels, so own and party tokens in fog stay visible with their labels. Drawn from the same snapshot as the scene, so the map never shows unfogged first. No fog row → no fog drawn. | |
| FR-FOG-22 | A gesture in progress is dropped (unsent) when the client leaves `live`, the viewed scene changes or another tool is picked. | Like FR-MAP-28 |
| **Lifecycle** | | |
| FR-FOG-23 | Scene delete cascades its `fog` row and undo stack (FK). Activation: players get the new scene's `fog` in the resync snapshot (scene gate, [FR-SYNC-09](live-sync.md#6-functional-requirements)). | |
| FR-FOG-24 | **Scene visibility hook registry** (scenes-map's, append-only, created by `fix/fog-core`; proposed ADR): `src/server/features/scenes-map/visibility-hooks.ts` exports `sceneVisibilityHooks` of `{name, derive?, hides?, dragToDm?}` (§9); scene create / duplicate go through `sceneHooks` (S3). scenes-map exports `deriveSceneObject(read, obj)`, `tokenHiddenForPlayers(token)`, `runTokenChangedHooks(env, before, after)`. No hook registered → no behaviour change (`fogged` stays false). | Shared change |
| FR-FOG-25 | **Fixture ripple:** new scenes start fogged, so the `town`, `battlemap` and `scenes-extras` units ([scenes-map §13](scenes-map.md#13-test-plan)) gain a last step `fog.setAll {fogged: false}` per scene they create; every existing bundle then behaves as today for players. Digests, entry counts and CON-44 baselines re-run (OQ-FOG-18). | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, the map is the hero; lucide `cloud-fog` for the tool. Fog colours are placeholder semantic tokens `fog.dm` / `fog.player` until [theme-system](post-mvp/theme-system.md) names them (OQ-FOG-17).

- **Screens:** no window. Tool-rail button + floating fog bar + canvas layer + one token overlay badge.
- **States:** empty = no fog row (no fog drawn) or fully fogged (players: black map, own tokens). Loading = scene loading ([FR-MAP-07](scenes-map.md#6-functional-requirements)). Error = Toast on reject, draft removed. Disconnected = fog bar disabled, gestures dropped (FR-FOG-22), fog stays drawn.
- **DM view:** all tokens; fog translucent; "Fog" badge on fog-hidden tokens; draft shape while drawing; Undo Tooltip names the step; works on scenes not shown to players.
- **Player view:** opaque fog; only records not fog-hidden; own and party tokens drawn over fog. No fog controls.
- **Test IDs:** `fog-tool` (rail), `fog-bar`, `fog-mode-reveal`, `fog-mode-hide`, `fog-shape-rect`, `fog-shape-polygon`, `fog-reveal-all`, `fog-fog-all`, `fog-fog-all-confirm`, `fog-undo` (attr `data-depth`). Konva: layer `fog-layer`; shape `fog-mask` (attrs `fill`, `fogged-cells` = fogged cells in the box); `fog-draft`, `fog-draft-vertex` (`id` = index); overlay badge `fog-token-fogged` (`id` = token id).

## 8. Data model

No JSON leaf fields. Rows per campaign ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)); timestamps from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Fog *(new, `scene_fog`)* | sceneId (PK), campaignId | ID → Scene (cascade), ID → Campaign | One row per scene; wire `id` = `sceneId` |
| | fill; col0, row0, cols, rows; runs; updatedAt | `fog` \| `clear`; int ×4; text ≤ 10 KB; timestamp | FR-FOG-01–04 |
| Fog edit *(new, `scene_fog_edit`, undo stack)* | id, campaignId, sceneId, seq | ID, ID, ID → Scene (cascade), int | ≤ 20 per scene (FR-FOG-07) |
| | kind; prevFill, prevCol0, prevRow0, prevCols, prevRows, prevRuns; createdAt | `reveal-rect` \| `reveal-polygon` \| `hide-rect` \| `hide-polygon` \| `reveal-all` \| `fog-all`; mask before the edit; timestamp | Undo restores `prev*` |
| Token *(scenes-map's table)* | **fogged** | bool, default false | Server copy (FR-FOG-10); wire only when true |
| Prop, AoE template *(scene-tools' tables)* | **fogged** | bool, default false | Same; SCN creates its tables with `fogged` in `fix/scn-core`, after `fix/fog-core` (settled S2) |

- **Relations:** Scene 1—0..1 Fog; Scene 1—* Fog edit. Fog subjects → Scene.
- **Derived:** box (FR-FOG-03); mask ↔ runs (codec); `fogged` per subject; fog-hidden (FR-FOG-11); undo depth and latest edit (DM wire). Client only: draft shape, fog bar state.
- **Persisted runtime state:** fog rows, undo stacks, `fogged` copies, all committed together.

## 9. API & events

**REST:** none (canvas actions are WS, ADR-0021 D).

**WS intents** (DM only)

| Intent | Who | Validation / ownership |
|---|---|---|
| `fog.edit {sceneId, op, shape}` → `{editId \| null}` | DM | Scene in `ctx.campaignId` (`not_found`); zod: ints, \|value\| ≤ 1,024, 3–64 vertices; crossing edges / zero area → `invalid`; runs cap → `conflict` |
| `fog.setAll {sceneId, fogged}` → `{editId \| null}` | DM | Scene in campaign |
| `fog.undo {sceneId, expectedEditId}` | DM | Latest edit = `expectedEditId`, else `conflict` |

**Record types**

| Type | Scope | DM wire | Player visibility | Snapshot |
|---|---|---|---|---|
| `fog` *(new)* | scene, `sceneOf = id` | `{id, campaignId, fill, box, runs, undo: {n, editId, kind} \| null}` | **redacted** `{id, fill, box, runs}` | DM: every scene's row (or per OQ-FOG-04); player: active scene's |
| `token` (scenes-map) | unchanged | + `fogged` (when true) | `hidden` or fog-hidden → **hidden**; else FR-MAP-26 | unchanged |
| prop, AoE template (scene-tools) | SCN's | + `fogged` | fog-hidden → **hidden**; else SCN's rule | SCN's |

**Visibility per change** (DM always full)

| Change | Owning player | Other players |
|---|---|---|
| `fog` upsert (active scene) | upsert (redacted) | upsert (redacted) |
| `fog` upsert (other scene) | nothing (scene gate) | nothing |
| Token covered by fog (ownerless) | — | `delete` |
| Token revealed (ownerless) | — | `upsert` (image ID reaches them now, [FR-ASSET-12](assets-pipeline.md#6-functional-requirements)) |
| Owned token under fog | `upsert`, `fogged: true` | `upsert` *(OQ-FOG-03 pick; option B: hidden)* |
| Prop / DM template covered / revealed | `delete` / `upsert` | same |
| Player-placed template under fog | SCN's rule | SCN's rule |
| Combatant / effect of a fog-hidden token (OQ-FOG-07) | `delete` (hidden copy) | `delete` |
| `map.drag` of a fog-hidden token or into fog | none (`"dm"`) | none |

**Domain events** (logged; not ADR-0016-undoable; none transient)

| Event | Payload | Changes |
|---|---|---|
| `FogEdited` | `{sceneId, editId, kind, shape?}` (shape ≤ 64 vertices or the rect) | `fog` upsert; every subject whose `fogged` flipped; token-hook rows (combat: `combatant`, `encounter`, `effect`) |
| `FogUndone` | `{sceneId, editId}` | same as `FogEdited` |
| scenes-map `SceneCreated` / `SceneDuplicated` | unchanged | + `fog` upsert (FR-FOG-02) |
| scenes-map token events, `EntityUpdated` | unchanged | `token` rows carry the derived `fogged` |

**Server registry** (FR-FOG-24; shape for the proposed ADR)

| Member | Signature | Runs in | Fog's line |
|---|---|---|---|
| `derive?` | `(read, obj {type, sceneId, cells: {col, row, w, h} \| [c, r][]}) → {fogged?}`; reads only (the command's tx, or a signal audience's read access) | the writing command's transaction, before the row is written; SCN's `scn.template` audience | `{fogged: every cell fogged}` |
| `hides?` | `(type, record) → boolean`; record only, same for every player | the type's visibility fn | `fogHidden(type, record)` |
| `dragToDm?` | `(read, token, at {col, row}) → boolean` | `map.drag` audience | FR-FOG-15 |

Scene create / duplicate: fog registers a line in scenes-map's `sceneHooks` (SCN's lifecycle registry, created by `fix/fog-core`; S3): create → fully fogged row, duplicate → copy of the source's row. Delete needs no line (FK cascade, FR-FOG-23).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Edit / reveal all / fog all / undo fog | ✓ any scene | ✗ | Default-DM intents; scene in `ctx.campaignId` |
| See fog | translucent, every scene | opaque, active scene | `fog` record + scene gate |
| See fog-hidden records | ✓ | ✗ (except exempt: own / party tokens, own templates) | Visibility fn + hooks (FR-FOG-12) |
| Move own token into / out of fog | — | ✓ (as FR-MAP-21) | Unchanged; `fogged` derived |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** stale view + banner; reconnect snapshot = current fog + only visible records (tokens revealed meanwhile appear, covered ones are absent). Previews of fog-hidden drags never reached them.
- **DM disconnect / reconnect:** fog bar disabled, gesture dropped; players unaffected. Undo stack is server-side, so another DM tab or a reload continues it.
- **Server crash mid-action:** a fog command is one transaction: crash before commit → nothing (no mask, undo row or `fogged` change); after → all in the snapshot. Test hook `PP_TEST_CRASH fog.edit:before-commit` / `after-commit` ([AGENTS §9.2](../../AGENTS.md#92-env-ports-and-data)); `state:digest` identical across the kill.
- **Concurrent edits:** transactions serialise; each edit applies its shape to the current mask (last commit wins per cell). Two DM tabs undoing: `expectedEditId` → second gets `conflict`. A token move racing a reveal: whichever commits second derives `fogged` against the committed mask. A token dragged while its cells get revealed: preview routing follows the stored state per frame.
- **Grid recalibrated / map replaced:** fog keeps cell indices (moves with tokens); the box re-bases on the next edit; cells off the old box take `fill`.
- **Token partly under fog** (Large, one cell clear) → visible. **Token off the map** → its cells take `fill`.
- **Hidden + fog:** both independent; revealing fog never reveals a hidden token, and vice versa.
- **Owned token in fog:** visible (OQ-FOG-03); a monster beside it stays hidden.
- **Invalid / malicious input:** player `fog.*` → `forbidden`; `fogged` in any intent → `invalid`; oversized polygons fail zod; frame cap 64 KB ([FR-SYNC-12](live-sync.md#6-functional-requirements)); a corrupt `runs` reads as fully fogged (fail closed).
- **Accepted leaks** (OQ-FOG-09): the map image itself (dev tools); token name numbering ("Goblin 4" visible hints at 1–3) and token `seq` gaps, as for hidden tokens today; players see `cause FogEdited` on a cover (they know fog moved, not what was under it); **walls and doors are not fog subjects**, so doors (and SCN's player-visible structure) reach players under fog (settled S5; same reasoning as the map image).

## 12. Performance & bandwidth

- **Edit cost:** scanline raster over the shape's bounding box (≤ 263k cells, O(cells + edges × rows)); re-check ≤ 200 tokens + scene-tools' subjects (O(footprint)); one transaction, one event. Target: commit → player frame < 50 ms locally.
- **Frames:** `fog` row ≈ 150 B + runs (typical battlemap 0.2–1.2 KB, cap 10 KB). A reveal that uncovers 50 tokens: player frame ≈ 1 KB + 50 × 411 B ≈ 21 KB; DM ≈ 1 KB + 50 × 474 B ≈ 25 KB. Fine over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)).
- **Render:** decode runs → one Konva shape of row-run rects (no overlapping alpha), `listening: false`, cached; redrawn only when `fog` changes. **Review check:** Chrome trace, DM pan on Cellar (82 × 56 cells) with a 2,000-run mask: median frame ≤ 20 ms.
- **Snapshot (CON-44, the hard constraint).** Heavy DM today **781,923 B** of **786,432 B** (4,509 B ≈ 4.4 KiB left; effect presets 18,461 B of it). Fog already compacts: run-length cells, `runs: ""` for uniform scenes, no row for old scenes, `fogged` on the wire only when true. Heavy-scenario fog (30 scenes: 2 large partial ≈ 1.25 KB each, 4 battlemaps partial ≈ 350 B, 24 uniform ≈ 150 B; ≈ 60 fogged tokens × 14 B) ≈ **8.3 KB**. Players: active scene's row ≤ 10 KB, typically < 1.5 KB (≈ 276 of 512 KiB).
- **Combined F + B figure** (settled S1, same numbers in [scene-tools](scene-tools.md)): 781.9 KB − 18.5 KB presets + SCN active-scene window ≈ 7.3 KB + fog ≈ 8.3 KB ≈ **779 KB of 786.4 KB, ≈ 7 KB left**. Fog rows stay in the full DM snapshot (compact); SCN's window covers SCN records only. One DM question (OQ-FOG-04): (A) presets on demand + SCN active-scene window (pick); (B) A + a token window (≈ 100 KB free; bigger change); (C) raise the DM ceiling.

| Option | DM heavy with fog | Headroom (also needed by scene-tools) | Cost |
|---|---|---|---|
| (a) fits as is | ≈ 790.3 KB | **none** (≈ 3.8 KB over) | — not viable |
| **(b) effect presets on demand** (fog alone; with SCN's window = the (A) pick above) | ≈ 771.8 KB | ≈ 14.6 KB before SCN; ≈ 7 KB with it | MOD's preset transport becomes a DM / owner REST read (behind one seam already); manager / apply dialog load on open |
| (c) fog per-scene windowing: **rejected** (S1) | ≈ 784.0 KB | ≈ 2.4 KB | New per-connection snapshot rule + DM REST read + loading state; frees too little |
| (d) raise the DM ceiling (e.g. 1 MiB) | ≈ 790.3 KB | ≈ 258 KB | DM decision only. The DM client usually runs on the host (ADR-0003), so the cost is build time and memory, not tunnel bandwidth |

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:` DB, temp asset dir, port 0; walkthrough on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests named after FRs. Setups run as DM.

| Key | Contents | Requires | `session-sim` |
|---|---|---|---|
| `fog-ambush` | Goblin Ambush: `fog.setAll {fogged: true}`; token "Goblin Lurker" (`enemy-1`) at (17, 11), visible flag | `battlemap` (+ ripple, FR-FOG-25) | no |
| `fog-ambush-partial` | Reveal rect (0, 3)–(7, 11) (Mira, Thorn); reveal polygon `[(8, 9), (13, 9), (8, 14)]` (Cave Ogre: its (10, 11) cell centre lies on the diagonal, counts as inside). Left fog-hidden: Goblin (12, 6), Goblin 2 (12, 8), Goblin Lurker; hidden + fogged: Wolf, Elite. Undo depth 4 (incl. the ripple's Reveal all) | `fog-ambush`, `scenes-extras`, `goblin-2` | no |

- **Bundle `fog`** = `scenes` + `goblin-2` + `encounter-1` + `fog-ambush` + `fog-ambush-partial`. `session-sim` gets no fog units (the ripple keeps it clear; the sprint regression draws fog live).
- **Leak strings** (player frames, any message type): "Goblin Lurker"; token ids of Goblin, Goblin 2, Goblin Lurker while fog-hidden; their `col`/`row` pairs; plus scenes-map's list. **Leak property:** no player `token` / prop / DM template frame has `fogged: true` unless its token has an owner; no `signal` names a fog-hidden token id.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-FOG-04 codec` (round trip, `""`, base 36, bad sum → fully fogged, 2,000-run cap); `FR-FOG-03 box` (offset 0 / > 0, regrid then re-base keeps every cell value); `FR-FOG-05 raster` (rect normalise; triangle cells incl. a centre on an edge; concave polygon; crossing edges / zero area refused; outside box ignored; no-op detection); `FR-FOG-10 fogged` (1×1, Large with one clear cell, off-box uses `fill`); `FR-FOG-11 fogHidden` matrix (owned / ownerless / hidden; prop; DM vs player template); `FR-FOG-07 stack` (depth 20 drops oldest, LIFO, expected id). Client: `FR-FOG-18/19 gestures` (snap to corners, < 4 px click, close on first vertex / Enter / double-click, Backspace, Esc, crossing refused, 64 max, Space pans, dropped on leaving live); `FR-FOG-20/21 render` (runs → row rects; DM vs player alpha; layer order map < grid < props < fog < tokens < labels) | In-code |
| Integration | Each command: rows + undo row + log + one event, IDs from `ctx`, rollback → nothing; no-op → no event. `FR-FOG-02` create → fogged row; duplicate copies the row, not the stack, copies' `fogged` recomputed; delete cascades. `FR-FOG-10 derive` in place, `placeTokenIn`, duplicate, move, size refresh. `FR-FOG-12 visibility` per type × DM / owner / other player. **Leak tests** (`player-1`, `player-2`, harness): snapshot + every frame through: reveal rect, reveal polygon, undo, DM moves Goblin 2 out of fog then Goblin into fog, `map.drag` of each, Fog all, Reveal all; **again after a reconnect** (`resync`) at each fogged state; convergence = fresh snapshot. `FR-FOG-14 combat`: `cbt.start encounter-1` with Goblin 2 fog-hidden → hidden combatant, no player row; reveal its cells → combatant + token upserts in one `FogEdited`, ranks rewritten; move it back into fog → hidden again. `FR-FOG-15 drag routing`: fog-hidden token → `"dm"`; visible token previewed into fog → `"dm"` from the first fogged frame; owned token → `"all"`. Crash: `PP_TEST_CRASH fog.edit:before-commit` / `after-commit` → digest equals before / after. Restart → identical snapshots, undo still works. **CON-44:** heavy scenario + §12 fog rows, per the picked option | `fog` |
| E2E (thin) | Playwright, DM + `player-1` (`// e2e-bundle: fog`): DM reveals a rect over Goblin → player's `map-token` for Goblin appears; player reload → still there; DM Undo → gone | `fog` |

**Browser walkthrough.** `PP_TEST_MODE=1`; `bun run build`, `fixtures:reset-load fog --profile verify`, `start --profile verify`. Contexts **A** DM, **B** `player-1`, **C** `player-2`. Evidence and teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in; view Goblin Ambush; "Show to players" | B, C open links | A: translucent fog, all tokens, "Fog" badge on Goblin, Goblin 2, Lurker. B, C: opaque fog; Mira, Thorn, Cave Ogre only |
| 2 | Fog tool → Reveal, Rectangle; drag (11, 5)–(13, 7) | — | Goblin appears for B, C ≤ 1 s; Goblin 2 still absent |
| 3 | Polygon: click (15, 10), (19, 10), (19, 13), (15, 13), click the first vertex | — | Goblin Lurker appears for B, C |
| 4 | Undo (Tooltip "Undo: reveal polygon") | — | Lurker gone for B, C; `fog-undo` `data-depth` back by 1 |
| 5 | Drag Goblin 2 slowly from (12, 8) to (11, 6), drop | — | B, C: nothing while it is in fog; it appears at (11, 6) on the drop |
| 6 | Drag Goblin from (12, 6) to (16, 6), drop | — | B, C: it glides to the fog edge, then vanishes on the drop; no player frame shows it in a fogged cell (col ≥ 14) |
| 7 | Hide, Rectangle over (0, 3)–(7, 11) | B drags Mira to (5, 5) | B, C still see Mira and Thorn (owned); B's move accepted |
| 8 | Start encounter "Ambush at the Ford" (binds Goblin, Goblin 2, Wolf, Elite, Mira, Thorn); then Reveal all; Fog all (confirm); Undo | — | B, C Initiative after Start: Mira, Thorn, Goblin 2 only (Goblin fog-hidden at (16, 6); Wolf, Elite hidden). Reveal all → Goblin's row and token appear in one event (Lurker's token too). Fog all → Goblin and Goblin 2 leave map and Initiative; Mira, Thorn stay. Undo → back to all revealed |
| 9 | Reveal a rect while B is dropped (Probes "drop connection") | B back | B: banner, then the revealed tokens, no reload |
| 10 | Hard-kill server; restart | All rejoin | Fog, undo depth and visibility as before; Undo still works. Throughout: no leak string in B, C frames; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [scenes-map](scenes-map.md) | Visibility hook registry + `derive` calls in token writes, token fn consults `hides`, `sceneHooks` line for create / duplicate, `dragToDm` in `map.drag`'s audience, exports (FR-FOG-24); `fog` canvas layer at the reserved slot 30; fog token overlay line | complete; settled S3, S6 |
| [scene-tools](scene-tools.md) (SCN) | Layer model keeps fog above objects / props, below tokens; a client tool registry for the Fog tool; props and templates expose cells, `fogged`, `placedByPlayerId`, call `derive`, consult `hides` | spec in parallel; OQ-FOG-11, -12 |
| [live-sync](live-sync.md) | Scene gate for `fog`; `audience` read access (FR-SYNC-28); option (c) would add a snapshot rule | complete |
| [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md) | Copies use `tokenHiddenForPlayers` (FR-FOG-14) | complete; amended via OQ-FOG-07 |
| [effect-modifiers](effect-modifiers.md) | Preset transport → REST read if OQ-FOG-04 (A) (FR-MOD amendment by the integrator) | complete; OQ-MOD-14 reopened by the DM only |
| [fixtures-adapters](fixtures-adapters.md) | Units + bundle `fog`; ripple steps in scenes-map units (FR-FOG-25) | complete |

**Shared changes** (builders report `shared change needed:` per AGENTS §9.9; the orchestrator sequences)

| Path | Change | Slice |
|---|---|---|
| ★ `src/server/db/` (schema lock; never at the same time as `fix/scn-core`) | `scene_fog`, `scene_fog_edit`; `token.fogged` (SCN's prop / `aoe_template` tables get `fogged` in `fix/scn-core`, after this, S2) | `fix/fog-core` |
| `src/shared/events/` | `fog-of-war.ts`: `FogEdited`, `FogUndone` | `fix/fog-core` |
| `src/server/features/scenes-map/` (scenes-map's files, cross-feature lock) | New `visibility-hooks.ts` (append-only registry); `derive` in place / `placeTokenIn` / duplicate / move / scene duplicate / FR-MAP-20 path; `tokenVisibility` consults `hides`; `drag.ts` consults `dragToDm`; new `sceneHooks` lifecycle registry (SCN's shape, S3) run in create / duplicate / delete, fog's line; exports | `fix/fog-core` |
| `src/server/features/effect-modifiers/` + client preset seam | Effect-modifiers preset transport → REST read (FR-MOD amendment by the integrator; S1): presets load on demand, out of the snapshot | `fix/fog-core` (first core) |
| Record-type registry, server feature list, `fixtures/bundles/index.ts` | `fog` type; `fogOfWar` feature; bundle `fog` (append-only lines) | fog builds |
| `src/server/features/combat-tracker/`, `combat-extras/` | Hidden copies via `tokenHiddenForPlayers` (combat lock) | `fix/fog-combat` |
| `src/client/common/features/scenes-map/canvas-layers.ts`, `token-overlays.ts` | `fog` layer line (order 30); `fog` overlay line (append-only) | `build/fog-of-war` |
| SCN's `canvas-tools.ts` (append-only, created by `fix/scn-core`) | Fog tool line (S6) | `build/fog-of-war` (client) |
| `fixtures/units/scenes-map/{town,battlemap,scenes-extras}.ts` | `fog.setAll {fogged: false}` step (FR-FOG-25) | `build/fog-of-war` (orchestrator-assigned) |
| Docs | data model (fog tables, token column), protocol (§5 `fog` type, intents, events, registry, CON-44 budget row), glossary (OQ-FOG-16) | consolidation |

**Build slices** (after DM gate 2; order settled S2: `fix/fog-core` → `fix/scn-core`; the fog client slice after `fix/scn-core`; `fix/fog-combat` before SCN's `movedFt` rule hook, S8)

| # | Branch | Contents | Size |
|---|---|---|---|
| 1 | `fix/fog-core` | Schema, events, registry + scenes-map call sites, token fn, `drag.ts`, `sceneHooks` registry + fog line, `fog` record type, codec + raster in `@shared/fog-of-war`, presets on demand (S1) | M |
| 2 | `build/fog-of-war` (server) | Commands, undo, `derive` / `hides` lines, fixtures + bundle + ripple, leak / crash / CON-44 tests | M |
| 3 | `fix/fog-combat` | FR-FOG-14 in combat-tracker / combat-extras (+ their tests) | S |
| 4 | `build/fog-of-war` (client), after `fix/scn-core` | Layer, tool (in `canvas-tools.ts`) + gestures, overlay badge, e2e, walkthrough | L |
| 5 | (with SCN's build) | Props, persistent and ephemeral DM templates as fog subjects + tests | S |

## 15. Open questions

**Bold** = suggested pick (not decided). "DM" = needs the DM at gate 2.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-FOG-01 | Scope | **As §2: rect + polygon, reveal / hide, Reveal all, Fog all, Undo; no brush** / add a brush (new raster gesture, larger masks) | yes · DM | — |
| OQ-FOG-02 | Default for a new scene (carried) | **Fully fogged; DM reveals** (safe by default; one click to clear a town) / clear (no surprise blackouts; easy to forget fog before showing) | yes · DM | fixtures (FR-FOG-25) |
| OQ-FOG-03 | Who sees owned tokens under fog | **Every player** (party sees each other, like minis on a table; combat copies stay one flag) / only the owner (brief's wording; a scout vanishes for the rest; owner-dependent copies in combat) / nobody (owners lose their own token) | yes · DM | scenes-map, combat-tracker |
| OQ-FOG-04 | CON-44, one combined F + B question (S1): fog ≈ 8.3 KB + SCN window ≈ 7.3 KB, 4.4 KiB left today | **(A) effect presets on demand + SCN active-scene window: ≈ 779 KB, ≈ 7 KB left** / (B) A + a token window: ≈ 100 KB free, bigger change / (C) raise the DM ceiling (DM only; local client, cost is build time). Rejected: fog as is (≈ 3.8 KB over), fog windowing (frees too little) | yes · DM | effect-modifiers, live-sync, scene-tools, protocol CON-44 |
| OQ-FOG-05 | Fog geometry | **Cell mask, run-length (bounded size, trivial hide test, cheap undo); diagonals stepped per cell** / polygon op list (smooth edges; grows with every edit, needs compaction and polygon tests per token) / bitmap (simple, ≤ 44 KB per scene) | no · DM (visible) | — |
| OQ-FOG-06 | Polygon snap | **Grid corners** (matches cells) / half cells / free (only with OQ-FOG-05 op list) | no · owner: spec-fog-of-war | — |
| OQ-FOG-07 | Fog-hidden monsters in combat (combat-tracker, combat-extras) | **Fog-hidden = hidden for combat copies** (map and Initiative agree; no `tokenId` leak; their hooks change) / combat ignores fog (no change; Initiative shows a monster the map hides, its `tokenId` reaches players) / Start warns only | yes · DM | combat-tracker FR-CBT-08/09, combat-extras FR-CBTX-13/45 |
| OQ-FOG-08 | Fog undo | **Own per-scene LIFO stack, depth 20, persisted, no redo** (extends ADR-0016's "no scene edits"; proposed ADR) / no undo / unlimited | yes · DM (ADR) | ADR-0016, glossary |
| OQ-FOG-09 | The map image is downloaded whole | **Accept: fog hides records, not pixels (as Owlbear / Roll20)** / server renders a fogged map image per reveal (heavy, new asset per edit) | no · DM (awareness) | assets-pipeline |
| ~~OQ-FOG-10~~ | ~~scenes-map seam~~ | **Settled S6** (with S3): `visibility-hooks.ts` (`derive`, `hides`, `dragToDm`), append-only, created by `fix/fog-core`; scene create / duplicate via `sceneHooks`; AGENTS §9.9 gains `visibility-hooks.ts`, `sceneHooks`, `moveGuards`, `canvasTools` (integrator) | — | scenes-map, ADR-0028, ADR-0033 |
| ~~OQ-FOG-11~~ | ~~Layer stack and tools~~ | **Settled S6:** map 0, grid 10, scn-props 20, scn-templates 24, scn-structure 26, fog 30, tokens 40, labels 45, scn-edit 48, pointers 50; fog tools in SCN's `canvas-tools.ts`; drawing tools share "Space + drag pans" | — | scene-tools |
| ~~OQ-FOG-12~~ | ~~Scene-tools records fog hides~~ | **Settled S5:** props, DM-placed persistent templates and DM-placed ephemeral template signals (FR-FOG-15); player-placed templates never; SCN exposes `cells`, `fogged`, `placedByPlayerId`, calls `derive`, consults `hides`. Walls / doors not fog subjects; doors reach players under fog (accepted leak, §11) | — | scene-tools |
| OQ-FOG-13 | Camera fit (scenes-map) | **No change** (player box = own store; fog-hidden never count) / player box = revealed area when no tokens | no · owner: spec-fog-of-war | scenes-map FR-MAP-44 |
| OQ-FOG-14 | When a token counts as under fog | **Every footprint cell fogged** (any clear cell shows it) / centre cell / any cell fogged | no · owner: spec-fog-of-war | scene-tools |
| ~~OQ-FOG-15~~ | ~~Core order~~ | **Settled S2:** `fix/fog-core` → `fix/scn-core` (SCN creates its tables with `fogged` and calls `derive`); fog client slice after `fix/scn-core` | — | scene-tools |
| OQ-FOG-16 | Glossary | **Fog** → "Cells of a scene hidden from players, drawn by the DM; what lies wholly under it is filtered server-side"; add **Fog-hidden**, **Reveal all / Fog all**; **Undo** gains "and fog edits (own stack)" | no · integrator | glossary |
| OQ-FOG-17 | Fog colours | **Placeholder `fog.dm` (≈ 50 % neutral) / `fog.player` (opaque) until theme-system** / name now | no · owner: spec-fog-of-war | visual-direction |
| OQ-FOG-18 | Fixture ripple | **Reveal-all steps in scenes-map's units, re-baselines in the same branch** / a create option `fog: clear` (REST change) | no · orchestrator | fixtures-adapters, scenes-map |
| OQ-FOG-19 | Numbers | **≤ 1 s, 2,000 runs, 64 vertices, undo 20, DM alpha 50 %** / DM sets | no · DM (bulk) | — |

## 16. Out of scope

- Vision, lighting, line of sight, fog by walls ([ADR-0007](../architecture/adr/0007-product-scope.md)); exploration memory; brush; player fog tools; fogged map images (OQ-FOG-09).
- Layers, walls, doors, props, AoE templates themselves → [scene-tools](scene-tools.md).
