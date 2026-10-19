// FR-MAP-53 path visibility, FR-MAP-55 blocked step (sprint 4), FR-MAP-67 trail drawn from the
// stored `trail` (sprint 5; replaces the FR-MAP-54 reducer). The path's cells are tested with
// `dragPath` (`@shared/scenes-map/drag-path.test.ts`).
import { describe, expect, test } from "bun:test";
import { wallHint } from "@shared/scene-tools/geometry";
import type { Segment, Wall } from "@shared/scene-tools/schemas";
import type { TokenView } from "@shared/scenes-map/schemas";
import {
  blockedStep,
  cellsAttr,
  ownDragBlocked,
  pathFootprint,
  pathShown,
  trailCellsAttr,
  trailSegments,
} from "./drag-path";
import { createPreviewStore } from "./drag-preview";

const SCENE = "s-ambush";
const tok = (id: string, col: number, row: number, extra: Partial<TokenView> = {}) =>
  ({
    id,
    sceneId: SCENE,
    col,
    row,
    size: "medium",
    ownerPlayerId: null,
    hidden: false,
    ...extra,
  }) as TokenView;

describe("FR-MAP-53 path visibility", () => {
  test("FR-MAP-53 path visibility: DM / owner / other player × player token / unowned visible / hidden / not in store", () => {
    const mira = tok("mira", 2, 7, { ownerPlayerId: "p1" });
    const sneak = tok("sneak", 4, 9);
    const hiddenWolf = tok("wolf", 9, 9, { hidden: true });
    // What each client holds: players never receive hidden (or fog-hidden) tokens.
    const held = {
      dm: new Map([mira, sneak, hiddenWolf].map((t) => [t.id, t])),
      owner: new Map([mira, sneak].map((t) => [t.id, t])),
      other: new Map([mira, sneak].map((t) => [t.id, t])),
    };
    const role = { dm: "dm", owner: "player", other: "player" } as const;
    const matrix = Object.fromEntries(
      (["dm", "owner", "other"] as const).map((c) => [
        c,
        ["mira", "sneak", "wolf", "ghost"].map((id) => pathShown(held[c].get(id), role[c])),
      ]),
    );
    expect(matrix).toEqual({
      dm: [true, true, true, false],
      owner: [true, false, false, false],
      other: [true, false, false, false],
    });
  });

  test("FR-MAP-53 cells attr and a Large token's footprint per step, each cell once", () => {
    expect(
      cellsAttr([
        { col: 2, row: 7 },
        { col: 3, row: 7 },
      ]),
    ).toBe("2,7 3,7");
    const cells = pathFootprint(
      [
        { col: 4, row: 10 },
        { col: 5, row: 11 },
      ],
      2,
    );
    expect(cellsAttr(cells)).toBe("4,10 5,10 4,11 5,11 6,11 5,12 6,12");
  });
});

describe("FR-MAP-55 blocked step", () => {
  const walls: Wall[] = [[1, 8, 0, 8, 20]];
  const pieceFor = (from: { col: number; row: number }, to: { col: number; row: number }) => {
    const p = wallHint(from, to, 1, walls, []);
    return p ? [p] : [];
  };

  test("FR-MAP-55 blocked index from the hint: Mira (5, 8) → (10, 8) across x = 8 → step 3 (8, 8) on", () => {
    const from = { col: 5, row: 8 };
    const to = { col: 10, row: 8 };
    const pieces = pieceFor(from, to);
    expect(pieces).toHaveLength(1);
    expect(blockedStep(from, to, 1, pieces)).toBe(3);
    // No hint (the cell changed, no wall, a reject) → plain path.
    expect(blockedStep(from, to, 1, [])).toBe(-1);
    // Diagonal: (6, 2) → (9, 5); centres (6.5, 2.5) → (9.5, 5.5) cross x = 8 at t = 0.5 → step 2.
    const d = pieceFor({ col: 6, row: 2 }, { col: 9, row: 5 });
    expect(blockedStep({ col: 6, row: 2 }, { col: 9, row: 5 }, 1, d)).toBe(2);
    // Large (centre + 1): (4, 4) → (8, 4); centres x 5 → 9 cross 8 at t = 0.75 → step 3.
    const big = wallHint({ col: 4, row: 4 }, { col: 8, row: 4 }, 2, walls, []);
    expect(big).not.toBeNull();
    expect(blockedStep({ col: 4, row: 4 }, { col: 8, row: 4 }, 2, [big as Segment])).toBe(3);
  });

  test("FR-MAP-55 DM never blocked; a player's own drag uses the hint", () => {
    const drag = { from: { col: 5, row: 8 }, to: { col: 10, row: 8 }, size: 1 };
    const pieces = pieceFor(drag.from, drag.to);
    expect(ownDragBlocked("dm", drag, pieces)).toBe(-1);
    expect(ownDragBlocked("player", drag, pieces)).toBe(3);
  });
});

describe("FR-MAP-67 trail from the record", () => {
  test("FR-MAP-67 trail drawn from the record: a straight path per cell pair, `cells` attr", () => {
    // Mira (6, 8) → (6, 7) → (8, 5): two segments, each `dragPath` of its pair.
    const trail = {
      cells: [
        [6, 8],
        [6, 7],
        [8, 5],
      ] as [number, number][],
    };
    expect(trailSegments(trail).map(cellsAttr)).toEqual(["6,8 6,7", "6,7 7,6 8,5"]);
    expect(trailCellsAttr(trail)).toBe("6,8 6,7 8,5");
    // Null / absent (outside combat, a player's copy of a monster): nothing drawn.
    expect(trailSegments(null)).toEqual([]);
    expect(trailSegments(undefined)).toEqual([]);
  });

  test("FR-MAP-67 no client trail state: the preview store keeps no trails", () => {
    expect(Object.keys(createPreviewStore().getState()).sort()).toEqual(["local", "previews"]);
  });
});
