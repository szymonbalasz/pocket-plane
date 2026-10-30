# 0076 — Explored memory as exact shapes, merged with `polygon-clipping`

- Status: accepted (DM, 2026-10-31)
- Date: 2026-10-31
- Supersedes: [OQ-FOG-29](../../specs/fog-of-war.md#15-open-questions) and the "Dependency" note of [ADR-0047](0047-party-vision.md), for the explored shape only: sight stays hand-rolled (sweep, no union)
- Amends: [FR-FOG-37](../../specs/fog-of-war.md#6-functional-requirements)
- Consistent with: [ADR-0016](0016-domain-events-pending-actions.md) (written in the move's transaction), [ADR-0021](0021-sync-protocol-conventions.md) (the client never recomputes), [ADR-0039](0039-fog-visibility.md)
- Affects: [fog-of-war](../../specs/fog-of-war.md), [data model](../../data-model/README.md), [protocol](../../protocol/README.md)

## Context

- Explored memory stored whole cells: a cell whose centre was in sight stayed visible, all of it. A wall crosses cells, so players kept seeing the part behind it, such as the floor behind a door, once they had looked at the other side. Live sight was never affected: its polygons stop at the wall.
- The DM's walls are mostly hand-drawn straight lines, slightly off-axis. Maps are around 40 × 40; larger ones should work.

## Options

Measured with a token walking every map, using the real sight code; `bun` and Chromium on the DM's machine. Saved size per player, slowest update:

| Map | ⅛-cell squares | Exact shape |
|---|---|---|
| The DM's 3 real scenes (largest 39 × 22) | 1.8 KB | 1.9 KB, 5 ms |
| Hand-drawn 40 × 40 (3 layouts) | 3–7 KB, ≤ 14 ms | 2–4 KB, ≤ 8 ms |
| Hand-drawn 120 × 120 | 26 KB, 31 ms | 25 KB, 16 ms |
| 2,000 random wall pieces on 120 × 120 | 100 KB, 60 ms | stops growing at the cap |

| Option | Pros | Cons |
|---|---|---|
| A. Only cells wholly in sight | One rule, no storage change | Cells cut by a wall go black after the player leaves, often with the wall itself |
| B. Finer squares (¼ to 1/16 cell) | Predictable on any map | Overshoot of half a square remains (¼: about a wall's width past the line); stair-step edges; 1/16 costs 89 KB per move on 120 × 120 |
| **C. One exact shape per (scene, player)** | No overshoot, smooth edges, no box to rebase; as small as ⅛ squares on hand-drawn walls | A geometry dependency; a very cluttered map reaches the cap |

## Decision

**C**, with `polygon-clipping` 0.15.7 (MIT, 368 KB on disk, server only; the client just draws). `polyclip-ts` was about 10 × slower with no advantage.

- **Shape:** polygons → rings (outline, then holes) → flat `[x, y, …]`, grid units, 2 decimals, no closing vertex.
- **Only real growth writes.** A sight polygon joins through `difference` first, and only pieces that aren't noise are merged (area ≥ 0.01 cell², mean width ≥ 0.02 cell). Without this, rounding changed the stored shape on 77–100 % of repeat moves, and every change resends the row. With it, re-walking seen ground on the DM's scenes wrote 0 of 144 times.
- **Specks are dropped:** holes and pieces under 0.05 cell² or hairline-thin. They would draw as faint cracks.
- **A refused merge** is retried once on a 0.05-cell grid, then that polygon is skipped with a `warn`. The row stays; sight is not affected.
- **Cap: 5,000 vertices**, about 70 KB. At the cap the memory stops growing and no merge is tried. On the worst map (2,000 random pieces), merges stayed ≤ 53 ms up to 5,000 vertices, but failed mostly and reached 3.4 s above it. Hand-drawn 120 × 120 stayed under 3,000.
- **Client:** draws without the library. Each row clips separately for "not in this shape"; outlines and holes are wound against each other so several rows (View as Party) fill as a union.
- **Old rows** convert at start (`explored-shape-upgrade.ts`): whole cells stay explored, so no player loses progress, and the old see-through patches stay until **Forget explored**. New table `fog_explored_shape`; the old `fog_explored` is left empty and goes away at the first release migration, because `push` runs before the conversion and would otherwise drop its data.

## Consequences

- `fog-explored` wire record: `{id, sceneId, playerId, shape}` replaces `box` and `runs`.
- Bounds: `fog-explored` in the heavy snapshot ≤ 8 KiB (was 6), View-as ack ≤ 128 KiB (was 48), View as Party ack ≤ 640 KiB (was 192). Server → client frames have no size limit; the snapshot ceilings stand.
- The whole row still goes out on each real growth: at most about 25 KB on a hand-drawn 120 × 120. Sending only the new part is possible later without changing storage.
- FR-FOG-44's memory test reads the point at each cell centre in the shape.
- A map traced with thousands of tiny wall pieces can hit the cap; the row keeps what it has, and live sight keeps working.
- `polygon-clipping`'s last release was 2023-12. It is one call site (`memory-shape.ts`), so swapping it is cheap.
