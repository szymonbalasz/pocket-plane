// FR-SHELL-165 (seams S3): `useResetLayout()` runs FR-SHELL-153's reset, the same action as the
// launcher's "⋯" and Preferences → Layout. The page's shell controller is captured as the
// provider creates it (a static render runs no effects; the test restores and clicks itself).
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry, defineWindow } from "./registry";
import type { ShellController } from "./shell-store";
import * as shellStore from "./shell-store";

const made: ShellController[] = [];
const create = shellStore.createShellController;
mock.module("./shell-store", () => ({
  ...shellStore,
  createShellController: (o: Parameters<typeof create>[0]) => {
    const c = create(o);
    made.push(c);
    return c;
  },
}));
const { ShellProvider, useResetLayout } = await import("./ShellContext");
const { defaultLayout } = await import("./manager");

const g = globalThis as { window?: unknown; document?: unknown };
beforeAll(() => {
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  g.document = {
    title: "",
    hidden: false,
    createElement: () => ({ getContext: () => null }),
    querySelector: () => null,
  };
});
afterAll(() => {
  delete g.window;
  delete g.document;
});

const one = defineWindow({
  kind: "cmp.one",
  title: "One",
  clients: ["dm"],
  defaultSize: { w: 300, h: 300 },
  minSize: { w: 200, h: 200 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: () => null, label: "One", order: 1 },
  component: () => null,
});
const log = defineWindow({
  ...one,
  kind: "cmp.log",
  defaultOpen: true,
  defaultPosition: { anchor: "bottom-left", dx: 56 },
  launcher: undefined,
});
const registry = createWindowRegistry("dm", [log, one]);

test("FR-SHELL-165 exports: useResetLayout() = the launcher's Reset layout: remembered spots forgotten, the named default layout, launcher windows closed", () => {
  const store = {
    ...emptyStore(),
    you: { campaignId: "c1", role: "dm", playerId: null },
  } as unknown as RecordStore;
  const sync = createStore<SyncState>()(
    () => ({ state: "live", store, notLiveSince: null, everLive: true }) as unknown as SyncState,
  );
  let reset: (() => void) | null = null;
  function Grab() {
    reset = useResetLayout();
    return null;
  }
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <ShellProvider registry={registry}>
        <Grab />
      </ShellProvider>
    </SyncContext.Provider>,
  );
  const c = made.at(-1) as ShellController;
  c.restore("k");
  const kinds = new Set(["cmp.one", "cmp.log"]);
  c.dispatch({ type: "open", kind: "cmp.one" }, kinds);
  c.dispatch({ type: "setRect", kind: "cmp.one", rect: { x: 400, y: 200, w: 300, h: 300 } }, kinds);
  c.dispatch({ type: "setRect", kind: "cmp.log", rect: { x: 300, y: 300, w: 400, h: 300 } }, kinds);
  (reset as unknown as () => void)();
  const ws = c.store.getState().windows;
  expect(ws).toEqual(defaultLayout(registry, { w: 1280, h: 720 }));
  expect(ws.some((w) => w.userSpot || w.userSize)).toBe(false);
});
