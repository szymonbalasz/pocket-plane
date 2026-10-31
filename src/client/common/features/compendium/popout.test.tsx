// FR-CMP-76 popped-out entries, FR-SHELL-201 pop-out window types: one window per entry, never
// stored, a close removes it, never minimised for another window.
import { afterEach, describe, expect, test } from "bun:test";
import { Layout, MAX_WINDOWS } from "@shared/play-shell/layout";
import { type ManagerContext, reduce, serialise, type Windows } from "../play-shell/manager";
import { createWindowRegistry, type WindowDef } from "../play-shell/registry";
import { CMP_ENTRY_KIND } from "./logic";
import { POPOUT_TITLE, popoutInstance, popoutTitle, resetPopouts, setPopoutName } from "./popout";
import { entryWindowBase } from "./window";

const VP = { w: 1600, h: 900 };
const entryDef: WindowDef = { ...entryWindowBase, clients: ["dm"], component: () => null };
const other: WindowDef = {
  kind: "a.other",
  title: "Other",
  clients: ["dm"],
  defaultSize: { w: 900, h: 700 },
  minSize: { w: 800, h: 600 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  component: () => null,
};
const registry = createWindowRegistry("dm", [entryDef, other]);
const ctx: ManagerContext = {
  registry,
  viewport: VP,
  available: new Set([CMP_ENTRY_KIND, other.kind]),
  avoid: () => [],
  keepOuts: () => [],
};
const open = (ws: Windows, instance: string) =>
  reduce(ws, { type: "open", kind: CMP_ENTRY_KIND, instance }, ctx);
const instances = (ws: Windows) =>
  ws.filter((w) => w.kind === CMP_ENTRY_KIND).map((w) => w.instance);

afterEach(resetPopouts);

describe("FR-CMP-76 which window shows which entry", () => {
  test("FR-CMP-76 each entry gets its own window; the same entry popped out again is the same one", () => {
    const fireball = popoutInstance({ mode: "entry", entryId: "e-fireball" });
    const goblin = popoutInstance({ mode: "entry", entryId: "e-goblin" });
    const def = popoutInstance({ mode: "definition", definitionId: "e-goblin" });
    expect(new Set([fireball, goblin, def]).size).toBe(3);
    expect(popoutInstance({ mode: "entry", entryId: "e-fireball" })).toBe(fireball);
  });

  test("FR-CMP-76 instance keys are valid layout keys, whatever the entry's id looks like", () => {
    const instance = popoutInstance({ mode: "entry", entryId: "SRD 5.1:Weird/ID" });
    expect(instance).toMatch(/^[a-z0-9-]+$/);
  });

  test("FR-CMP-76 the title bar shows the generic title until the entry's name has loaded", () => {
    const instance = popoutInstance({ mode: "entry", entryId: "e-fireball" });
    expect(popoutTitle(instance)).toBe(POPOUT_TITLE);
    setPopoutName(instance, "Fireball");
    expect(popoutTitle(instance)).toBe("Fireball");
    // Popped out again, it keeps its name while it refetches.
    expect(popoutTitle(popoutInstance({ mode: "entry", entryId: "e-fireball" }))).toBe("Fireball");
  });
});

describe("FR-SHELL-201 pop-out window types", () => {
  test("FR-SHELL-201 several windows of one kind open side by side, each at its own spot", () => {
    const ws = open(open(open([], "entry-1"), "entry-2"), "entry-3");
    expect(instances(ws)).toEqual(["entry-1", "entry-2", "entry-3"]);
    const spots = new Set(ws.map((w) => `${w.x},${w.y}`));
    expect(spots.size).toBe(3);
  });

  test("FR-SHELL-201 opening an open pop-out again brings it to front, no second window", () => {
    const ws = open(open([], "entry-1"), "entry-2");
    const again = open(ws, "entry-1");
    expect(instances(again)).toEqual(["entry-1", "entry-2"]);
    const z = (i: string) => again.find((w) => w.instance === i)?.z ?? 0;
    expect(z("entry-1")).toBeGreaterThan(z("entry-2"));
  });

  test("FR-SHELL-201 a close removes the window; the others stay", () => {
    const ws = open(open([], "entry-1"), "entry-2");
    const closed = reduce(ws, { type: "close", kind: CMP_ENTRY_KIND, instance: "entry-1" }, ctx);
    expect(instances(closed)).toEqual(["entry-2"]);
  });

  test("FR-SHELL-201 closing a pop-out that isn't open changes nothing", () => {
    const ws = open([], "entry-1");
    const same = reduce(ws, { type: "close", kind: CMP_ENTRY_KIND, instance: "entry-9" }, ctx);
    expect(same).toBe(ws);
  });

  test("FR-SHELL-201 pop-outs are never stored, so any number leaves the layout valid (MAX_WINDOWS)", () => {
    let ws: Windows = reduce([], { type: "open", kind: other.kind }, ctx);
    for (let i = 0; i < MAX_WINDOWS + 5; i += 1) ws = open(ws, `entry-${i}`);
    expect(ws.length).toBeGreaterThan(MAX_WINDOWS);
    const stored = serialise(ws, registry);
    expect(stored.windows.map((w) => w.kind)).toEqual([other.kind]);
    expect(Layout.safeParse(stored).success).toBe(true);
  });

  test("FR-SHELL-201 a pop-out is never auto-minimised to make room for another window", () => {
    const small = { ...ctx, viewport: { w: 1280, h: 720 } };
    let ws: Windows = reduce(
      [],
      { type: "open", kind: CMP_ENTRY_KIND, instance: "entry-1" },
      small,
    );
    ws = reduce(ws, { type: "open", kind: other.kind }, small);
    expect(ws.find((w) => w.instance === "entry-1")?.state).toBe("open");
    expect(ws.find((w) => w.kind === other.kind)?.state).toBe("open");
  });
});
