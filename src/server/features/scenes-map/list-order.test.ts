// FR-MAP-02 nested folders and FR-MAP-116 the Scenes list's order, through the commands.
import { describe, expect, test } from "bun:test";
import { OVW_INTENTS, type OverviewRecord } from "@shared/overview-scenes/schemas";
import { sceneTree } from "@shared/scenes-map/list-tree";
import type { SceneFolderRecord, SceneRecord } from "@shared/scenes-map/schemas";
import { overview, scene, sceneFolder } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { MAP_REST as R } from "./commands";
import { scenesSetup } from "./testing";

function setup() {
  const t = scenesSetup();
  const newScene = (name: string, folderId?: string) =>
    t.run<SceneRecord>(R.createScene, { name, mapAssetId: "map-battle", folderId }).id;
  const newFolder = (name: string, parentId?: string) =>
    t.run<SceneFolderRecord>(R.createFolder, { name, parentId }).id;
  const newOverview = (name: string, folderId?: string) =>
    t.run<{ overviewId: string }>(OVW_INTENTS.create, { name, folderId }).overviewId;
  const move = (
    kind: "scene" | "overview" | "folder",
    id: string,
    parentId: string | null,
    beforeId: string | null = null,
  ) => t.run(R.moveListEntry, { kind, id, parentId, beforeId });
  /** The list as names; a folder = `[name, contents]`. */
  const list = () => {
    const folders = t.s.db.select().from(sceneFolder).all();
    const items = [...t.s.db.select().from(scene).all(), ...t.s.db.select().from(overview).all()];
    type Nodes = ReturnType<typeof sceneTree<(typeof folders)[number], (typeof items)[number]>>;
    const walk = (nodes: Nodes): unknown[] =>
      nodes.map((n) => (n.folder ? [n.folder.name, walk(n.children)] : n.item?.name));
    return walk(sceneTree(folders, items));
  };
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, newScene, newFolder, newOverview, move, list, lastEvent };
}

describe("FR-MAP-116 move in the Scenes list", () => {
  test("FR-MAP-116 reorders a level across kinds; new order sticks", () => {
    const t = setup();
    const a = t.newScene("A");
    const b = t.newScene("B");
    t.newOverview("C");
    const f = t.newFolder("F");
    expect(t.list()).toEqual([["F", []], "A", "B", "C"]);
    t.move("scene", b, null, f);
    expect(t.list()).toEqual(["B", ["F", []], "A", "C"]);
    t.move("folder", f, null, null);
    expect(t.list()).toEqual(["B", "A", "C", ["F", []]]);
    t.move("scene", a, null, b);
    expect(t.list()).toEqual(["A", "B", "C", ["F", []]]);
  });

  test("FR-MAP-116 into a folder, into a subfolder, back to the root", () => {
    const t = setup();
    const f = t.newFolder("F");
    const g = t.newFolder("G", f);
    const s = t.newScene("S");
    const o = t.newOverview("O");
    t.move("scene", s, f);
    expect(t.list()).toEqual([["F", [["G", []], "S"]], "O"]);
    t.move("overview", o, g);
    expect(t.list()).toEqual([["F", [["G", ["O"]], "S"]]]);
    t.move("overview", o, null);
    t.move("folder", g, null);
    expect(t.list()).toEqual([["F", ["S"]], "O", ["G", []]]);
  });

  test("FR-MAP-116 one logged event carrying each renumbered row", () => {
    const t = setup();
    const a = t.newScene("A");
    const b = t.newScene("B");
    const before = readEventLog(t.s.db).length;
    t.move("scene", b, null, a);
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneListMoved");
    expect(ev?.payload).toEqual({ kind: "scene", id: b });
    expect(ev?.changes.map((c) => [c.type, c.id]).sort()).toEqual(
      [
        ["scene", a],
        ["scene", b],
      ].sort(),
    );
    expect(readEventLog(t.s.db).length).toBe(before + 1);
  });

  test("FR-MAP-116 the spot it already holds: no event, nothing arranged", () => {
    const t = setup();
    const a = t.newScene("A");
    const b = t.newScene("B");
    const count = t.events.length;
    t.move("scene", a, null, b);
    t.move("scene", b, null, null);
    expect(t.events.length).toBe(count);
    expect(
      t.s.db
        .select()
        .from(scene)
        .all()
        .map((s) => s.position),
    ).toEqual([0, 0]);
  });

  test("FR-MAP-116 joining a level: by name while never arranged, last once arranged", () => {
    const t = setup();
    const a = t.newScene("A");
    t.newScene("M");
    t.newScene("B");
    expect(t.list()).toEqual(["A", "B", "M"]);
    t.move("scene", a, null, null);
    expect(t.list()).toEqual(["B", "M", "A"]);
    t.newScene("C");
    t.newFolder("Z");
    t.newOverview("D");
    expect(t.list()).toEqual(["B", "M", "A", "C", ["Z", []], "D"]);
  });

  test("FR-MAP-116 a move to another level leaves the old level's order alone", () => {
    const t = setup();
    const f = t.newFolder("F");
    const a = t.newScene("A");
    const b = t.newScene("B");
    const c = t.newScene("C");
    t.move("scene", c, null, a);
    t.move("scene", b, f);
    expect(t.list()).toEqual([["F", ["B"]], "C", "A"]);
  });

  test("FR-MAP-03 / FR-OVW-02 / FR-MAP-04 patch, overview update and duplicate join the level the same way", () => {
    const t = setup();
    const f = t.newFolder("F");
    const a = t.newScene("A");
    const o = t.newOverview("O");
    t.move("scene", a, null, f);
    t.run(R.updateScene, { id: a, folderId: f });
    t.run(OVW_INTENTS.update, { overviewId: o, folderId: f });
    expect(t.list()).toEqual([["F", ["A", "O"]]]);
    t.run(R.duplicateScene, { id: a });
    t.move("overview", o, f, null);
    expect(t.list()).toEqual([["F", ["A", "A (copy)", "O"]]]);
  });

  test("FR-MAP-116 refuses: unknown entry, parent or sibling; another campaign's looks unknown", () => {
    const t = setup();
    const a = t.newScene("A");
    const f = t.newFolder("F");
    expect(t.err(() => t.move("scene", "nope", null)).code).toBe("not_found");
    expect(t.err(() => t.move("folder", "nope", null)).code).toBe("not_found");
    expect(t.err(() => t.move("overview", "nope", null)).code).toBe("not_found");
    expect(t.err(() => t.move("scene", a, "nope")).code).toBe("not_found");
    // Not a sibling in the target level: the client's list was stale.
    expect(t.err(() => t.move("scene", a, f, a)).code).toBe("conflict");
    const theirs = t.run<SceneFolderRecord>(R.createFolder, { name: "Theirs" }, t.h.dmSecond).id;
    expect(t.err(() => t.move("scene", a, theirs)).code).toBe("not_found");
  });
});

