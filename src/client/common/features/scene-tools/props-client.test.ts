// Props client logic (FR-SCN-15–18): undo reducer (inverse per op, id remap after a re-place,
// reject drops the entry, per scene, cap 50); Props tool pointer rules (select, move, locked drag,
// corner resize, place with a chosen image, Esc / scene switch); drawing math (cover crop, 90°
// side swap, draw order, DM-only items off).
import { afterEach, describe, expect, test } from "bun:test";
import { SCN_INTENTS as S, type ScenePropRecord } from "@shared/scene-tools/schemas";
import type { SceneView } from "@shared/scenes-map/schemas";
import type { ToolPointer } from "../scenes-map/tools";
import { coverCrop, propFrame, propsToDraw } from "./prop-draw";
import {
  handleAt,
  PROPS_TOOL_ID,
  propPointer,
  publishProps,
  remove,
  setHidden,
  updatePropFields,
  usePropTool,
  zChange,
} from "./prop-tool";
import {
  inverseOf,
  popUndo,
  pushUndo,
  recordUndo,
  remapProp,
  UNDO_MAX,
  type UndoStacks,
  undoLast,
  usePropUndo,
} from "./prop-undo";

const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const SCENE = { id: "s1", ...GRID } as unknown as SceneView;

const prop = (id: string, f: Partial<ScenePropRecord> = {}): ScenePropRecord => ({
  id,
  campaignId: "c",
  sceneId: "s1",
  seq: 1,
  assetId: "barrel",
  col: 5,
  row: 3,
  w: 1,
  h: 1,
  rotation: 0,
  z: 0,
  hidden: false,
  locked: false,
  ...f,
});

/** A fake server: records calls; acks with `{propId}` for place / duplicate (`n` counts up). */
function fakeSend(reject: (name: string) => boolean = () => false) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let n = 0;
  const send = async (name: string, input: unknown) => {
    calls.push({ name, input: input as Record<string, unknown> });
    if (reject(name)) throw new Error(`rejected ${name}`);
    if (name === S.placeProp || name === S.duplicateProp) return { propId: `new-${++n}` };
    return undefined;
  };
  return { send, calls };
}

function pointer(
  cell: { col: number; row: number },
  send: ToolPointer["intent"],
  at?: { x: number; y: number },
): ToolPointer {
  const x = at?.x ?? (cell.col + 0.5) * 70;
  const y = at?.y ?? (cell.row + 0.5) * 70;
  return {
    x,
    y,
    cell,
    vertex: { x: Math.round(x / 70), y: Math.round(y / 70) },
    screen: { x, y },
    button: 0,
    ctrl: false,
    shift: false,
    alt: false,
    clicks: 1,
    client: "dm",
    scene: SCENE,
    grid: GRID,
    intent: send,
    signal: () => {},
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  usePropUndo.setState({ stacks: {} });
  publishProps(null, []);
  usePropTool.setState({ imageId: null, picking: null });
});

