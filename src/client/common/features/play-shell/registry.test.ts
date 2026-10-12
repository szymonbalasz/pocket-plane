import { describe, expect, spyOn, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { availableKinds, createWindowRegistry, defineWindow, type WindowDef } from "./registry";

const Body = () => null;
const def = (over: Partial<WindowDef> = {}): WindowDef =>
  defineWindow({
    kind: "test.one",
    title: "One",
    clients: ["dm", "player"],
    defaultSize: { w: 300, h: 200 },
    minSize: { w: 200, h: 100 },
    defaultPosition: { anchor: "top-left" },
    component: Body,
    ...over,
  });

describe("window registry", () => {
  test("FR-SHELL-07 registers a window type per client", () => {
    const r = createWindowRegistry("dm", [def(), def({ kind: "test.two", clients: ["dm"] })]);
    expect(r.client).toBe("dm");
    expect(r.defs.map((d) => d.kind)).toEqual(["test.one", "test.two"]);
    expect(r.get("test.two")?.title).toBe("One");
    expect(r.get("nope.x")).toBeUndefined();
  });

  test("FR-SHELL-07 rejects bad kinds, duplicates, wrong client, size below min", () => {
    expect(() => createWindowRegistry("dm", [def({ kind: "Bad.Kind" })])).toThrow();
    expect(() => createWindowRegistry("dm", [def({ kind: "nodot" })])).toThrow();
    expect(() => createWindowRegistry("dm", [def(), def()])).toThrow(/twice/);
    expect(() => createWindowRegistry("player", [def({ clients: ["dm"] })])).toThrow(/player/);
    expect(() => createWindowRegistry("dm", [def({ defaultSize: { w: 100, h: 200 } })])).toThrow(
      /min size/,
    );
  });

  test("FR-SHELL-07 only available kinds render; a throwing available() counts as unavailable", () => {
    const r = createWindowRegistry("player", [
      def(),
      def({ kind: "test.gated", available: (s) => s.records.probe !== undefined }),
      def({
        kind: "test.broken",
        available: () => {
          throw new Error("boom");
        },
      }),
    ]);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const store = emptyStore();
    expect([...availableKinds(r, store)]).toEqual(["test.one"]);
    expect([...availableKinds(r, { ...store, records: { probe: {} } })]).toEqual([
      "test.one",
      "test.gated",
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
