import { afterEach, expect, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { SCENE_TYPE, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { footprintSide, screenFootprint, tokenScreenBoxes } from "./token-boxes";

/** A drawn `map-token` group: its origin (top-left cell corner) and a client rect that also
 * holds the name label and badges (wider and taller than the footprint). */
const node = (id: string, x: number, y: number, scale: number) => ({
  id: () => id,
  getAbsolutePosition: () => ({ x, y }),
  getAbsoluteScale: () => ({ x: scale, y: scale }),
  getClientRect: () => ({ x: x - 30, y: y - 6, width: 400, height: 400 }),
});

const SIZES = ["tiny", "medium", "large", "huge", "gargantuan"] as const;

function store(): RecordStore {
  const s = emptyStore();
  const tokens = Object.fromEntries(
    SIZES.map((size) => [`t-${size}`, { id: `t-${size}`, sceneId: "s1", size }]),
  );
  return {
    ...s,
    records: { [TOKEN_TYPE]: tokens, [SCENE_TYPE]: { s1: { id: "s1", gridCellSize: 70 } } },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("FR-SHELL-57 footprint rule: tokenScreenBoxes footprint = position + cells × cell px for tiny, medium, large, huge and gargantuan tokens (name label and badges excluded; no child-index read)", () => {
  const scale = 0.6; // on-screen cell 42 px
  const nodes = SIZES.map((size, i) => node(`t-${size}`, 100 + i * 200, 50, scale));
  const stage = {
    container: () => ({ isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 48 }) }),
    find: () => [...nodes, node("not-in-store", 5, 5, scale)],
  };
  (globalThis as { window?: unknown }).window = { Konva: { stages: [stage] } };
  const boxes = tokenScreenBoxes("all", store());
  // FR-MAP-14 cells per side: tiny / small / medium 1, large 2, huge 3, gargantuan 4.
  const cells = [1, 1, 2, 3, 4];
  SIZES.forEach((size, i) => {
    const side = (cells[i] as number) * 70 * scale;
    expect(boxes[i]).toEqual({ x: 100 + i * 200, y: 98, w: side, h: side, id: `t-${size}` });
  });
  // Not in the store (no size known): the node's client rect, as before.
  expect(boxes[5]).toEqual({ x: -25, y: 47, w: 400, h: 400, id: "not-in-store" });
  // Without a store every box is the client rect (the toast stack / popup callers).
  expect(tokenScreenBoxes(["t-large"])).toEqual([{ x: 470, y: 92, w: 400, h: 400, id: "t-large" }]);
  expect(footprintSide(store(), "t-huge")).toBe(210);
  expect(footprintSide(store(), "missing")).toBeNull();
  expect(screenFootprint({ left: 10, top: 20 }, { x: 5, y: 6 }, 2, 70)).toEqual({
    x: 15,
    y: 26,
    w: 140,
    h: 140,
  });
});
