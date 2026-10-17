import { expect, test } from "bun:test";
import { createWindowRegistry, type WindowDef } from "./registry";
import { createShellController } from "./shell-store";
import { createLayoutStorage } from "./storage";

const Body = () => null;
const def = (kind: string, over: Partial<WindowDef> = {}): WindowDef => ({
  kind,
  title: kind,
  clients: ["dm"],
  defaultSize: { w: 300, h: 200 },
  minSize: { w: 200, h: 100 },
  defaultPosition: { anchor: "top-left" },
  component: Body,
  ...over,
});
const registry = createWindowRegistry("dm", [
  def("a.one", { defaultOpen: true }),
  def("a.two", { defaultOpen: true }),
]);
const vp = { w: 1600, h: 900 };
const all = new Set(["a.one", "a.two"]);

function controller(entries: Record<string, string> = {}) {
  const backend = new Map(Object.entries(entries));
  const storage = createLayoutStorage(() => ({
    getItem: (k) => backend.get(k) ?? null,
    setItem: (k, v) => void backend.set(k, v),
  }));
  return createShellController({ registry, storage, viewport: () => vp });
}

test("FR-SHELL-40 data-placed: default layout default / auto, stored entry stored, move end stored, reset auto-placed again", () => {
  const c = controller();
  c.restore("k");
  const placed = () => Object.fromEntries(c.store.getState().placed);
  // a.two's default rect is taken by a.one: auto placement chose another one.
  expect(placed()).toEqual({ "a.one:main": "default", "a.two:main": "auto" });
  c.dispatch({ type: "setRect", kind: "a.one", rect: { x: 500, y: 300, w: 300, h: 200 } }, all);
  expect(placed()["a.one:main"]).toBe("stored");
  expect(placed()["a.two:main"]).toBe("auto"); // untouched
  c.dispatch({ type: "reset" }, all);
  expect(placed()).toEqual({ "a.one:main": "default", "a.two:main": "auto" });

  const raw = JSON.stringify({ windows: c.store.getState().windows });
  const reloaded = controller({ k: raw });
  reloaded.restore("k");
  expect(Object.fromEntries(reloaded.store.getState().placed)).toEqual({
    "a.one:main": "stored",
    "a.two:main": "stored",
  });
});
