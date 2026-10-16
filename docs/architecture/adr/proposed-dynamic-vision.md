# Proposed — Dynamic vision: freeform fog layers, darkvision and magical darkness

- Status: proposed. **Direction decided by the DM (decisions #201, #202, 2026-10-16)**; the sprint-3 vision spec agent fills in Options / Decision details; the integrator numbers it when the DM accepts it at sprint-3 gate 1
- Date: 2026-10-16
- Supersedes (part): [ADR-0007](0007-product-scope.md) Out "Dynamic lighting / vision" → **vision (sight radius, darkvision, walls blocking sight) is in; dynamic lighting (light sources, colour, shadows) stays out** unless the DM adds it
- Refines: [ADR-0039](0039-fog-visibility.md) (fog visibility: server-written `fogged` copies), [ADR-0040](0040-token-move-guards.md) (walls now also block sight)
- Affects: [fog-of-war](../../specs/fog-of-war.md), [scene-tools](../../specs/scene-tools.md), [character-sheet-full](../../specs/character-sheet-full.md), [scenes-map](../../specs/scenes-map.md), [live-sync](../../specs/live-sync.md) (CON-44, per-player visibility), [combat-tracker](../../specs/combat-tracker.md)

## Context

- Sprint 2 shipped static, cell-based fog (FOG): the DM reveals / hides grid cells; records wholly under fog are filtered server-side through a `fogged` copy that is the same for every player.
- The DM's campaign needs (#201): freeform fog drawn with tools (grid snap by default, free with Ctrl); per-player vision with a darkvision radius that pierces fog; three fog kinds; magical darkness that blocks vision unless a character can see through it (e.g. Devil's Sight), a big part of the campaign. Walls are drawn freeform too (Ctrl) and should block sight.

## Decided by the DM (not open)

| Topic | Decision |
|---|---|
| Shapes | Fog and darkness are **freeform shapes** (polygon / rectangle / circle drawing tools); vertices **snap to the grid unless Ctrl is held**. Drawing tools over cell toggles |
| Fog kinds | **Fog** (hides the map and everything on it until in a player's vision; returns when vision leaves), **Explored** (map visible, records on it not visible: RTS-style memory), **Magical darkness** (DM places ad hoc; blocks all vision for players) |
| Explored layer | A per-map setting: explored memory on / off for the whole map (dungeons on, open spaces off) |
| Vision | Each player's characters have a **vision / darkvision radius** that pierces fog (dynamic: recomputed as tokens move) |
| Darkness | A character-sheet setting "sees through magical darkness". Can't see through and standing inside darkness → the player's whole screen is dark (own tokens and grid only, like fog all). Can see through → the darkness shape is a darker, more transparent overlay than Explored |
| Walls | Freeform wall drawing with Ctrl (grid-snapped otherwise); dragging a token over a wall highlights that wall red for the player before the drop |

## Open for the spec agent (options + pick for gate 1)

- Visibility computation: per-player server-side (records filtered per player: breaks ADR-0039's "same for every player" `fogged` copy) vs per-player client render + server filter by a coarser rule; cost per token move with many walls (visibility polygon algorithm, cache).
- Do walls block sight (line of sight) and therefore vision? (DM's wording implies vision radius + fog; walls blocking sight is the natural reading: confirm.)
- Shared party vision vs each player sees only their own characters' vision.
- Explored memory: per player or per party; persisted where; reset.
- Snapshot / wire cost (CON-44) and live-update rate while dragging.
- Dependency for geometry (e.g. a visibility-polygon / polygon-clipping library) → needs the DM's OK (AGENTS §3).

## Consequences (expected)

- fog-of-war is re-specified (FOG v2): migration from the cell mask to shapes.
- Visibility filter becomes per player for fog subjects; leak tests per player.
- character-sheet-full gains vision fields; scene-tools walls gain sight-blocking and freeform drawing.