describe("FR-MAP-02 nested folders", () => {
  test("FR-MAP-02 subfolders nest five levels, the sixth is refused", () => {
    const t = setup();
    let at = t.newFolder("1");
    for (const n of ["2", "3", "4", "5"]) at = t.newFolder(n, at);
    expect(t.list()).toEqual([["1", [["2", [["3", [["4", [["5", []]]]]]]]]]]);
    expect(t.err(() => t.newFolder("6", at)).code).toBe("conflict");
    expect(t.err(() => t.newFolder("x", "nope")).code).toBe("not_found");
  });

  test("FR-MAP-02 a folder can't move into itself or a descendant, or past the cap", () => {
    const t = setup();
    const a = t.newFolder("a");
    const b = t.newFolder("b", a);
    const c = t.newFolder("c", b);
    t.newFolder("d", c);
    const other = t.newFolder("other");
    const under = t.newFolder("under", other);
    const self = t.err(() => t.move("folder", a, a));
    expect(self.code).toBe("conflict");
    expect(self.message).toContain("inside itself");
    expect(t.err(() => t.move("folder", a, c)).message).toContain("inside itself");
    // a's subtree spans 4 levels; `under` is level 2.
    expect(t.err(() => t.move("folder", a, under)).message).toContain("at most 5 levels");
    t.move("folder", a, other);
    expect(t.list()[0]).toEqual([
      "other",
      [
        ["under", []],
        ["a", [["b", [["c", [["d", []]]]]]]],
      ],
    ]);
  });

  test("FR-MAP-02 a folder delete moves its contents up one level, one event", () => {
    const t = setup();
    const top = t.newFolder("top");
    const mid = t.newFolder("mid", top);
    const low = t.newFolder("low", mid);
    const s = t.newScene("S", mid);
    const o = t.newOverview("O", mid);
    t.run(R.deleteFolder, { id: mid });
    expect(t.list()).toEqual([["top", [["low", []], "O", "S"]]]);
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneFolderDeleted");
    expect(ev?.changes.map((c) => c.id).sort()).toEqual([low, s, o, mid].sort());
    const moved = t.s.db.select().from(overview).all() as OverviewRecord[];
    expect(moved[0]?.folderId).toBe(top);
  });

  test("FR-MAP-02 in an arranged level, a deleted folder's contents take its place", () => {
    const t = setup();
    const first = t.newScene("first");
    const f = t.newFolder("F");
    const last = t.newScene("last");
    t.newScene("x", f);
    t.newScene("y", f);
    t.move("scene", first, null, f);
    t.move("scene", last, null, null);
    expect(t.list()).toEqual(["first", ["F", ["x", "y"]], "last"]);
    t.run(R.deleteFolder, { id: f });
    expect(t.list()).toEqual(["first", "x", "y", "last"]);
  });
});
