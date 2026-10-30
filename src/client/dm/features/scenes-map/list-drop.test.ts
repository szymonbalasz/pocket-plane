// FR-MAP-116: where a drag over the Scenes list lands (rows 20 px high, no gaps).
import { describe, expect, test } from "bun:test";
import { dropAt, type FlatRow, flatRows, type RowBox } from "./list-drop";

const stack = (rows: FlatRow[]): RowBox[] =>
  rows.map((r, i) => ({ ...r, top: i * 20, bottom: i * 20 + 20 }));

const scene = (id: string, parentId: string | null = null, depth = 0): FlatRow => ({
  kind: "scene",
  id,
  parentId,
  depth,
  open: false,
});
const folder = (id: string, open: boolean, parentId: string | null = null, depth = 0): FlatRow => ({
  kind: "folder",
  id,
  parentId,
  depth,
  open,
});

// 0 alpha · 1 Act (open) · 2 inner · 3 Sub (closed, in Act) · 4 omega
const rows = stack([
  scene("alpha"),
  folder("act", true),
  scene("inner", "act", 1),
  folder("sub", false, "act", 1),
  scene("omega"),
]);
const any = () => true;

describe("FR-MAP-116 drop target", () => {
  test("FR-MAP-116 the top half of a scene is before it, the bottom half before its next sibling", () => {
    expect(dropAt(rows, 2, any)).toMatchObject({ parentId: null, beforeId: "alpha", y: 0 });
    expect(dropAt(rows, 18, any)).toMatchObject({ parentId: null, beforeId: "act", y: 20 });
    expect(dropAt(rows, 42, any)).toMatchObject({ parentId: "act", beforeId: "inner", depth: 1 });
  });

  test("FR-MAP-116 the exact middle of a scene is beside it, never into it", () => {
    expect(dropAt(rows, 10, any)).toMatchObject({ parentId: null, beforeId: "act", into: null });
  });

  test("FR-MAP-116 the middle of a folder drops into it, last", () => {
    expect(dropAt(rows, 30, any)).toMatchObject({ parentId: "act", beforeId: null, into: "act" });
    expect(dropAt(rows, 70, any)).toMatchObject({ parentId: "sub", beforeId: null, into: "sub" });
  });

  test("FR-MAP-116 the top edge of a folder is before it", () => {
    expect(dropAt(rows, 22, any)).toMatchObject({ parentId: null, beforeId: "act", into: null });
  });

  test("FR-MAP-116 the bottom edge of an open folder is first inside it", () => {
    expect(dropAt(rows, 38, any)).toMatchObject({
      parentId: "act",
      beforeId: "inner",
      into: null,
      depth: 1,
    });
  });

  test("FR-MAP-116 the bottom edge of a closed folder, last of its level, ends that level", () => {
    expect(dropAt(rows, 78, any)).toMatchObject({ parentId: "act", beforeId: null, depth: 1 });
  });

  test("FR-MAP-116 past the last row is the end of the root", () => {
    expect(dropAt(rows, 500, any)).toMatchObject({ parentId: null, beforeId: null, y: 100 });
  });

  test("FR-MAP-116 an empty list takes the drop at the root", () => {
    expect(dropAt([], 10, any)).toMatchObject({ parentId: null, beforeId: null });
  });

  test("FR-MAP-02 a parent that can't take the entry is no spot, and a folder row then splits in two", () => {
    const noAct = (p: string | null) => p !== "act";
    expect(dropAt(rows, 25, noAct)).toMatchObject({ parentId: null, beforeId: "act" });
    expect(dropAt(rows, 35, noAct)).toBeNull();
    expect(dropAt(rows, 62, noAct)).toBeNull();
    expect(dropAt(rows, 500, (p) => p !== null)).toBeNull();
  });
});

describe("FR-MAP-116 rows on screen", () => {
  const tree = [
    { item: { id: "alpha", kind: "scene" as const } },
    {
      folder: { id: "act" },
      children: [
        { item: { id: "inner", kind: "overview" as const } },
        { folder: { id: "sub" }, children: [{ item: { id: "deep", kind: "scene" as const } }] },
      ],
    },
  ];

  test("FR-MAP-116 depth-first with parents and levels; a closed folder hides its contents", () => {
    const ids = (closed: string[]) =>
      flatRows(tree, (id) => closed.includes(id)).map((r) => [r.id, r.parentId, r.depth, r.open]);
    expect(ids([])).toEqual([
      ["alpha", null, 0, false],
      ["act", null, 0, true],
      ["inner", "act", 1, false],
      ["sub", "act", 1, true],
      ["deep", "sub", 2, false],
    ]);
    expect(ids(["sub"]).map((r) => r[0])).toEqual(["alpha", "act", "inner", "sub"]);
    expect(ids(["act"]).map((r) => r[0])).toEqual(["alpha", "act"]);
  });
});
