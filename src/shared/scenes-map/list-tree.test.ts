// FR-MAP-02 nested folders and FR-MAP-116 list order (pure tree helpers).
import { describe, expect, test } from "bun:test";
import {
  canMoveFolder,
  canNestIn,
  folderDepth,
  folderSubtree,
  listOrder,
  moveSteps,
  sceneOrder,
  sceneTree,
} from "./list-tree";

const folder = (id: string, parentId: string | null = null, position = 0) => ({
  id,
  name: id,
  seq: 1,
  parentId,
  position,
});
const item = (id: string, folderId: string | null = null, position = 0, seq = 1) => ({
  id,
  name: id,
  seq,
  folderId,
  position,
});

type Node = ReturnType<typeof sceneTree<ReturnType<typeof folder>, ReturnType<typeof item>>>;
const shape = (nodes: Node): unknown[] =>
  nodes.map((n) => (n.folder ? [n.folder.id, shape(n.children)] : n.item?.id));

// a > b > c > d > e: five levels.
const chain = [
  folder("a"),
  folder("b", "a"),
  folder("c", "b"),
  folder("d", "c"),
  folder("e", "d"),
  folder("loose"),
];

describe("FR-MAP-116 list order", () => {
  test("FR-MAP-116 a level never arranged reads folders first, then by name", () => {
    expect(shape(sceneTree([folder("z"), folder("m")], [item("b"), item("a")]))).toEqual([
      ["m", []],
      ["z", []],
      "a",
      "b",
    ]);
  });

  test("FR-MAP-116 an arranged level mixes kinds by position", () => {
    const folders = [folder("act", null, 2)];
    const items = [item("intro", null, 1), item("outro", null, 3), item("inside", "act", 1)];
    expect(shape(sceneTree(folders, items))).toEqual(["intro", ["act", ["inside"]], "outro"]);
    expect(sceneOrder(folders, items).map((i) => i.id)).toEqual(["intro", "inside", "outro"]);
  });

  test("FR-MAP-116 position wins over the folder-first rule; ties fall back to it", () => {
    const f = { position: 1, isFolder: true, name: "z", seq: 1 };
    const s = { position: 0, isFolder: false, name: "a", seq: 1 };
    expect(listOrder(s, f)).toBeLessThan(0);
    expect(listOrder({ ...s, position: 1 }, f)).toBeGreaterThan(0);
  });

  test("FR-MAP-02 an unknown parent or folder sits at the root", () => {
    expect(shape(sceneTree([folder("kid", "gone")], [item("lost", "gone")]))).toEqual([
      ["kid", []],
      "lost",
    ]);
  });

  test("FR-MAP-116 Move up / down steps within the level, none past the ends", () => {
    const level = ["a", "b", "c"];
    expect(moveSteps(level, "a")).toEqual({ up: null, down: { beforeId: "c" } });
    expect(moveSteps(level, "b")).toEqual({ up: { beforeId: "a" }, down: { beforeId: null } });
    expect(moveSteps(level, "c")).toEqual({ up: { beforeId: "b" }, down: null });
    expect(moveSteps(level, "gone")).toEqual({ up: null, down: null });
  });
});

describe("FR-MAP-02 nested folders", () => {
  test("FR-MAP-02 depth counts from the root; a subtree holds every level below", () => {
    expect(folderDepth(chain, null)).toBe(0);
    expect(folderDepth(chain, "a")).toBe(1);
    expect(folderDepth(chain, "e")).toBe(5);
    expect([...folderSubtree(chain, "c")].sort()).toEqual(["c", "d", "e"]);
  });

  test("FR-MAP-02 a new folder fits up to five levels", () => {
    expect(canNestIn(chain, null)).toBe(true);
    expect(canNestIn(chain, "d")).toBe(true);
    expect(canNestIn(chain, "e")).toBe(false);
  });

  test("FR-MAP-02 a folder never moves into itself or a descendant", () => {
    expect(canMoveFolder(chain, "b", "b")).toBe(false);
    expect(canMoveFolder(chain, "b", "e")).toBe(false);
    expect(canMoveFolder(chain, "b", null)).toBe(true);
  });

  test("FR-MAP-02 a moved subtree still fits the cap", () => {
    // b's subtree spans 4 levels: under `loose` (level 1) it fits exactly.
    expect(canMoveFolder(chain, "b", "loose")).toBe(true);
    const deeper = [...chain, folder("x", "loose")];
    expect(canMoveFolder(deeper, "b", "x")).toBe(false);
    expect(canMoveFolder(deeper, "e", "d")).toBe(true);
  });
});
