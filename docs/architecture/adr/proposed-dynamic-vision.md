# 0042 — Dynamic vision: freeform fog layers, darkvision and magical darkness

- Status: accepted (#207, 2026-10-16). Direction decided by the DM (#201, #202); every pick accepted at sprint-3 gate 1 (#207); DM snapshot ceiling raised to 1 MiB (#208); Invisible token state + Sees invisible sense added (#210). File keeps its proposed name; the integrator renames it to `0042-dynamic-vision.md` at merge
- Date: 2026-10-16
- Supersedes (part): [ADR-0007](0007-product-scope.md) Out "Dynamic lighting / vision" → **vision (sight radius, darkvision, walls blocking sight) is in; dynamic lighting (light sources, colour, shadows) stays out** unless the DM adds it
- Refines: [ADR-0039](0039-fog-visibility.md) (fog copies become per player; `tokenHiddenForPlayers` = `hidden || fogged`; new scene hook `activated`), [ADR-0040](0040-token-move-guards.md) (guards may return a hint for a dry run; walls also block sight), [ADR-0033](0033-signal-audience.md) (audience may be a player list), [ADR-0041](0041-active-scene-window.md) (`fog` joins the window; a `view-as` window kind and `sync.loadScene {viewAs}`, seams S1), [ADR-0021](0021-sync-protocol-conventions.md) / FR-SYNC-19 (identical upserts dropped per connection)
- Affects: [fog-of-war](../../specs/fog-of-war.md) (FOG v2), [scene-tools](../../specs/scene-tools.md), [character-sheet-full](../../specs/character-sheet-full.md), [scenes-map](../../specs/scenes-map.md), [live-sync](../../specs/live-sync.md) (CON-44, per-player visibility), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [campaign-management](../../specs/campaign-management.md), [protocol](../../protocol/README.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)

## Context

- Sprint 2 shipped static, cell-based fog (FOG): the DM reveals / hides grid cells; records wholly under fog are filtered server-side through a `fogged` copy that is the same for every player.
- The DM's campaign needs (#201): freeform fog drawn with tools (grid snap by default, free with Ctrl); per-player vision with a darkvision radius that pierces fog; three fog kinds; magical darkness that blocks vision unless a character can see through it (e.g. Devil's Sight), a big part of the campaign. Walls are drawn freeform too (Ctrl) and should block sight; a dragged token highlights the wall in its way (#202).
- Visibility fns may read only the record and the viewer (ADR-0021). Players never receive walls (FR-SCN-14). The heavy DM snapshot is 676,045 B of 786,432 B (measured, FOG §12); #208 raises the DM ceiling to 1 MiB (372,531 B left).

## Decided by the DM (not open)

| Topic | Decision |
|---|---|
| Shapes | Fog and darkness are **freeform shapes** (polygon / rectangle / circle drawing tools); vertices **snap to the grid unless Ctrl is held** |
| Fog kinds | **Fog** (hides the map and everything on it until in a player's vision; returns when vision leaves), **Explored** (map visible, records on it not visible: RTS memory), **Magical darkness** (DM places ad hoc; blocks all vision for players) |
| Explored layer | A per-map setting: explored memory on / off for the whole map |
| Vision | Each player's characters have a **vision / darkvision radius** that pierces fog (dynamic: recomputed as tokens move) |
| Darkness | Sheet setting "sees through magical darkness". Can't see through and standing inside darkness → the player's whole screen is dark (own tokens and grid only). Can see through → a darker, more transparent overlay than Explored |
| Walls | Freeform wall drawing with Ctrl; dragging a token over a wall highlights that wall red before the drop |
| Invisible (#210) | Token state **Invisible**, distinct from Hidden, DM-only toggle, not coupled to the condition; sense **Sees invisible**, DM-only to edit. A player gets an invisible token only if one of their sources sees invisible and has it inside its sight polygon; otherwise filtered like a fog-hidden token (`seenBy`). The party still sees invisible PCs. Combat: party-level (4B). DM: faded + "Invisible" badge |
| Snapshot ceiling (#208) | DM 1 MiB, players 512 KiB; the ≥ 100 KiB headroom guard dropped; tests assert under the ceiling + per-type bounds; `SNAPSHOT_CEILING` and protocol CON-44 change in V0 |

## Options

**1. Where per-player visibility is computed**

| Option | Pros | Cons |
|---|---|---|
| **A. Server-written per-player copies: each fog subject stores `seenBy` (player ids), written by `derive` / re-derive in the writing command's transaction; the server computes each player's sight polygons (cached) and sends them as a derived `vision` record to that player only** | Fns stay pure (record + viewer); the transition matrix gives per-player upsert / delete for free; atomic and crash-safe; walls never leave the server; same pattern as ADR-0039 / ADR-0024 | A source move rewrites `seenBy` on many rows (dropped from frames when the wire data is unchanged); a new player needs a re-derive |
| B. In-memory per-player visible sets read by the filter | No columns | Contradicts ADR-0021; the transition matrix needs the before state; not crash-consistent with the commit |
| C. Client renders vision; server filters by a coarser rule (e.g. static fog only) | Cheap server | Positions of records in fog but outside sight reach players; the client needs walls (FR-SCN-14 leak) |

**2. Geometry** (dependency needs the DM's OK, AGENTS §3)

| Option | Size / licence / maintenance | Fit |
|---|---|---|
| **A. Hand-rolled** in `@shared/fog-of-war/vision.ts`: angular-sweep visibility polygon with radius culling, circle as a 64-gon, point-in-shape; exact orientation tests on 1/100-cell integer-scaled coordinates (the move guard's math) | ~300 lines + property tests vs brute-force rays; no dependency; Bun + browser | Exactly the design's needs: no union / clipping is needed (canvas compositing draws holes; explored memory is cells) |
| B. `visibility-polygon` 1.1.0 | MIT, 5.5 KB min, 0 deps, ESM + CJS + types; last release 2020 (4 versions), floating point | Saves ~1 day; collinear / endpoint robustness is ours to test; no darkness or radius support built in |
| C. `martinez-polygon-clipping` 0.9.0 (MIT, ~11 KB, deps splaytree / tinyqueue / robust-predicates, released 2026-09-30) or `polygon-clipping` 0.15.7 (MIT, 29 KB UMD min, last release 2023-12) or `polyclip-ts` 0.16.8 (MIT, 42 KB, bignumber.js) | Polygon union / intersection | Only needed if explored memory or fog shapes became merged polygons (not picked) |

**3. Migration from the cell mask**

| Option | Pros | Cons |
|---|---|---|
| **A. Keep the mask as the base layer; shapes paint over it; legacy `fog.edit` forms map to shapes; boot backfill fills `seenBy` once** | No data rewrite; byte-identical player views; fixtures unchanged | Two representations (mask + shapes) in one record |
| B. Convert masks to rectangles | One representation | ≤ 2,000 runs → far over a sane shape cap |
| C. Convert to polygons | Smooth | Needs a union library (2C) |

**4. Combat copies of vision-hidden monsters**

| Option | Pros | Cons |
|---|---|---|
| **B. Party-level: `tokenHiddenForPlayers` = hidden or seen by no player** | No combat code change; one flag | A player may see an Initiative row (no position) for a monster only another player sees |
| A. Per player | Exact | Combatant, effect, outcome-line and rank copies per player: large amendments to two complete specs |
| C. Sticky once seen in the encounter | Matches table talk | New state; still party-level |

**5. CON-44** (measured, FOG §12; re-cut by the sprint-3 seams ruling S1: View-as data on demand; "left" against the 1 MiB DM ceiling of #208)

| Option | Heavy DM | Left of 1 MiB |
|---|---|---|
| A. `fog` not windowed, View-as data (`vision` + `fog-explored` of every player) in the snapshot | 720,091 | 328,485 (30 rows at the 16 KiB cap: 1,168,928, 120,352 over) |
| **B. `fog` flagged `dmWindow: "active-scene"`; `vision` / `fog-explored` flagged `dmWindow: "view-as"`, loaded by `sync.loadScene {sceneId, viewAs}` one player at a time** | **674,186** (today 676,038) | **374,390** |
| C. `fog` windowed, View-as data in the snapshot (pre-seams pick) | 684,626; 708,019 with explored memory at its cap | 363,950; 340,557 |

B's load ack: 1,315–1,810 B per pick, 12,676 B at caps. Lazy record types ([ADR-0045](0045-lazy-record-types.md)) are campaign / global only, so the scene-scope load extends ADR-0041's `sync.loadScene`.

**6. Wall highlight for players** (players have no walls): **A. dry run `map.checkMove` (scenes-map) returning one piece of the first crossed segment from the token, clipped to 0.5 cell either side** (one piece per check, so scripted probing can't map walls behind walls; review A3) · B. send walls to players (contradicts FR-SCN-14) · C. send walls a player has seen.

**7. Darkness geometry to players** (review A5): **B. per-player filtered: each darkness shape has a server-only `seenBy` (its box meets the player's sight, clear / explored area or memory)** · A. the whole `fog` row to every player (every hand-moved darkness tells all players where an unseen caster is).

## Decision

**Accepted** (#207, sprint-3 gate 1): 1 **A** server-written per-player `seenBy` + server vision polygons, 2 **A** hand-rolled geometry (no dependency, G2), 3 **A** cell mask kept as the base layer, 4 **B** party-level combat copies, 5 **B** `fog` windowed + View-as data on demand (under the 1 MiB DM ceiling, #208), 6 **A** dry-run first-crossing wall hint, 7 **B** per-player filtered darkness; plus own-character vision (OQ-FOG-20 A), walls + doors not open block sight (OQ-FOG-21 / -24 A), per-player explored memory in the DB (OQ-FOG-22 A), two radii (OQ-FOG-23 B), vision on drop only (OQ-FOG-26 A), View as in (OQ-FOG-31 A), darkness in the fog undo stack (OQ-FOG-44 A), senses 0–120 ft and ≤ 4 sources per player (OQ-FOG-35); and Invisible + Sees invisible (#210). Rejected options stay above for the record.

| Contract | Rule |
|---|---|
| Copies | `seenBy` (server only) on token, prop, AoE template and each darkness shape; `doorSeen` on structure; `fogged` = seen by nobody for unowned subjects (statically hidden while the campaign has no players), statically hidden for owned tokens (sprint 2's value); DM wire, and the owner on own tokens; the owner is always in its token's `seenBy` |
| Order in `map.moveToken` | guards → `derive` → one write → **re-derive dependants** (other subjects' `seenBy`, the owner's explored memory on the active scene, and `vision`) → token-changed hooks for every token whose party-level hidden flips → one `TokenMoved` |
| Re-derive scope | Scene writes re-derive that scene; campaign-wide writes (senses edit, player added) re-derive the active scene and mark the others `visionStale`, re-derived inside the activation transaction |
| Registries | scenes-map `visibility-hooks.ts`: `derive → {fogged, seenBy}`, `hides(type, record, viewer)`, `dragAudience → playerId[]` (replaces `dragToDm`), new `rederive`; `tokenHiddenForPlayers` re-implemented as `hidden \|\| fogged` (was "any `hides`"); `scene-hooks.ts`: new `activated`; `move-guards.ts`: a guard may return a `hint` for `map.checkMove` (still read-only); new append-only `campaign-management/player-hooks.ts` `added(env, player)` (AGENTS §9.9 at the gate) |
| Can't see | A player intent or signal naming a token they can't see (hidden or fog-hidden) → `not_found` (`map.checkMove`, `map.moveToken`, `map.drag`) |
| Sync | FR-SYNC-19: `visible → visible` with identical wire data for that connection → nothing, per change (an event left empty still goes out, keeping `seq`; stateless before / after compare; supersedes backlog BL-09; full e2e as V0's regression gate); FR-SYNC-28: audience `"all" \| "dm" \| {players}`; derived record types (snapshot computes, commands list before / after); `fog` windowed; second window kind `dmWindow: "view-as"` (never in the DM snapshot; `sync.loadScene {sceneId, viewAs}` returns that player's rows; live events as ADR-0041; convergence on the loaded pair; View as is in, OQ-FOG-31 A) |
| Invisible (#210) | Token column `invisible` (V0, DM-only on the wire, never on a player wire); `fog.setInvisible` (DM, V2) → `TokenInvisibleSet`; an unowned invisible token joins P's `seenBy` only via a sample point inside the sight polygon of a P source with `senses.seesInvisible` (static clear, Explored and memory never count); owned tokens keep the owner + party rule; `fogged` / `tokenHiddenForPlayers` unchanged in form; `vision.inv` lists the Sees-invisible polygons for View as; `seesInvisible` DM-only in `char.edit` |
| Cache | `(sceneId, playerId)` → polygons, keyed by fog `rev`, structure `rev`, sources; LRU 256; entries written only after commit; never authoritative |
| Budget | CPU targets at the true caps (r 24, 2,000 segments, 6 players × 4 sources); V0's benchmark is an exit gate with a fallback (occluders pre-filtered to the radius, fewer sources), else back to the DM. Snapshot: DM < 1 MiB, players < 512 KiB, per-type bounds, no headroom guard (#208) |

## Consequences

- fog-of-war is re-specified (FOG v2) with the cell mask kept as the base; scene-tools gains decimal segments, sight occluders and the wall hint; character-sheet-full gains `statBlock.senses`.
- Visibility becomes per player for fog subjects; leak tests run per player and after `resync`; convergence per player.
- Build: one core branch `fix/vision-core` (schema + ws + MAP locks: columns, backfill, registry members and call sites, ws changes incl. the `view-as` window, `senses` zod, shared geometry with a benchmark), then FOG / SCN / CHARX slices (FOG §14). Slice order V0 → V5 → V1 → (V4 ∥ V2) → V3 (review A10). Sprint order (seams S3): first schema core and first ws holder (then `fix/lazy-records`); canvas V1 → V4 → V3; V5 first on the sheet folder (V5 → R3 → R6 → C2 → D4 → P4 / C4).
- Senses (seams S6): in the creature core zod, 0–120 ft; compendium's adapter fills `darkvisionFt` from SRD text; see-through and Sees invisible default false.
- Invisible (#210): `token.invisible` column + DM-only wire in V0; `fog.setInvisible` + the seeing rule in V2; menu line, faded render and badge in V3; the DM-only Sees invisible switch in V5.
- Combat specs: no FR change under pick 4B; the meaning of `tokenHiddenForPlayers` is restated. Campaign-management: V0 creates the append-only `player-hooks.ts` (`added`, in the REST add transaction); fog's line re-derives the new player's membership. No delete trigger (player removal is out of scope).
- Protocol: `fog` record shape + `dmWindow`; new `fog-explored`, `vision` record types; darkness / explored events and intents; `fog.setInvisible` + `TokenInvisibleSet`, token `invisible` (DM only); `map.checkMove`; audience lists; CON-44 row (DM 1 MiB, #208). Glossary per OQ-FOG-42.
- Accepted leaks (the only exceptions to zero leakage): the map image; the active scene's fog shapes; darkness shapes whose box meets the player's view (7B); party tokens; party-level combat rows and the combatant's `tokenId` (4B; also for an invisible monster another player sees, #210); wall pieces inside one's own sight; one ≤ 1-cell piece of the first wall a drag line crosses and the "something blocks" oracle; event `cause` names for unseen changes (timing).
