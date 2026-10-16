# Proposed — Dynamic vision: freeform fog layers, darkvision and magical darkness

- Status: **proposed**. Direction decided by the DM (decisions #201, #202, 2026-10-16); Options / Decision filled by the sprint-3 vision spec agent (spec-vision); every "pick" below is a **suggested pick for sprint-3 gate 1, not decided**. The integrator numbers it when the DM accepts it
- Date: 2026-10-16
- Supersedes (part): [ADR-0007](0007-product-scope.md) Out "Dynamic lighting / vision" → **vision (sight radius, darkvision, walls blocking sight) is in; dynamic lighting (light sources, colour, shadows) stays out** unless the DM adds it
- Refines: [ADR-0039](0039-fog-visibility.md) (fog copies become per player), [ADR-0040](0040-token-move-guards.md) (guards may return a hint for a dry run; walls also block sight), [ADR-0033](0033-signal-audience.md) (audience may be a player list), [ADR-0041](0041-active-scene-window.md) (`fog` joins the window), [ADR-0021](0021-sync-protocol-conventions.md) / FR-SYNC-19 (identical upserts dropped per connection)
- Affects: [fog-of-war](../../specs/fog-of-war.md) (FOG v2), [scene-tools](../../specs/scene-tools.md), [character-sheet-full](../../specs/character-sheet-full.md), [scenes-map](../../specs/scenes-map.md), [live-sync](../../specs/live-sync.md) (CON-44, per-player visibility), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [campaign-management](../../specs/campaign-management.md), [protocol](../../protocol/README.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)

## Context

- Sprint 2 shipped static, cell-based fog (FOG): the DM reveals / hides grid cells; records wholly under fog are filtered server-side through a `fogged` copy that is the same for every player.
- The DM's campaign needs (#201): freeform fog drawn with tools (grid snap by default, free with Ctrl); per-player vision with a darkvision radius that pierces fog; three fog kinds; magical darkness that blocks vision unless a character can see through it (e.g. Devil's Sight), a big part of the campaign. Walls are drawn freeform too (Ctrl) and should block sight; a dragged token highlights the wall in its way (#202).
- Visibility fns may read only the record and the viewer (ADR-0021). Players never receive walls (FR-SCN-14). The heavy DM snapshot is 676,045 B of 786,432 B (measured, FOG §12).

## Decided by the DM (not open)

| Topic | Decision |
|---|---|
| Shapes | Fog and darkness are **freeform shapes** (polygon / rectangle / circle drawing tools); vertices **snap to the grid unless Ctrl is held** |
| Fog kinds | **Fog** (hides the map and everything on it until in a player's vision; returns when vision leaves), **Explored** (map visible, records on it not visible: RTS memory), **Magical darkness** (DM places ad hoc; blocks all vision for players) |
| Explored layer | A per-map setting: explored memory on / off for the whole map |
| Vision | Each player's characters have a **vision / darkvision radius** that pierces fog (dynamic: recomputed as tokens move) |
| Darkness | Sheet setting "sees through magical darkness". Can't see through and standing inside darkness → the player's whole screen is dark (own tokens and grid only). Can see through → a darker, more transparent overlay than Explored |
| Walls | Freeform wall drawing with Ctrl; dragging a token over a wall highlights that wall red before the drop |

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

**5. CON-44** (measured, FOG §12)

| Option | Heavy DM | Left |
|---|---|---|
| A. `fog` not windowed (+ explored + vision preview) | 720,091 | 66,341 (30 rows at the 16 KiB cap: 1,168,928, over) |
| **B. `fog` flagged `dmWindow: "active-scene"` (+ explored + vision preview)** | **684,626** | **101,806** |
| C. Windowed, no DM preview | 673,947 | 112,485 |

**6. Wall highlight for players** (players have no walls): **A. dry run `map.checkMove` (scenes-map) returning the wall guard's crossed pieces, clipped to 0.5 cell** · B. send walls to players (contradicts FR-SCN-14) · C. send walls a player has seen.

## Decision

**Proposed picks** (for gate 1): 1 **A**, 2 **A**, 3 **A**, 4 **B**, 5 **B**, 6 **A**; plus own-character vision (OQ-FOG-20 A), walls + doors not open block sight (OQ-FOG-21 / -24 A), per-player explored memory in the DB (OQ-FOG-22 A), two radii (OQ-FOG-23 B), vision on drop only (OQ-FOG-26 A).

| Contract | Rule (if accepted) |
|---|---|
| Copies | `seenBy` (server only) on token, prop, AoE template; `doorSeen` on structure; `fogged` = seen by nobody, DM wire only |
| Order in `map.moveToken` | guards → `derive` → one write → **re-derive dependants** (other subjects' `seenBy`, the owner's explored memory and `vision`) → token-changed hooks for every token whose party-level hidden flips → one `TokenMoved` |
| Registries (scenes-map) | `visibility-hooks.ts`: `derive → {fogged, seenBy}`, `hides(type, record, viewer)`, `dragAudience → playerId[]` (replaces `dragToDm`), new `rederive`; `move-guards.ts`: a guard may return a `hint` for `map.checkMove` (still read-only) |
| Sync | FR-SYNC-19: `visible → visible` with identical wire data for that connection → nothing (stateless before / after compare); FR-SYNC-28: audience `"all" \| "dm" \| {players}`; derived record types (snapshot computes, commands list before / after); `fog` windowed |
| Cache | `(sceneId, playerId)` → polygons, keyed by fog `rev`, structure `rev`, sources; LRU 256; never authoritative |

## Consequences

- fog-of-war is re-specified (FOG v2) with the cell mask kept as the base; scene-tools gains decimal segments, sight occluders and the wall hint; character-sheet-full gains `statBlock.senses`.
- Visibility becomes per player for fog subjects; leak tests run per player and after `resync`; convergence per player.
- Build: one core branch `fix/vision-core` (schema + ws + MAP locks: columns, backfill, registry members and call sites, ws changes, `senses` zod, shared geometry with a benchmark), then FOG / SCN / CHARX slices (FOG §14).
- Combat specs: no FR change under pick 4B; the meaning of `tokenHiddenForPlayers` is restated. Campaign-management: a player create / delete line re-derives that player's membership.
- Protocol: `fog` record shape + `dmWindow`; new `fog-explored`, `vision` record types; darkness / explored events and intents; `map.checkMove`; audience lists; CON-44 row. Glossary per OQ-FOG-42.
- Accepted leaks: the map image; the active scene's fog / darkness geometry; party tokens; party-level combat rows (4B); wall pieces inside one's own sight and ≤ 1 cell per drag crossing.
