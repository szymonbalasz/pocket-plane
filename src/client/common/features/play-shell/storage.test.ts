import { describe, expect, test } from "bun:test";
import { layoutKey } from "@shared/play-shell/layout";
import { defaultLayout } from "./manager";
import { createWindowRegistry, type WindowDef } from "./registry";
import { createShellController } from "./shell-store";
import { createLayoutStorage, type StorageBackend } from "./storage";

const Body = () => null;
const def = (kind: string, over: Partial<WindowDef> = {}): WindowDef => ({
  kind,
  title: kind,
  clients: ["dm", "player"],
  defaultSize: { w: 300, h: 200 },
  minSize: { w: 200, h: 100 },
  defaultPosition: { anchor: "top-left" },
  component: Body,
  ...over,
});
const registry = createWindowRegistry("dm", [def("a.one", { defaultOpen: true }), def("a.two")]);
const vp = { w: 1600, h: 900 };
const all = new Set(["a.one", "a.two"]);

function memoryBackend() {
  const data = new Map<string, string>();
  const backend: StorageBackend = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
  return { data, backend };
}

function setup(backend: StorageBackend, warnings: string[] = []) {
  const storage = createLayoutStorage(
    () => backend,
    (m) => warnings.push(m),
  );
  return createShellController({
    registry,
    storage,
    viewport: () => vp,
    warn: (m) => warnings.push(m),
  });
}

describe("layout storage", () => {
  test("FR-SHELL-15 key per (campaign, owner); no secret in it", () => {
    expect(layoutKey("c1", { role: "dm" })).toBe("pp.layout.v1.c1.dm");
    expect(layoutKey("c1", { playerId: "p1" })).toBe("pp.layout.v1.c1.p1");
    expect(layoutKey("c1", { playerId: "p2" })).not.toBe(layoutKey("c1", { playerId: "p1" }));
  });

  test("FR-SHELL-15 every change is written synchronously as {windows}", () => {
    const { data, backend } = memoryBackend();
    const c = setup(backend);
    c.restore("k");
    expect(data.has("k")).toBe(false); // restore alone doesn't write
    c.dispatch({ type: "open", kind: "a.two" }, all);
    const stored = JSON.parse(data.get("k") ?? "{}");
    expect(stored.windows.map((w: { kind: string }) => w.kind)).toEqual(["a.one", "a.two"]);
    c.dispatch({ type: "setRect", kind: "a.two", rect: { x: 400, y: 300, w: 320, h: 240 } }, all);
    expect(JSON.parse(data.get("k") ?? "").windows[1]).toMatchObject({ x: 400, y: 300 });
  });

  test("FR-SHELL-15 no-op change (focus on top window) writes nothing", () => {
    let writes = 0;
    const { backend } = memoryBackend();
    const c = setup({
      ...backend,
      setItem: (k, v) => {
        writes++;
        backend.setItem(k, v);
      },
    });
    c.restore("k");
    c.dispatch({ type: "focus", kind: "a.one" }, all);
    expect(writes).toBe(0);
  });

  test("FR-SHELL-16 restore applies once per key; other snapshots don't move windows", () => {
    const { backend } = memoryBackend();
    const c = setup(backend);
    c.restore("k");
    c.dispatch({ type: "setRect", kind: "a.one", rect: { x: 500, y: 500, w: 300, h: 200 } }, all);
    const before = c.store.getState().windows;
    c.restore("k"); // reconnect / resync snapshot: same key
    expect(c.store.getState().windows).toBe(before);
  });

  test("FR-SHELL-16 campaign switch: writes go to the key the change was made under", () => {
    const { data, backend } = memoryBackend();
    const c = setup(backend);
    const a = layoutKey("ca", { role: "dm" });
    const b = layoutKey("cb", { role: "dm" });
    c.restore(a);
    c.dispatch({ type: "setRect", kind: "a.one", rect: { x: 12, y: 300, w: 300, h: 200 } }, all);
    const aBefore = data.get(a);
    c.restore(b); // first snapshot of the new campaign
    expect(c.store.getState().windows).toEqual(defaultLayout(registry, vp));
    c.dispatch({ type: "open", kind: "a.two" }, all);
    expect(data.get(a)).toBe(aBefore);
    expect(data.has(b)).toBe(true);
    c.restore(a); // switch back: own layout again
    expect(c.store.getState().windows[0]).toMatchObject({ x: 12, y: 300 });
  });

  test("FR-SHELL-17 corrupt entry → default + console warning; next change overwrites it", () => {
    const { data, backend } = memoryBackend();
    data.set("k", "{garbage");
    const warnings: string[] = [];
    const c = setup(backend, warnings);
    c.restore("k");
    expect(c.store.getState().windows).toEqual(defaultLayout(registry, vp));
    expect(warnings).toHaveLength(1);
    c.dispatch({ type: "open", kind: "a.two" }, all);
    expect(JSON.parse(data.get("k") ?? "").windows).toHaveLength(2);
  });

  test("FR-SHELL-17 throwing storage → memory only, one warning, no throw", () => {
    const warnings: string[] = [];
    const boom = () => {
      throw new Error("SecurityError");
    };
    const c = setup({ getItem: boom, setItem: boom }, warnings);
    expect(() => c.restore("k")).not.toThrow();
    expect(c.store.getState().windows).toEqual(defaultLayout(registry, vp));
    c.dispatch({ type: "open", kind: "a.two" }, all);
    c.dispatch({ type: "close", kind: "a.two" }, all);
    expect(warnings).toHaveLength(1);
    c.restore("other");
    c.restore("k"); // memory copy survives a key switch
    expect(c.store.getState().windows.find((w) => w.kind === "a.two")?.state).toBe("closed");
  });

  test("FR-SHELL-17 full storage (setItem throws) → layout kept in memory", () => {
    const { backend } = memoryBackend();
    const warnings: string[] = [];
    const c = setup(
      {
        getItem: backend.getItem,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      warnings,
    );
    c.restore("k");
    c.dispatch({ type: "open", kind: "a.two" }, all);
    expect(c.store.getState().windows).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  test("FR-SHELL-19 another tab's write is not applied live; last write wins", () => {
    const { data, backend } = memoryBackend();
    const tab1 = setup(backend);
    const tab2 = setup(backend);
    tab1.restore("k");
    tab2.restore("k");
    tab2.dispatch({ type: "open", kind: "a.two" }, all);
    expect(tab1.store.getState().windows).toHaveLength(1);
    tab1.dispatch({ type: "close", kind: "a.one" }, all);
    const stored = JSON.parse(data.get("k") ?? "").windows;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "a.one", state: "closed" });
  });

  test("FR-SHELL-16 nothing happens before the first snapshot", () => {
    const { data, backend } = memoryBackend();
    const c = setup(backend);
    c.dispatch({ type: "open", kind: "a.two" }, all);
    expect(c.store.getState().windows).toEqual([]);
    expect(data.size).toBe(0);
  });
});
