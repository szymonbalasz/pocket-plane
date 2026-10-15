// Sheet sections seam (CHARX §7.1, FR-CHARX-34): order, slot, clients, kinds, available,
// a throwing section isolated; the registry ships empty.
import { describe, expect, spyOn, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { type SectionContext, type SheetSection, sectionsFor } from "./sections";
import { sheetSections } from "./sheet-sections";

const C = () => null;
const s = (id: string, p: Partial<SheetSection> = {}): SheetSection => ({
  id,
  slot: "vitals",
  order: 10,
  component: C,
  ...p,
});
const ctx = (p: Partial<SectionContext> = {}): SectionContext => ({
  slot: "vitals",
  client: "player",
  kind: "character",
  store: emptyStore(),
  creatureId: "c1",
  ...p,
});
const ids = (list: SheetSection[]) => list.map((x) => x.id);

describe("FR-CHARX-34 sheet sections", () => {
  test("FR-CHARX-34 FR-CBTX-41 registry holds combat-extras' three lines", () => {
    // Append-only registry: other features add lines (e.g. `mod.effects`).
    const lines = sheetSections.map((x) => [x.id, x.slot]);
    for (const line of [
      ["cbtx.temp-hp", "vitals"],
      ["cbtx.death-saves", "vitals"],
      ["cbtx.effects", "header"],
    ]) {
      expect(lines).toContainEqual(line);
    }
  });

  test("FR-CHARX-34 slot filter; ascending order, ties by id", () => {
    const list = [
      s("cbtx.temp-hp", { order: 20 }),
      s("cbtx.b", { order: 10 }),
      s("cbtx.a", { order: 10 }),
      s("cbtx.effects", { slot: "header" }),
    ];
    expect(ids(sectionsFor(list, ctx()))).toEqual(["cbtx.a", "cbtx.b", "cbtx.temp-hp"]);
    expect(ids(sectionsFor(list, ctx({ slot: "header" })))).toEqual(["cbtx.effects"]);
    expect(ids(sectionsFor(list, ctx({ slot: "main" })))).toEqual([]);
  });

  test("FR-CHARX-34 clients default both; kinds default character", () => {
    const list = [s("x.both"), s("x.dm", { clients: ["dm"] }), s("x.npc", { kinds: ["monster"] })];
    expect(ids(sectionsFor(list, ctx()))).toEqual(["x.both"]);
    expect(ids(sectionsFor(list, ctx({ client: "dm" })))).toEqual(["x.both", "x.dm"]);
    expect(ids(sectionsFor(list, ctx({ client: "dm", kind: "monster" })))).toEqual(["x.npc"]);
  });

  test("FR-CHARX-34 available false → hidden; a throwing available hides only that one", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const list = [
      s("cbtx.death-saves", { available: (_st, id) => id === "c2" }),
      s("x.boom", {
        available: () => {
          throw new Error("boom");
        },
      }),
      s("x.ok"),
    ];
    expect(ids(sectionsFor(list, ctx()))).toEqual(["x.ok"]);
    expect(ids(sectionsFor(list, ctx({ creatureId: "c2" })))).toEqual(["cbtx.death-saves", "x.ok"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("FR-CHARX-34 duplicate id or a tab without title → registration error", () => {
    expect(() => sectionsFor([s("x.a"), s("x.a")], ctx())).toThrow("registered twice");
    expect(() => sectionsFor([s("x.t", { slot: "tab" })], ctx())).toThrow("needs a title");
    expect(
      ids(sectionsFor([s("x.t", { slot: "tab", title: "Effects" })], ctx({ slot: "tab" }))),
    ).toEqual(["x.t"]);
  });
});