describe("FR-SCN-15 prop undo", () => {
  test("FR-SCN-15 inverse per op: place → delete, update → previous fields, hide → flag, delete → re-place (+ restore)", () => {
    expect(inverseOf({ op: "place", propId: "p" }).call).toEqual({
      name: S.deleteProp,
      input: { propId: "p" },
    });
    expect(inverseOf({ op: "update", propId: "p", prev: { col: 5, rotation: 0 } }).call).toEqual({
      name: S.updateProp,
      input: { propId: "p", col: 5, rotation: 0 },
    });
    expect(inverseOf({ op: "hidden", propId: "p", prev: false }).call).toEqual({
      name: S.setPropHidden,
      input: { propId: "p", hidden: false },
    });
    const del = inverseOf({ op: "delete", prev: prop("p", { w: 2, hidden: true, rotation: 90 }) });
    expect(del.call).toEqual({
      name: S.placeProp,
      input: { sceneId: "s1", assetId: "barrel", col: 5, row: 3, w: 2, h: 1, hidden: true },
    });
    expect(del.restore?.("q")).toEqual({
      name: S.updateProp,
      input: { propId: "q", rotation: 90, z: 0, locked: false },
    });
    expect(inverseOf({ op: "delete", prev: prop("p") }).restore?.("q")).toBeNull();
  });

  test("FR-SCN-15 per scene, newest first, cap 50", () => {
    let s: UndoStacks = {};
    for (let i = 0; i < UNDO_MAX + 5; i++) s = pushUndo(s, "s1", { op: "place", propId: `p${i}` });
    s = pushUndo(s, "s2", { op: "place", propId: "other" });
    expect(s.s1).toHaveLength(UNDO_MAX);
    expect(s.s1?.[0]).toEqual({ op: "place", propId: "p5" });
    const { entry, stacks } = popUndo(s, "s1");
    expect(entry).toEqual({ op: "place", propId: `p${UNDO_MAX + 4}` });
    expect(stacks.s1).toHaveLength(UNDO_MAX - 1);
    expect(stacks.s2).toHaveLength(1);
    expect(popUndo({}, "s1").entry).toBeNull();
  });

  test("FR-SCN-15 place, move, delete; Undo, Undo, Undo: the re-placed prop's new id is remapped so the chain works", async () => {
    const { send, calls } = fakeSend();
    // place p1 → move it → delete it (each recorded as the tool does on ack).
    const placed = prop("p1");
    recordUndo("s1", { op: "place", propId: "p1" });
    await updatePropFields(send, placed, { col: 7 });
    await remove(send, { ...placed, col: 7 });
    calls.length = 0;
    expect(await undoLast(send, "s1")).toBe("done"); // re-place → new-1
    expect(await undoLast(send, "s1")).toBe("done"); // move new-1 back
    expect(await undoLast(send, "s1")).toBe("done"); // delete new-1
    expect(await undoLast(send, "s1")).toBe("empty");
    expect(calls).toEqual([
      {
        name: S.placeProp,
        input: { sceneId: "s1", assetId: "barrel", col: 7, row: 3, w: 1, h: 1, hidden: false },
      },
      { name: S.updateProp, input: { propId: "new-1", col: 5 } },
      { name: S.deleteProp, input: { propId: "new-1" } },
    ]);
  });

  test("FR-SCN-15 a re-placed rotated, locked prop gets its rotation, z and lock back", async () => {
    const { send, calls } = fakeSend();
    await remove(send, prop("p1", { rotation: 270, z: 2, locked: true }));
    calls.length = 0;
    await undoLast(send, "s1");
    expect(calls.map((c) => c.name)).toEqual([S.placeProp, S.updateProp]);
    expect(calls[1]?.input).toEqual({ propId: "new-1", rotation: 270, z: 2, locked: true });
  });

  test("FR-SCN-15 a rejected inverse drops its entry (the caller toasts); older entries stay", async () => {
    let undoing = false;
    const { send } = fakeSend((n) => undoing && n === S.setPropHidden);
    recordUndo("s1", { op: "place", propId: "p1" });
    await setHidden(send, prop("p1"), true);
    expect(usePropUndo.getState().stacks.s1).toHaveLength(2);
    undoing = true;
    await expect(undoLast(send, "s1")).rejects.toThrow("rejected");
    expect(usePropUndo.getState().stacks.s1).toEqual([{ op: "place", propId: "p1" }]);
  });

  test("FR-SCN-15 a rejected edit records nothing; an unchanged update sends nothing", async () => {
    const { send, calls } = fakeSend(() => true);
    await expect(updatePropFields(send, prop("p1"), { col: 9 })).rejects.toThrow();
    expect(usePropUndo.getState().stacks.s1 ?? []).toEqual([]);
    calls.length = 0;
    await updatePropFields(send, prop("p1"), { col: 5, rotation: 0 });
    expect(calls).toEqual([]);
  });

  test("FR-SCN-15 remap touches every scene's entries for that id", () => {
    const s: UndoStacks = {
      s1: [{ op: "update", propId: "a", prev: { col: 1 } }],
      s2: [
        { op: "delete", prev: prop("a") },
        { op: "place", propId: "b" },
      ],
    };
    const r = remapProp(s, "a", "z");
    expect(r.s1?.[0]).toMatchObject({ propId: "z" });
    expect(r.s2?.[0]).toMatchObject({ prev: { id: "z" } });
    expect(r.s2?.[1]).toEqual({ op: "place", propId: "b" });
  });
});

