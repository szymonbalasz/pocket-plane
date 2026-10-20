// FR-NOTE-43 (NOTE §13 unit, sprint 6 WF2): the runtime re-places the DM's stack when the
// keep-outs change (a tool opens, its bar wraps, it closes). Static render over a fake sync store,
// with the real keep-out store (`reportKeepOut`) and a stubbed stack height (a static render runs
// no layout effect, so the real hook stays at 0: the stub's 0 between tests matches it).
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { reportKeepOut } from "../play-shell/keep-outs";
import { createWindowRegistry, type ShellClient } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { NOTIFICATION_TYPE } from "./logic";
import type { NoteClient } from "./note-client";
import { initialToasts, SUMMARY_KEY, type ToastMemory } from "./toasts";
import { createNotificationViews } from "./views";

let stubH = 0;
mock.module("./stack-height", () => ({ useStackHeight: () => stubH }));
const { ToastRuntime } = await import("./ToastRuntime");

const views = createNotificationViews([]);
const TOOLBAR = "map.toolbar";

const pending: NotificationRecord = {
  id: "n1",
  campaignId: "c1",
  seq: 1,
  kind: "test",
  audience: "dm",
  audiencePlayerId: null,
  text: "Mira: hit Goblin 2 — waiting for damage",
  payload: null,
  actionLabel: "Apply",
  actionRole: "dm",
  actionPlayerId: null,
  state: "pending",
  resolution: null,
  closedAt: null,
  closedByRole: null,
  closedByPlayerId: null,
  byRole: "player",
  byPlayerId: "pl-1",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
};

/** The stack's opening tag for `client` with the "1 pending action" summary showing. */
function stackTag(client: ShellClient): string {
  const store = {
    ...emptyStore(),
    you: { campaignId: "c1", role: client, playerId: client === "dm" ? null : "pl-1" },
    records: { [NOTIFICATION_TYPE]: { n1: pending } },
  } as unknown as RecordStore;
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  const memory = createStore<ToastMemory>()(() => ({
    campaignId: "c1",
    toasts: {
      ...initialToasts(0),
      toasts: [{ kind: "summary", key: SUMMARY_KEY, count: 1, sticky: true, remaining: 0 }],
    },
  }));
  const g = globalThis as { document?: unknown; getComputedStyle?: unknown; window?: unknown };
  g.document = { title: "", hidden: false, documentElement: {} };
  g.window = { innerWidth: 1440, innerHeight: 900 };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  try {
    const html = renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <ShellProvider registry={createWindowRegistry(client, [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <ToastRuntime views={views} note={{} as NoteClient} memory={memory} />
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
    return /<section [^>]*data-testid="note-toasts"[^>]*>/.exec(html)?.[0] ?? "";
  } finally {
    delete g.document;
    delete g.getComputedStyle;
    delete g.window;
  }
}
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];
const spot = (tag: string) => ({ left: attr(tag, "data-left"), top: attr(tag, "data-top") });

afterEach(() => reportKeepOut(TOOLBAR, null));
afterAll(() => {
  stubH = 0;
});

describe("FR-NOTE-43 never over a tool bar", () => {
  test("FR-NOTE-43 never over a tool bar: the runtime re-places the DM stack when a hard keep-out appears, changes or goes", () => {
    stubH = 57;
    expect(spot(stackTag("dm"))).toEqual({ left: "560", top: "100" });
    // A bar reaching under the home top: below it (bar bottom + 8).
    reportKeepOut(TOOLBAR, { x: 62, y: 56, w: 900, h: 92 });
    expect(spot(stackTag("dm"))).toEqual({ left: "560", top: "156" });
    // The bar wraps to a third row: further down.
    reportKeepOut(TOOLBAR, { x: 62, y: 56, w: 900, h: 140 });
    expect(spot(stackTag("dm"))).toEqual({ left: "560", top: "204" });
    // The tool closes: back home.
    reportKeepOut(TOOLBAR, null);
    expect(spot(stackTag("dm"))).toEqual({ left: "560", top: "100" });
  });

  test("FR-NOTE-43 never over a tool bar: players unaffected (bottom-right, no DM spot)", () => {
    stubH = 57;
    reportKeepOut(TOOLBAR, { x: 62, y: 56, w: 900, h: 92 });
    const tag = stackTag("player");
    expect(attr(tag, "data-placement")).toBe("bottom-right");
    expect(spot(tag)).toEqual({ left: undefined, top: undefined });
  });
});
