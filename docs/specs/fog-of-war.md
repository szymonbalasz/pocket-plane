---
title: Fog of war
prefix: FOG
status: complete
owner: spec-fog-of-war
phase: post-mvp-2
---

# Fog of war

## 1. Summary

- The DM covers a scene with **fog** and reveals or hides areas with a **rectangle** or **polygon** tool, plus **Reveal all** / **Fog all** and **Undo**. Sprint 2 phase 2, track F ([sprint-2](../agents/sprint-2.md#track-f-fog-of-war--new-spec-fog-of-war-prefix-fog)); first post-MVP item since [ADR-0014](../architecture/adr/0014-mvp-scope.md).
- Fog is a **cell mask** on the scene's grid, run-length encoded (one small `fog` record per scene). Players see it opaque, the DM translucent.
- Whatever fog covers is **filtered server-side**: a token, prop or DM-placed AoE template wholly under fog never reaches a player socket. A server-written `fogged` copy on each record + scenes-map hook registries keep visibility fns pure ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md)); registry contracts in the fog-visibility ADR [fog visibility](../architecture/adr/0039-fog-visibility.md).

## 2. Scope

- Per scene, DM only: rectangle and polygon tools in **reveal** or **hide** mode; Reveal all; Fog all; Undo (per scene, LIFO). No brush.
- **New scenes start fully fogged** (decided #196, [OQ-FOG-02](#15-open-questions)); scenes that exist before this build stay clear.
- Live: a reveal reaches players ≤ 1 s, one transaction, one event. Fog and its undo stack survive reload, reconnect and a hard kill.
- Server-side hiding of **fog subjects**: tokens (scenes-map), props and DM-placed AoE templates ([scene-tools](scene-tools.md), SCN). Tokens with an owner stay visible to every player (decided #196, [OQ-FOG-03](#15-open-questions)). Doors are hidden while fully fogged (SCN's per-door flag, OQ-SCN-06, decided #196).
- Seams: scenes-map token visibility, scene lifecycle, drag preview routing, camera fit; scene-tools layers, tools, records, doors; combat copies of "hidden" ([OQ-FOG-07](#15-open-questions)).

## 3. Goals

- **Zero leakage:** no player frame (snapshot, event, signal, load result) carries the id, name, position, image or any field of a fog-hidden record, before or after a reconnect.
- A reveal of a large polygon over many tokens = one transaction, one `FogEdited`, one frame per connection, ≤ 1 s to players.
- Fits the DM snapshot ceiling (CON-44) with the token + SCN active-scene window ([OQ-FOG-04](#15-open-questions), decided #196).

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
| FR-FOG-02 | **New scene fully fogged** *(decided #196, OQ-FOG-02)*: fog's `sceneHooks` line ([fog-visibility ADR](../architecture/adr/0039-fog-visibility.md)) writes `{fill: fog, runs: ""}` in `map.createScene`'s transaction (`created`), and copies the source's row, not its undo stack, in `map.duplicateScene` (`duplicated`; no source row → none). | Registered in the last server slice (§14) |
| FR-FOG-03 | **Box** = every cell overlapping the map rectangle at the scene's current grid: `col0 = floor(−offsetX / cellSize)`, `cols = ceil((mapWidth − offsetX) / cellSize) − col0`; rows alike (≤ 513 × 513). `map.setGrid` / `map.setSceneMap` never touch fog: cells keep their index, so fog moves with the grid like tokens. Each fog edit **re-bases** the mask to the current box (new cells take `fill`; cells leaving it fall back to `fill`, so their value may change); FR-FOG-08 re-derives every subject anyway. | |
| FR-FOG-04 | **Encoding** `runs`: row-major over the box, alternating run lengths starting with **fogged**, base 36, comma-separated (`"1k,5,7"`); `""` = every box cell is `fill`. Sum ≠ `cols × rows` on read → fully fogged + `error` log (fail closed). ≤ **2,000 runs** per scene (≤ 10 KB) *(OQ-FOG-19)*; over → `conflict` "Fog too detailed — reveal or hide larger areas", nothing written. Pure codec in `@shared/fog-of-war/mask.ts`. | |
| **Editing** (DM only; WS intents, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D) | | |
| FR-FOG-05 | `fog.edit {sceneId, op: reveal \| hide, shape}`. **Rectangle** `{kind: rect, c0, r0, c1, r1}`: cells c0…c1 × r0…r1 inclusive (normalised). **Polygon** `{kind: polygon, points [[i, j], …]}`: 3–64 vertices on **grid corners** (corner (i, j) = map point `(offsetX + i·cellSize, offsetY + j·cellSize)`); crossing edges or zero area → `invalid`. A cell is affected iff its **centre** lies inside or on the boundary (scanline, even-odd). Cells outside the box are ignored. No cell changes → no event, no undo entry, `ack {editId: null}`. | Diagonals stepped (OQ-FOG-05) |
| FR-FOG-06 | `fog.setAll {sceneId, fogged}`: **Fog all** → `{fill: fog, runs: ""}`; **Reveal all** → `{fill: clear, runs: ""}`; writes a row for a scene that had none. Same value → no-op. | |
| FR-FOG-07 | **Undo** `fog.undo {sceneId, expectedEditId}`: restores the mask from before the latest edit and drops that entry; strict LIFO; ≤ **20** entries per scene, oldest dropped in the edit's transaction *(OQ-FOG-08)*. Stale `expectedEditId` → `conflict` "Fog changed — check and undo again"; empty → `conflict`. No redo. Persisted (survives reload, restart). Own stack, not [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) undo; scene-tools undoes with client inverse intents instead (one mask vs many records, S7). | Guard like FR-CBT-35 |
| FR-FOG-08 | Every fog command (edit, setAll, undo) is one transaction: `fog` row + undo row(s) + every **fog subject** on the scene whose `fogged` changes (FR-FOG-10) + the scene's `scene-structure` row if a door's fog flag changes (OQ-SCN-06, decided #196) + rows from token-changed hooks (FR-FOG-13) + one event-log entry; then one `FogEdited` / `FogUndone` (§9). IDs and time from `ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). | |
| FR-FOG-09 | Fog intents work on any scene, active or not (prep); disabled in the UI while not `live` ([FR-SYNC-24](live-sync.md#6-functional-requirements)). A player sending any `fog.*` → `forbidden`. | |
| **What fog hides** | | |
| FR-FOG-10 | **`fogged` copy**: true iff **every** cell of the subject's footprint is fogged (OQ-FOG-14). Footprint: token = FR-MAP-14 square; prop, template = SCN's **uncut** cells (cells off the box take `fill`, so a map change never makes it stale). Server-written only (in an intent → `invalid`). Written in the same transaction by fog commands (FR-FOG-08) and, via `deriveSceneObject(read, obj)`, by every write of a subject's scene, cell or size: `map.placeToken`, `placeTokenIn` ([FR-MAP-48](scenes-map.md#6-functional-requirements)), `map.duplicateToken`, `map.moveToken`, `map.duplicateScene`, the size refresh ([FR-MAP-20](scenes-map.md#6-functional-requirements)), SCN's prop / template writes. **Order** (S4): guards (SCN `moveGuards`) → `derive` → one write → token-changed hooks. | ADR-0024 copy pattern |
| FR-FOG-11 | **Fog-hidden** (pure, reads only the record; the same for every player): `fogged` **and** not exempt. Exempt: a token with `ownerPlayerId` *(decided #196, OQ-FOG-03)*; a template with `placedByPlayerId`. Props are DM-placed, never exempt. The `hidden` flag ([FR-MAP-19](scenes-map.md#6-functional-requirements)) is independent: hidden **or** fog-hidden → `hidden` for players. `fogHidden(type, record)` in `@shared/fog-of-war`. | |
| FR-FOG-12 | **Visibility via the `hides` hook** (FR-FOG-24): scenes-map's token fn and SCN's prop / template fns return `hidden` when any `hides(type, record)` is true; DM always `full`. Snapshot, events and `sync.loadScene` share the fn: covering = `delete`, revealing = `upsert` ([FR-SYNC-19](live-sync.md#6-functional-requirements)); a token **walking out** of fog arrives as an upsert in `TokenMoved`, one walking in as a `delete`. Wire `fogged` only when true. | |
| FR-FOG-13 | **Token-changed hooks on fog flips:** fog commands and the FR-MAP-20 size refresh run scenes-map's token-changed hooks ([FR-MAP-30](scenes-map.md#6-functional-requirements), [ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) for every token whose fog-hidden value flips; rows join the event's `changes`; a reject rolls back. Moves already run them ([ADR-0031](../architecture/adr/0031-token-move-hooks.md)) with `after.fogged` derived. | Size refresh: new hook run |
| FR-FOG-14 | **Combat** *(decided #196, OQ-FOG-07)*: **every write of a combatant's or effect's hidden copy uses `tokenHiddenForPlayers(token)`** (= `hidden` or fog-hidden; scenes-map export). Sites: Start binding ([FR-CBT-08](combat-tracker.md#6-functional-requirements)); created tokens at Start ([FR-CBT-64/65](combat-tracker.md#6-functional-requirements), `lifecycle.ts` via `TokenPlacer`); mid-fight Add binding and created tokens ([FR-CBTX-44](combat-extras.md#6-functional-requirements), `add-combatants.ts`); link ([FR-CBTX-45](combat-extras.md#6-functional-requirements), `bind-token.ts`); the token hook ([FR-CBT-09](combat-tracker.md#6-functional-requirements): ranks, player turn), fed by fog commands, moves and the size refresh (FR-FOG-13); CBTX's effect copy ([FR-CBTX-13](combat-extras.md#6-functional-requirements)). So a fog-hidden monster is a hidden combatant (no player Initiative row, public outcome lines DM-only, [FR-CBT-36](combat-tracker.md#6-functional-requirements)); revealing it shows token and row in one event. Targeting stays DM-only (#134). If the DM adds SCN's "Select creatures inside" (default out), it includes fog-hidden tokens. | Combat specs amend |
| FR-FOG-15 | **Signals** ([ADR-0033](../architecture/adr/0033-signal-audience.md), read-only access FR-SYNC-28). `map.drag` ([FR-MAP-41](scenes-map.md#6-functional-requirements)): a position frame routes **`"dm"`** if the token is hidden for players **or** its previewed footprint (cell under the frame's top-left, rounded as FR-MAP-15) is wholly fogged and the token isn't exempt; an `end` frame (no position) routes `"dm"` iff the token is hidden for players, else `"all"`. Players see a monster glide to the fog edge and vanish on the drop. SCN's ephemeral `scn.template`: a **DM-placed** template whose uncut cells are wholly fogged → `"dm"`; its `end` routes as SCN; player-placed ones are never fog-hidden. | |
| FR-FOG-16 | **Camera fit** ([FR-MAP-44/46](scenes-map.md#6-functional-requirements)): no change. A player's content box uses its store, so fog-hidden tokens never count; the DM's includes them (OQ-FOG-13). | |
| **Client** | | |
| FR-FOG-17 | **Fog tool** (DM, a line in SCN's `canvas-tools.ts`): a floating fog bar beside the rail (open while the tool is active; not a Popover, so drawing keeps it open): **Reveal \| Hide**, **Rectangle \| Polygon** (defaults Reveal, Rectangle), **Reveal all**, **Fog all…** (AlertDialog "Fog the whole scene? Players keep only the party's tokens." Confirm / Cancel), **Undo** (Tooltip "Undo: ‹reveal \| hide› ‹rectangle \| polygon \| all›"; disabled when empty). Works on the viewed scene (FR-MAP-08). Pointer input is dispatched at **stage level** to the active tool (SCN's canvas core, BO3); while the tool is active tokens take no left-press (no drag), right-click still opens the token menu. **Rectangle mode:** left-drag draws, Space + drag pans. **Polygon mode:** clicks add vertices, left-drag or Space + drag pans. | |
| FR-FOG-18 | **Rectangle:** left-drag cell to cell; the draft (snapped cells, accent outline, translucent fill) follows; release sends `fog.edit`. < 4 px = that one cell. Esc cancels. The draft stays until the event or reject; reject → Toast. | |
| FR-FOG-19 | **Polygon:** a click adds a vertex at the nearest grid corner (< 4 px from the last one: ignored); a vertex whose edge would cross another is refused (Tooltip "Edges can't cross"); **Enter**, double-click or a click on the first vertex closes (≥ 3) and sends; **Backspace** drops the last; **Esc** cancels; 64 max. Keys via `useBaseKeyDown` ([FR-SHELL-13](play-shell.md#6-functional-requirements)). | |
| FR-FOG-20 | **DM render:** fogged cells as one translucent shape (`fog.dm`, ≈ 50 %) on the `fog` canvas layer (`canvas-layers.ts`, order 30, S6): map 0 < grid 10 < scn-props 20 < scn-structure 26 < **fog 30** < scn-templates 35 < tokens 40 < labels 45 < scn-edit 48 < pointers 50. Fog-hidden tokens get a DM-only overlay badge "Fog" (`fog-token-fogged`, [FR-MAP-34](scenes-map.md#6-functional-requirements)); `hidden` tokens keep their own styling. | |
| FR-FOG-21 | **Player render:** fogged cells opaque (`fog.player`) on the same layer, under templates, tokens and labels, so party tokens and own templates in fog stay visible. Drawn from the same snapshot as the scene. No fog row → no fog. Switched on in the same slice as `hides` (§14). | |
| FR-FOG-22 | A gesture in progress is dropped (unsent) when the client leaves `live`, the viewed scene changes or another tool is picked. | Like FR-MAP-28 |
| **Lifecycle** | | |
| FR-FOG-23 | **Scene delete:** fog's `sceneHooks` `deleting` line returns `{type: fog, before, after: null}`, so `SceneDeleted` lists the `fog` delete (DM store converges); the FK cascade removes the row and undo stack. Activation: players get the new scene's `fog` in the resync snapshot (scene gate, [FR-SYNC-09](live-sync.md#6-functional-requirements)). | |
| FR-FOG-24 | **Registries** (scenes-map's, append-only, created empty by `fix/fog-core`; contracts in the fog-visibility ADR, accepted #196): `visibility-hooks.ts` (`derive`, `hides`, `dragToDm`) and `scene-hooks.ts` (`created`, `duplicated`, `deleting`). scenes-map exports `deriveSceneObject(read, obj)`, `tokenHiddenForPlayers(token)`, `runTokenChangedHooks(env, before, after)`. No line registered → no behaviour change. | Table §14 |
| FR-FOG-25 | **Ripple** (new scenes start fogged once fog's `created` line registers): every setup that creates scenes reveals them, so existing tests and bundles keep their player view: fixture units `town`, `battlemap`, `scenes-extras` (last step `fog.setAll {fogged: false}` per scene); test helpers `combat-tracker/testing.ts`, `dice-roll-log/testing.ts`, scenes-map's `commands.test.ts`, `feedback.test.ts`, `place-token-in.test.ts`, `character-copy.test.ts`, `combat2-add.test.ts` (a shared `revealed` default on their create helper); the CON-44 harness `ws/testing/snapshot-size.ts` (reveals its battle scene, keeps the others fogged). Accepted: each ripple reveal leaves one undo entry ("Undo: reveal all") on those scenes. Re-baselines in the same branch. | OQ-FOG-18 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, the map is the hero; lucide `cloud-fog`. Fog colours are placeholder semantic tokens `fog.dm` / `fog.player` until [theme-system](post-mvp/theme-system.md) names them (OQ-FOG-17).

- **Screens:** no window. Tool line + floating fog bar + canvas layer + one token overlay badge.
- **States:** empty = no fog row or fully fogged (players: black map, party tokens). Loading = scene loading ([FR-MAP-07](scenes-map.md#6-functional-requirements)). Error = Toast on reject, draft removed. Disconnected = fog bar disabled, gestures dropped (FR-FOG-22), fog stays drawn.
- **DM view:** all tokens; fog translucent; "Fog" badge; draft shape; Undo Tooltip names the step; works on scenes not shown to players.
- **Player view:** opaque fog; only records not fog-hidden; party tokens and own templates over the fog. No fog controls.
- **Test IDs:** `fog-tool`, `fog-bar`, `fog-mode-reveal`, `fog-mode-hide`, `fog-shape-rect`, `fog-shape-polygon`, `fog-reveal-all`, `fog-fog-all`, `fog-fog-all-confirm`, `fog-undo` (attr `data-depth`). Konva: layer `fog-layer`; shape `fog-mask` (attrs `fill`, `fogged-cells`); `fog-draft`, `fog-draft-vertex` (`id` = index); badge `fog-token-fogged` (`id` = token id).

## 8. Data model

No JSON leaf fields. Rows per campaign ([ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)); timestamps from `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Fog *(new, `scene_fog`)* | sceneId (PK), campaignId | ID → Scene (cascade), ID → Campaign | One row per scene; wire `id` = `sceneId` |
| | fill; col0, row0, cols, rows; runs; updatedAt | `fog` \| `clear`; int ×4; text ≤ 10 KB; timestamp | FR-FOG-01–04 |
| Fog edit *(new, `scene_fog_edit`, undo stack)* | id, campaignId, sceneId, seq | ID, ID, ID → Scene (cascade), int | ≤ 20 per scene |
| | kind; prevFill, prevCol0, prevRow0, prevCols, prevRows, prevRuns; createdAt | `reveal-rect` \| `reveal-polygon` \| `hide-rect` \| `hide-polygon` \| `reveal-all` \| `fog-all`; mask before; timestamp | Undo restores `prev*` |
| Token *(scenes-map)* | **fogged** | bool, default false | Server copy; wire only when true |
| Prop, AoE template *(SCN)* | **fogged** | bool, default false | Created with the tables in `fix/scn-core` (S2) |
| Door *(SCN `doors` JSON)* | fog flag | OQ-SCN-06 (decided #196) | Both adjoining cells fogged; set by fog's re-derive and `scn.addDoor`; player redaction drops flagged doors |

- **Relations:** Scene 1—0..1 Fog; Scene 1—* Fog edit. Fog subjects → Scene.
- **Derived:** box; mask ↔ runs; `fogged`; fog-hidden; undo depth and latest edit (DM wire). Client only: draft, fog bar state.
- **Persisted runtime state:** fog rows, undo stacks, `fogged` copies, door flags, all committed together.

## 9. API & events

**REST:** none (canvas actions are WS, ADR-0021 D).

| WS intent (DM only) | Validation / ownership |
|---|---|
| `fog.edit {sceneId, op, shape}` → `{editId \| null}` | Scene in `ctx.campaignId` (`not_found`); zod: ints, \|value\| ≤ 1,024, 3–64 vertices; crossing / zero area → `invalid`; runs cap → `conflict` |
| `fog.setAll {sceneId, fogged}` → `{editId \| null}` | Scene in campaign |
| `fog.undo {sceneId, expectedEditId}` | Latest edit = `expectedEditId`, else `conflict` |

| Record type | Scope | DM wire | Player visibility | Snapshot |
|---|---|---|---|---|
| `fog` *(new)* | scene, `sceneOf = id` | `{id, campaignId, fill, box, runs, undo: {n, editId, kind} \| null}` | **redacted** `{id, fill, box, runs}` | DM: every scene's row (compact, never windowed); player: active scene's |
| `token` (scenes-map) | unchanged | + `fogged` (when true) | `hidden` or fog-hidden → **hidden**; else FR-MAP-26 | DM: active scene's; others via `sync.loadScene` (OQ-FOG-04 B, decided #196) |
| prop, AoE template (SCN) | SCN's | + `fogged` | fog-hidden → **hidden**; else SCN's | SCN's window |

| Change | Owning player | Other players |
|---|---|---|
| `fog` upsert, active scene / other scene | upsert (redacted) / nothing (gate) | same |
| Ownerless token covered / revealed | — | `delete` / `upsert` (image ID reaches them now, [FR-ASSET-12](assets-pipeline.md#6-functional-requirements)) |
| Owned token under fog | `upsert`, `fogged: true` | `upsert` *(decided #196, OQ-FOG-03)* |
| Prop / DM template covered / revealed | `delete` / `upsert` | same |
| Door flag set / cleared (OQ-SCN-06, #196) | `scene-structure` upsert without / with the door | same |
| Combatant / effect of a fog-hidden token | `delete` (hidden copy) | `delete` |
| `map.drag` / DM `scn.template` into or under fog | none (`"dm"`) | none |

| Domain event (logged; not ADR-0016-undoable) | Payload | Changes |
|---|---|---|
| `FogEdited` / `FogUndone` | `{sceneId, editId, kind, shape?}` / `{sceneId, editId}` | `fog` upsert; flipped subjects; `scene-structure` (door flags); token-hook rows (`combatant`, `encounter`, `effect`) |
| `SceneCreated` / `SceneDuplicated` / `SceneDeleted` (scenes-map) | unchanged | + `fog` upsert / upsert / delete (`sceneHooks`) |
| Token events, `EntityUpdated` | unchanged | `token` rows carry the derived `fogged`; size refresh + token-hook rows |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Edit / reveal all / fog all / undo fog | ✓ any scene | ✗ | Default-DM intents; scene in `ctx.campaignId` |
| See fog | translucent, every scene | opaque, active scene | `fog` record + scene gate |
| See fog-hidden records | ✓ | ✗ (exempt: party tokens, own templates) | Visibility fns + `hides` |
| Move own token into / out of fog | — | ✓ (FR-MAP-21) | Unchanged; `fogged` derived |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** stale view + banner; the reconnect snapshot = current fog + only visible records. Previews of fog-hidden drags never reached them.
- **DM disconnect / reconnect:** fog bar disabled, gesture dropped; players unaffected; the undo stack is server-side. With the token window (OQ-FOG-04 B), `FogEdited` token rows for a scene the DM hasn't loaded follow the window ADR's rule (live events reach the DM for every scene).
- **Server crash mid-action:** one transaction: before commit → nothing; after → all in the snapshot. `PP_TEST_CRASH fog.edit:before-commit` / `after-commit` ([AGENTS §9.2](../../AGENTS.md#92-env-ports-and-data)); `state:digest` identical across the kill.
- **Concurrent edits:** serialised; each edit applies its shape to the current mask. Two DM tabs undoing → `expectedEditId` `conflict`. A move racing a reveal: the later commit derives against the committed mask. Preview routing follows the stored state per frame.
- **Grid / map changed:** fog keeps cell indices; the box re-bases on the next edit; subjects re-derive then (template cells are uncut, so nothing goes stale before).
- **Token partly under fog** (Large, one clear cell) → visible. **Off the map** → its cells take `fill`. **Hidden + fog:** independent.
- **Invalid / malicious input:** player `fog.*` → `forbidden`; `fogged` in any intent → `invalid`; zod caps; frame cap 64 KB ([FR-SYNC-12](live-sync.md#6-functional-requirements)); corrupt `runs` → fully fogged.
- **Accepted leaks:** the map image (OQ-FOG-09); token name numbering and `seq` gaps (as hidden tokens today); `cause FogEdited` on a cover; **walls** under fog (not fog subjects; the map image shows structure). Doors are **not** leaked: hidden while fully fogged (OQ-SCN-06, decided #196), dropped from the player redaction.

## 12. Performance & bandwidth

- **Edit cost:** scanline raster over the shape's bounding box (≤ 263k cells); re-check ≤ 200 tokens + SCN subjects; one transaction, one event; commit → player frame < 50 ms locally.
- **Frames:** `fog` row ≈ 170 B + runs (cap 10 KB). Uncovering 50 tokens: player ≈ 21 KB, DM ≈ 25 KB.
- **Render:** runs → one Konva shape of row-run rects, `listening: false`, cached, redrawn only on `fog` change. **Review check:** Chrome trace, DM pan on Cellar with a 2,000-run mask and every SCN layer present: median frame ≤ 20 ms; if not, fog renders as a `Group` in a shared Konva layer (layer count budget with SCN, X10).
- **Snapshot (CON-44), measured** on `main`'s realistic-heavy harness with prototype fog / SCN rows (method and raw numbers: the probe report shared with scene-tools). Base = today + 30 `fog` rows (5,045 B) + `"fogged":true` on 206 of 300 tokens (2,884 B) + one typical SCN scene under its window (7,384 B):

| Option (OQ-FOG-04 = OQ-SCN-01, decided #196: B) | Heavy DM | Left of 786,432 B | Kind |
|---|---|---|---|
| Today (`main`) | 781,917 | 4,515 | measured |
| Base (no option) | 797,382 | **−10,950 (over)** | measured |
| (A) all effect presets (campaign + character) on demand over the window's WS load; reopens #190 OQ-MOD-14 / -15 | 778,920 | 7,512 | measured |
| **(B) token window + SCN window** (decided #196) | **676,257** | **110,175** | measured |
| (C) raise the DM ceiling (DM only) | 797,382 | needs ≥ 797.4 KB; at 1 MiB 251,194 | measured |
| Campaign presets only on demand | ≈ 785.9 KB | ≈ 0.6 KB | estimate, not offered |

- Players: P1 281,267 B with the active fog row + SCN records (243,021 B left of 512 KiB), measured.

## 13. Test plan

Isolated per worktree: `bun test` on `:memory:` DB, temp asset dir, port 0; walkthrough on the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)). Tests named after FRs. Setups run as DM.

| Key | Contents | Requires |
|---|---|---|
| `fog-ambush` | Goblin Ambush: `fog.setAll {fogged: true}`; token "Goblin Lurker" (`enemy-1`) at (17, 11), visible flag | `battlemap` (+ ripple) |
| `fog-ambush-partial` | Reveal rect (0, 3)–(7, 11) (Mira, Thorn); reveal polygon `[(8, 9), (13, 9), (8, 14)]` (Cave Ogre; its (10, 11) centre lies on the diagonal = inside). Fog-hidden: Goblin (12, 6), Goblin 2 (12, 8), Lurker; hidden + fogged: Wolf, Elite. Undo depth 4 (incl. the ripple's Reveal all) | `fog-ambush`, `scenes-extras`, `goblin-2` |
| `fog-scn` | In fog on Goblin Ambush: a visible barrel prop at (16, 2); a DM kept template "Trap" (sphere 10 ft at vertex (18, 5)); a closed door on the segment (15, 13)–(16, 13) (both adjoining cells fogged) | `fog-ambush-partial`, `scn-props`, `scn-templates` |

- **Bundles:** `fog` = `scenes` + `goblin-2` + `encounter-1` + `fog-ambush` + `fog-ambush-partial`; `fog-scn` = `fog` + SCN's units + `fog-scn` (after both client slices). `session-sim` gets no fog units.
- **Leak strings** (player frames incl. `sync.loadScene` results): "Goblin Lurker", "Trap"; the barrel's asset ID; ids and `col`/`row` pairs of fog-hidden tokens; the fogged door's segment; plus scenes-map's list. **Property:** no player record has `fogged: true` unless it is an owned token; no `signal` names a fog-hidden token id.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-FOG-04 codec` (round trip, `""`, base 36, bad sum, cap); `FR-FOG-03 box` (offset 0 / > 0; re-base to a smaller box changes dropped cells, subjects re-derived); `FR-FOG-05 raster` (rect; triangle incl. a centre on an edge; concave; crossing / zero area refused; outside box; no-op); `FR-FOG-10 fogged` (1×1, Large with one clear cell, off-box `fill`, uncut template cells); `FR-FOG-11` matrix (owned / ownerless / hidden; prop; DM vs player template); `FR-FOG-07 stack`. Client: `FR-FOG-17–19 gestures` per mode (rect drag draws, polygon clicks, Space pans in both, < 4 px, Enter / double-click / first vertex, Backspace, Esc, crossing refused, 64 max, dropped on leaving live, right-click menu still opens); `FR-FOG-20/21 render` (row rects; DM vs player alpha; layer order) | In-code |
| Integration | Each command: rows + undo row + log + one event, IDs from `ctx`, rollback → nothing; no-op → no event. `FR-FOG-02/23` create → fogged row; duplicate copies row not stack, copies re-derived; **delete → DM frame has the `fog` delete, DM store converges**. `FR-FOG-10 derive` per call site. `FR-FOG-12` per type × DM / owner / other player. **Leak tests** (`player-1`, `player-2`): snapshot + every frame through reveal rect / polygon, undo, Goblin 2 out of fog, Goblin into fog, `map.drag` of each (position and `end` frames), Fog all, Reveal all; **again after `resync`** at each fogged state; convergence. **`FR-FOG-14` per copy site** (each: no player `combatant` / `effect` / log-entry frame for the fog-hidden monster): Start with Goblin 2 fog-hidden; Start with created tokens at a fogged `at`; Add (Add hidden unticked) binding a token in fog; Add with created tokens in fog; link a token in fog; size refresh Large → Medium flipping fog-hidden; reveal → token + combatant + ranks in one `FogEdited`; move back into fog → hidden. `FR-FOG-15`: fog-hidden → `"dm"`; visible token previewed into fog → `"dm"` from the first fogged frame; `end` by stored state; owned → `"all"`. Crash hooks → digest before / after. Restart → identical snapshots, undo works. **CON-44:** heavy harness gains the §12 fog rows and the revealed battle scene; asserted under the picked option | `fog` |
| Integration (with SCN) | `fog-scn`: barrel, Trap, door absent from player frames and `sync.loadScene` results; reveal their cells → upserts (door back in `scene-structure`); a DM ephemeral `scn.template` wholly in fog → `"dm"`, partly revealed → `"all"`; a player template in fog → visible to all | `fog-scn` |
| E2E (thin) | DM + `player-1` (`// e2e-bundle: fog`): reveal a rect over Goblin → player sees it; player reload → still there; DM Undo → gone | `fog` |

**Browser walkthrough.** `PP_TEST_MODE=1`; `bun run build`, `fixtures:reset-load fog --profile verify` (step 11: `fog-scn`), `start --profile verify`. Contexts **A** DM, **B** `player-1`, **C** `player-2`. Evidence and teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in; view Goblin Ambush; "Show to players" | B, C open links | A: translucent fog, all tokens, "Fog" badge on Goblin, Goblin 2, Lurker. B, C: opaque fog; Mira, Thorn, Cave Ogre only |
| 2 | Fog tool → Reveal, Rectangle; drag (11, 5)–(13, 7) | — | Goblin appears for B, C ≤ 1 s; Goblin 2 still absent |
| 3 | Polygon: click (15, 10), (19, 10), (19, 13), (15, 13), the first vertex | — | Goblin Lurker appears |
| 4 | Undo (Tooltip "Undo: reveal polygon") | — | Lurker gone; `fog-undo` `data-depth` −1 |
| 5 | Drag Goblin 2 slowly from (12, 8) to (11, 6), drop | — | B, C: nothing while in fog; it appears at (11, 6) on the drop |
| 6 | Drag Goblin from (12, 6) to (16, 6), drop | — | B, C: glides to the fog edge, vanishes on the drop; no player frame shows it in a fogged cell |
| 7 | Hide, Rectangle over (0, 3)–(7, 11) | B drags Mira to (5, 5) | B, C still see Mira and Thorn (owned); B's move accepted |
| 8 | Start "Ambush at the Ford"; Reveal all; Fog all (confirm); Undo | — | After Start, B, C Initiative: Mira, Thorn, Goblin 2 (Goblin fog-hidden; Wolf, Elite hidden). Reveal all → Goblin's row and token in one event. Fog all → Goblin, Goblin 2 leave map and Initiative. Undo → back |
| 9 | Reveal a rect while B is dropped (Probes "drop connection") | B back | B: banner, then the revealed tokens, no reload |
| 10 | Hard-kill server; restart | All rejoin | Fog, undo depth and visibility as before; Undo works |
| 11 | *(after both client slices; bundle `fog-scn`)* Reveal a rect over (15, 1)–(19, 13) | B places a template in fog | Barrel, Trap and the door appear for B, C on the reveal, not before; B's template visible to A, B, C throughout. No leak string in B, C frames in any step; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [scenes-map](scenes-map.md) | Registries + call sites (FR-FOG-24), size refresh runs token hooks, token fn consults `hides`, `drag.ts` consults `dragToDm`, `fog` layer slot 30, overlay line | complete; settled S3, S6 |
| [scene-tools](scene-tools.md) | Window ADR covering `token` (`fix/active-scene-window`, before both cores); canvas core + `canvas-tools.ts` (stage dispatch, Space pan, BO3); props / templates with `fogged`, uncut cells, `placedByPlayerId` (templates), `derive` calls, `hides`; door flag (OQ-SCN-06); `scn-props`, `scn-templates` | spec in parallel |
| [live-sync](live-sync.md) | Scene gate for `fog`; `audience` read access (FR-SYNC-28) | complete |
| [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md) | Every hidden copy via `tokenHiddenForPlayers` (FR-FOG-14) | complete; amended per OQ-FOG-07 (decided #196) |
| [effect-modifiers](effect-modifiers.md) | Nothing: OQ-FOG-04 decided (B) (#196); presets stay in the snapshot (#190) | complete; unchanged |
| [fixtures-adapters](fixtures-adapters.md) | Units + bundles `fog`, `fog-scn`; ripple (FR-FOG-25) | complete |

**Registries** (same table in scene-tools; AGENTS §9.9 additions by the integrator)

| Registry | Path | Created by | Who appends |
|---|---|---|---|
| Scene visibility hooks | `src/server/features/scenes-map/visibility-hooks.ts` | `fix/fog-core` | fog (`derive`, `hides`, `dragToDm`); SCN calls `deriveSceneObject`, consults `hides` |
| Scene lifecycle hooks | `src/server/features/scenes-map/scene-hooks.ts` | `fix/fog-core` | fog (`created`, `duplicated`, `deleting`); SCN (`duplicated`, `deleting`) |
| Move guards | `src/server/features/scenes-map/move-guards.ts` | `fix/scn-core` | SCN (walls / doors) |
| Canvas tools | `src/client/common/features/scenes-map/canvas-tools.ts` | `fix/scn-core` | SCN tools; fog's Fog tool |

**Shared changes** (builders report `shared change needed:` per AGENTS §9.9)

| Path | Change | Slice |
|---|---|---|
| ★ `src/server/db/` (schema lock; one core at a time) | `scene_fog`, `scene_fog_edit`, `token.fogged` | 1 |
| `src/shared/events/fog-of-war.ts` | `FogEdited`, `FogUndone` | 1 |
| `src/server/features/scenes-map/` (cross-feature lock) | Both registries (empty); `derive` call sites; size refresh runs token hooks; `tokenVisibility` consults `hides`; `drag.ts` consults `dragToDm` (incl. `end` rule); `sceneHooks` run in create / duplicate / delete; exports | 1 |
| Record-type registry, feature list, `fixtures/bundles/index.ts` | `fog` type; `fogOfWar`; bundles `fog`, `fog-scn` | 2, 5 |
| `canvas-layers.ts`, `token-overlays.ts`, SCN's `canvas-tools.ts` | `fog` layer (30), `fog` overlay line, Fog tool line | 3 |
| `combat-tracker/` (`lifecycle.ts`, token hook), `combat-extras/` (`add-combatants.ts`, `bind-token.ts`, effect copy) — combat lock, one at a time with SCN's `build/scene-tools-settings` | FR-FOG-14 | 4 |
| Ripple: `fixtures/units/scenes-map/{town,battlemap,scenes-extras}.ts`; the test helpers and harness in FR-FOG-25 | Reveal after create; re-baselines | 4 |
| Docs | data model, protocol (§5 `fog`, intents, events, registries, CON-44 row), glossary (OQ-FOG-16) | consolidation |

**Build slices** (after DM gate 2). Order: SCN `fix/active-scene-window` → `fix/fog-core` → `fix/scn-core` → fog 2 ∥ SCN slices → fog 3 → fog 4; every intermediate `main` is neutral for players (BO1).

| # | Branch | Contents | Players see |
|---|---|---|---|
| 1 | `fix/fog-core` (M) | Schema, events, empty registries + scenes-map call sites, `fog` record type, codec + raster | nothing new |
| 2 | `build/fog-server` (M) | Commands, undo, `derive` + `deleting` / `duplicated` lines, fixtures `fog-ambush*`, bundle `fog`, command / crash tests | nothing new (`fogged` written, nothing hidden) |
| 3 | `build/fog-client` (L), after `fix/scn-core` | DM render, Fog tool + gestures, overlay badge | nothing new (DM-only render) |
| 4 | `build/fog-visibility` (M), last | `hides` + `dragToDm` + `created` lines, player render, FR-FOG-14 combat sites, ripple, leak / CON-44 tests, e2e, walkthrough 1–10 | fog |
| 5 | with SCN's last client slice (S) | `fog-scn` fixture + bundle, SCN-subject leak tests, walkthrough step 11 | — |

## 15. Open questions

All decided at DM gate 2 (#196, "go with picks") unless marked for the integrator.

| ID | Question | Decision | Blocking? | Affects |
|---|---|---|---|---|
| OQ-FOG-01 | Scope | **Decided (#196):** as §2: rect + polygon, reveal / hide, Reveal all, Fog all, Undo; no brush | — | — |
| OQ-FOG-02 | Default for a new scene | **Decided (#196):** fully fogged; the DM reveals | — | ripple (FR-FOG-25) |
| OQ-FOG-03 | Who sees owned tokens under fog | **Decided (#196):** every player (`hides` the same for every player; combat copies one flag; `"all" \| "dm"` routing kept). Rejected: owner only, nobody | — | scenes-map, combat, ADR-0033 |
| OQ-FOG-04 (= OQ-SCN-01) | CON-44 (§12, measured) | **Decided (#196): (B) token window + SCN active-scene window** (676,257 B, 110,175 B left; `fix/active-scene-window` first). Rejected: (A) presets on demand, (C) raise the ceiling | — | scene-tools, live-sync, protocol CON-44 |
| OQ-FOG-05 | Fog geometry | **Decided (#196):** cell mask, run-length; diagonals stepped | — | — |
| OQ-FOG-06 | Polygon snap | **Decided (#196):** grid corners | — | — |
| OQ-FOG-07 | Fog-hidden monsters in combat | **Decided (#196):** fog-hidden counts as hidden for every combat copy (FR-FOG-14; combat-tracker, combat-extras amend) | — | combat-tracker, combat-extras |
| OQ-FOG-08 (= OQ-SCN-08) | Undo for scene editing | **Decided (#196):** both: fog server per-scene stack (depth 20, persisted, no redo) and SCN client inverse intents; ADR-0016's "not scene edits" amended (fog-visibility ADR accepted) | — | ADR-0016, glossary |
| OQ-FOG-09 | The map image is downloaded whole | **Decided (#196):** accepted; fog hides records, not pixels | — | assets-pipeline |
| OQ-FOG-10, -11, -12, -15 | Registries, layers, SCN subjects, core order | **Decided (seams S2, S3, S5, S6, review rulings; confirmed #196):** §14 registry table; layer order FR-FOG-20; subjects FR-FOG-10/11; doors OQ-SCN-06; `fix/active-scene-window` → `fix/fog-core` → `fix/scn-core` | — | scene-tools |
| OQ-FOG-13 | Camera fit | **Decided (#196):** no change | — | scenes-map |
| OQ-FOG-14 | When a subject counts as under fog | **Decided (#196):** every footprint cell fogged | — | scene-tools |
| OQ-FOG-16 | Glossary | Integrator: **Fog** → "Cells of a scene hidden from players, drawn by the DM; what lies wholly under it is filtered server-side"; add **Fog-hidden**, **Reveal all / Fog all**, **Canvas layer** (with SCN); **Undo** → one row covering combat (log entries), fog (server stack) and scene drawing (client inverse intents) | no · integrator | glossary |
| OQ-FOG-17 | Fog colours | **Decided (#196):** placeholder `fog.dm` / `fog.player` until theme-system | — | visual-direction |
| OQ-FOG-18 | Ripple | **Decided (#196):** reveal after create in units and test helpers; one undo entry per rippled scene accepted | — | fixtures, tests |
| OQ-FOG-19 | Numbers | **Decided (#196):** ≤ 1 s, 2,000 runs, 64 vertices, undo 20, DM alpha 50 % | — | — |

## 16. Out of scope

- Vision, lighting, line of sight, fog by walls ([ADR-0007](../architecture/adr/0007-product-scope.md)); exploration memory; brush; player fog tools; fogged map images (OQ-FOG-09).
- Layers, walls, doors, props, AoE templates, the active-scene window itself → [scene-tools](scene-tools.md).