describe("FR-SCN-16 / -17 Props tool pointer", () => {
  const tool = () => {
    const errors: unknown[] = [];
    return { p: propPointer((e) => errors.push(e)), errors };
  };

  test("FR-SCN-17 click selects; drag moves by whole cells; release sends scn.updateProp once and records undo", async () => {
    const { send, calls } = fakeSend();
    const barrel = prop("barrel", { col: 5, row: 3 });
    publishProps("s1", [barrel]);
    const { p } = tool();
    p.down(pointer({ col: 5, row: 3 }, send));
    expect(usePropTool.getState()).toMatchObject({ selectedId: "barrel" });
    expect(usePropTool.getState().gesture?.kind).toBe("move");
    p.move(pointer({ col: 7, row: 5 }, send));
    expect(usePropTool.getState().gesture?.box).toEqual({ col: 7, row: 5, w: 1, h: 1 });
    p.up(pointer({ col: 7, row: 5 }, send));
    await flush();
    expect(calls).toEqual([{ name: S.updateProp, input: { propId: "barrel", col: 7, row: 5 } }]);
    expect(usePropTool.getState().gesture).toBeNull();
    expect(usePropUndo.getState().stacks.s1).toEqual([
      { op: "update", propId: "barrel", prev: { col: 5, row: 3 } },
    ]);
    // A click without moving sends nothing.
    p.down(pointer({ col: 5, row: 3 }, send));
    p.up(pointer({ col: 5, row: 3 }, send));
    await flush();
    expect(calls).toHaveLength(1);
  });

  test("FR-SCN-17 a locked prop selects but doesn't drag; no handles", () => {
    const { send, calls } = fakeSend();
    publishProps("s1", [prop("chest", { col: 17, row: 12, locked: true })]);
    const { p } = tool();
    p.down(pointer({ col: 17, row: 12 }, send));
    expect(usePropTool.getState()).toMatchObject({ selectedId: "chest", gesture: null });
    p.move(pointer({ col: 15, row: 12 }, send));
    p.up(pointer({ col: 15, row: 12 }, send));
    // Pressing its corner doesn't resize.
    p.down(pointer({ col: 17, row: 12 }, send, { x: 17 * 70, y: 12 * 70 }));
    expect(usePropTool.getState().gesture).toBeNull();
    expect(calls).toEqual([]);
  });

  test("FR-SCN-17 a corner handle of the selected prop resizes (cells, opposite corner fixed) → w / h", async () => {
    const { send, calls } = fakeSend();
    publishProps("s1", [prop("b", { col: 6, row: 12 })]);
    usePropTool.setState({ selectedId: "b" });
    expect(handleAt({ col: 6, row: 12, w: 1, h: 1 }, GRID, 7 * 70 + 10, 13 * 70 - 5)).toBe("se");
    expect(handleAt({ col: 6, row: 12, w: 1, h: 1 }, GRID, 6.5 * 70, 12.5 * 70)).toBeNull();
    const { p } = tool();
    p.down(pointer({ col: 6, row: 12 }, send, { x: 7 * 70 + 3, y: 13 * 70 + 3 }));
    expect(usePropTool.getState().gesture).toMatchObject({ kind: "resize", handle: "se" });
    p.move(pointer({ col: 7, row: 13 }, send));
    p.up(pointer({ col: 7, row: 13 }, send));
    await flush();
    expect(calls).toEqual([{ name: S.updateProp, input: { propId: "b", w: 2, h: 2 } }]);
  });

  test("FR-SCN-16 with an image chosen, a click on an empty cell places it there and selects the new prop", async () => {
    const { send, calls } = fakeSend();
    publishProps("s1", [prop("barrel")]);
    usePropTool.setState({ imageId: "img-1" });
    const { p } = tool();
    p.down(pointer({ col: 6, row: 12 }, send));
    await flush();
    expect(calls).toEqual([
      { name: S.placeProp, input: { sceneId: "s1", assetId: "img-1", col: 6, row: 12 } },
    ]);
    expect(usePropTool.getState().selectedId).toBe("new-1");
    expect(usePropUndo.getState().stacks.s1).toEqual([{ op: "place", propId: "new-1" }]);
    // No image: an empty click clears the selection, sends nothing.
    usePropTool.setState({ imageId: null });
    p.down(pointer({ col: 0, row: 0 }, send));
    expect(usePropTool.getState().selectedId).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("FR-SCN-16 a rejected placement goes to the reject handler (Toast)", async () => {
    const { send } = fakeSend(() => true);
    publishProps("s1", []);
    usePropTool.setState({ imageId: "img-1" });
    const { p, errors } = tool();
    p.down(pointer({ col: 6, row: 12 }, send));
    await flush();
    expect(errors).toHaveLength(1);
    expect(usePropUndo.getState().stacks.s1 ?? []).toEqual([]);
  });

  test("FR-SCN-06 Esc drops a gesture first, then the selection; a scene switch drops both", () => {
    const { send, calls } = fakeSend();
    publishProps("s1", [prop("barrel")]);
    const { p } = tool();
    p.down(pointer({ col: 5, row: 3 }, send));
    p.move(pointer({ col: 8, row: 3 }, send));
    expect(p.cancel("escape")).toBe(true);
    expect(usePropTool.getState()).toMatchObject({ gesture: null, selectedId: "barrel" });
    p.up(pointer({ col: 8, row: 3 }, send));
    expect(calls).toEqual([]);
    expect(p.cancel("escape")).toBe(true);
    expect(usePropTool.getState().selectedId).toBeNull();
    expect(p.cancel("escape")).toBe(false);
    usePropTool.setState({ selectedId: "barrel" });
    publishProps("s2", []);
    expect(usePropTool.getState()).toMatchObject({ sceneId: "s2", selectedId: null });
  });

  test("FR-SCN-17 a deleted selection drops; to front / to back z", () => {
    publishProps("s1", [prop("a"), prop("b", { z: 2 })]);
    usePropTool.setState({ selectedId: "a", menu: { propId: "a", at: { x: 0, y: 0 } } });
    const props = usePropTool.getState().props;
    expect(zChange(props, prop("a"), "front")).toEqual({ z: 3 });
    expect(zChange(props, prop("a"), "back")).toBeNull();
    expect(zChange(props, prop("b", { z: 2 }), "front")).toBeNull();
    expect(zChange(props, prop("b", { z: 2 }), "back")).toEqual({ z: -1 });
    publishProps("s1", [prop("b", { z: 2 })]);
    expect(usePropTool.getState()).toMatchObject({ selectedId: null, menu: null });
  });
});

describe("FR-SCN-18 drawing", () => {
  test("FR-SCN-18 the image covers the drawn sides; 90° / 270° swap them; centre of the footprint", () => {
    const table = propFrame({ col: 4, row: 11, w: 2, h: 1 }, 90, GRID);
    expect(table).toMatchObject({ x: 280, y: 770, width: 140, height: 70, cx: 350, cy: 805 });
    expect([table.drawW, table.drawH]).toEqual([70, 140]);
    expect(propFrame({ col: 4, row: 11, w: 2, h: 1 }, 180, GRID)).toMatchObject({
      drawW: 140,
      drawH: 70,
    });
    // A 128 × 256 portrait image in a 70 × 140 box: no crop; in a 140 × 70 box: centre band.
    expect(coverCrop(128, 256, 70, 140)).toEqual({ x: 0, y: 0, width: 128, height: 256 });
    expect(coverCrop(128, 256, 140, 70)).toEqual({ x: 0, y: 96, width: 128, height: 64 });
    expect(coverCrop(0, 0, 70, 70)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test("FR-SCN-18 / FR-SCN-05 draw order z then seq; DM-only items off drops hidden props", () => {
    const ps = [
      prop("top", { seq: 1, z: 1 }),
      prop("chest", { seq: 2, hidden: true }),
      prop("barrel", { seq: 3 }),
    ];
    expect(propsToDraw(ps, false).map((p) => p.id)).toEqual(["chest", "barrel", "top"]);
    expect(propsToDraw(ps, true).map((p) => p.id)).toEqual(["barrel", "top"]);
  });
});

describe("FR-SCN-06 registration", () => {
  test("FR-SCN-06 the Props tool is a DM drawing tool in the registry (rail `map-tool-props`)", async () => {
    const { canvasTools } = await import("../scenes-map/canvas-tools");
    const { activeTool, isDrawing, toolsFor } = await import("../scenes-map/tools");
    const t = activeTool(canvasTools, PROPS_TOOL_ID, "dm");
    expect(t).toMatchObject({ id: "props", label: "Props", order: 20, clients: ["dm"] });
    expect(isDrawing(t)).toBe(true);
    expect(t?.panel).toBeFunction();
    expect(toolsFor(canvasTools, "player").map((x) => x.id)).not.toContain("props");
  });
});
