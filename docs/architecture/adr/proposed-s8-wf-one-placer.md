# One placer for every window path: PCs first, then shrink, then put away

- Status: accepted (DM gate, #335)
- Date: 2026-10-21
- Extends: [ADR-0025](0025-play-shell-windows.md) (registry + browser layout stay; this fixes **how** the shell places windows). Layouts stay browser-only (#121).
- Supersedes (placement means only; the outcomes they fixed stay): the separate placers behind [FR-SHELL-29](../../specs/play-shell.md#6-functional-requirements) (written shrinks), -47, -53 (live follow), -55 (push right), -56 (5) (protected reopen moves), -77 / -78 / -79 (folded in as the ladder), -81 (generalised to displacement memory). Amends #245's token-aware Initiative at Start (OQ-SHELL-63 A, #335).
- Raised by: DM [#333](../../decisions-log.md) (one placement path, proven by a session-replay harness; "at small screens PCs stay clear first, then windows shrink, then the least recently used launcher window is put away"), [#334](../../decisions-log.md) (BL-52, -53, -59, -60, -61, -64, -65, -66, -70), #318 (only player characters count as PCs).
- Affects: [play-shell](../../specs/play-shell.md) FR-SHELL-95–119, [scenes-map](../../specs/scenes-map.md) FR-MAP-93–98, [notifications](../../specs/notifications.md) FR-NOTE-50–53, [stats](../../specs/stats.md) FR-STATS-66–67, [character-sheet-full](../../specs/character-sheet-full.md) FR-CHARX-83; tracks TT, SB, CB register through FR-SHELL-112.

## Context

Five paths place or size windows today, each fixed in a different sprint (code read, sprint 8):

| Path | Code today | Knows PCs? | Writes? | Breaks |
|---|---|---|---|---|
| Auto placement on open / appear / settle | `manager.ts` `autoPlace` → `placement.ts` `placeWindow` | yes (`isPlacementPc`) | yes | BL-64, BL-66, BL-70 |
| Reopen | `manager.ts` `isReopenCovered`, `clearAround` (bare `placeWindow`, no floor) | partly | yes | shrinks protected windows to min |
| Tool-bar push + return | `manager.ts` `pushWindows`, `belowBar`, `returnPushed`; `ToolRail.tsx` push on rect change only | **no** | yes | BL-61, BL-52 |
| Viewport resize | `geometry.ts` `fitRect` (render-only) + `manager.ts` `followDefaults` (bare `placeWindow`, no tokens, no floor) | **no** | yes (shrinks) | BL-60 (Game log stuck at its 300×160 min) |
| Reveal / load / Start refits | `MapCanvas.tsx` `fitNow` → `camera.ts` `fitScene` / `pcsPan` | its own PC rule (`ownerPlayerId`, pets count) | camera | BL-65 (`pcsPan` re-scales up to 48 px: zooms in) |

Each path has its own inputs, its own idea of "PC" and of "written vs render-only", and nothing grows a shrunk window back.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One pure placer `settle(world, trigger) → plan` that every path calls; one ladder (PCs clear → shrink to useful → put away the LRU launcher window → below useful → least PC area); protected windows keep their zones; the camera refits after the placer from the plan's rects** | One rule, one PC definition, one set of inputs; testable as a pure function over real session states (the harness); grow-back and returns fall out of "displacement memory" | One frame rewrite (core slice); goldens move once |
| B. Keep five paths, add the PC rule and grow-back to each | Smaller diffs | The sprint-4–7 pattern: each fix breaks another path; no single harness target |
| C. Constraint solver over the whole layout on every change | Globally best layouts | Windows jump on any change; opaque; a dependency or a big hand-rolled solver |

## Decision

**A** (accepted, DM gate #335, with OQ-SHELL-58 A, -59 A, -60 B, -61 A, -62 A, -63 A, -64 B, OQ-MAP-63 A).

1. **One entry point.** `settle(world, trigger)` in `play-shell/placer.ts`, pure and deterministic. Triggers: `load`, `open`, `reopen`, `appear` (incl. Start), `settle` (measured height), `viewport`, `push`, `return`, `drag-end`, `reset`. The manager applies the plan, and the canvas refits from it. No other code writes window geometry, except a user's own move or resize.
2. **One ladder** = [FR-SHELL-97](../../specs/play-shell.md#6-functional-requirements) exactly. For any window the trigger must place, in order:
   1. **L1** target size, accepted (clear of windows and hard keep-outs, PC footprint + 4 px clear).
   2. **L2** shrink it down to its **useful size**, then squeeze protected windows down to theirs (OQ-SHELL-59 A).
   3. **L2b** (OQ-SHELL-64 B: players, camera `fitted`): the map yields if every PC stays clear at ≥ 75 % of the last full fit's cell.
   4. **L3** put away the least recently used launcher window when a look-ahead says that helps, then restart.
   5. **L4** below useful, down to min.
   6. **L5** least PC area, flagged.

   #333 says "PCs clear, then shrink, then put away". "Not below their useful size unless nothing else works" is [sprint-8](../../agents/sprint-8.md)'s wording; the DM confirmed it as the reading of #333 (#335). PC = a player character's token footprint + 4 px (#318), the same definition for the camera.
3. **Zones.** Protected (default-open) windows sit at their named default rect for the current viewport, unless the user moved them or the rect covers a PC at the current camera (then the ladder, zone first). Launcher windows are placed around them. The map refits so tokens come out from under them (as Reset layout, FR-SHELL-80).
4. **Least movement.** A trigger moves only the windows it displaces or that break an invariant. Ties prefer the window's previous rect.
5. **Displacement memory.** A window moved, shrunk or put away by a transient cause (a tool bar, a smaller viewport) remembers its rect in client memory. When the cause goes, it returns if the user didn't touch it and the spot is clear. Without memory (after a reload), a shell-sized window grows toward its target size.
6. **Written vs render-only.** Shell placements are written with `area`. A user spot (`userSpot`) and a user size (new optional `userSize`) are never moved or resized by the placer; they only get the render-only fit and clamp. The exceptions are a hard keep-out (a tool bar pushes), a **zone** (a launcher window in a protected window's zone moves, and returns when the cause ends), and the rail clamp.
7. **Registration** for other features (seams S1–S5, S12):
   - windows: registry line + size-table row incl. useful size;
   - overlays: new append-only `overlays.ts`, not placed; `blocksInput` queues settles;
   - top-bar items: new `top-bar-items.ts`; the top bar stays 48 px;
   - chrome keep-outs: new `chrome-keep-outs.ts`, a hard keep-out + fit obstacle;
   - toasts: a notification kind + toast class, or a callout.

## Consequences

- One new optional stored field (`userSize: true` on `WindowState`, browser only; old entries parse; 0 B on the wire, CON-44 unchanged).
- The session-replay harness (FR-SHELL-114–116) is the acceptance test. It replays real fixture states, at four sizes, for DM and player, through every trigger. Goldens are regenerated once in the core slice.
- `layout-checks.ts` stays an independent oracle (brute force), never the placer's code.
- Later window types need only the registry and size-table rows. A feature that wants a strip or a pinned panel registers a chrome keep-out instead of special-casing the placer.
- Revisit if the harness can't keep PCs clear at 1280×720 with the useful-size table the DM picks: that would mean the table, not the placer, needs to change.
