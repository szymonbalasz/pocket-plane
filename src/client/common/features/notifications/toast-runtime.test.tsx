// FR-NOTE-43 (NOTE §13 unit, sprint 6 WF2): the runtime re-places the DM's stack when the
// keep-outs change (a tool opens, its bar wraps, it closes). Static render over a fake sync store,
// with the real keep-out store (`reportKeepOut`) and a stubbed stack height (a static render runs
// no layout effect, so the real hook stays at 0: the stub's 0 between tests matches it).
// FR-NOTE-51 (sprint 8, WF4; BL-59): the stack returns home when its inputs change back (the
// stack inputs stubbed: windows as rendered, keep-outs, first rows), also while hovered.
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
import * as realInputs from "./stack-inputs";
import type { StackInputs } from "./stack-inputs";
import {
  addNote,
  initialToasts,
  SUMMARY_KEY,
  setCallout,
  type ToastMemory,
  type ToastState,
} from "./toasts";
import { createNotificationViews } from "./views";

let stubH = 0;
mock.module("./stack-height", () => ({ useStackHeight: () => stubH }));
// null = the real inputs (the FR-NOTE-43 cases read the real keep-out store).
let stubInputs: StackInputs | null = null;
const useRealInputs = realInputs.useStackInputs;
mock.module("./stack-inputs", () => ({
  useStackInputs: (isDm: boolean) => stubInputs ?? useRealInputs(isDm),
}));
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

const SUMMARY_ONLY: ToastState = {
  ...initialToasts(0),
  toasts: [{ kind: "summary", key: SUMMARY_KEY, count: 1, sticky: true, remaining: 0 }],
};

/** The stack's opening tag for `client` with the "1 pending action" summary showing. */
function stackTag(client: ShellClient, hovered = false): string {
  const html = stackHtml(client, { ...SUMMARY_ONLY, hovered });
  return /<section [^>]*data-testid="note-toasts"[^>]*>/.exec(html)?.[0] ?? "";
}

/** The rendered stack for `client` over `toasts`, with `rows` in the store (default: n1). */
function stackHtml(
  client: ShellClient,
  toasts: ToastState,
  rows: Record<string, NotificationRecord> = { n1: pending },
): string {
  const store = {
    ...emptyStore(),
    you: { campaignId: "c1", role: client, playerId: client === "dm" ? null : "pl-1" },
    records: { [NOTIFICATION_TYPE]: rows },
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
  const memory = createStore<ToastMemory>()(() => ({ campaignId: "c1", toasts }));
  const g = globalThis as { document?: unknown; getComputedStyle?: unknown; window?: unknown };
  g.document = { title: "", hidden: false, documentElement: {} };
  g.window = { innerWidth: 1440, innerHeight: 900 };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <ShellProvider registry={createWindowRegistry(client, [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <ToastRuntime views={views} note={{} as NoteClient} memory={memory} />
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
    delete g.getComputedStyle;
    delete g.window;
  }
}
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];
const spot = (tag: string) => ({ left: attr(tag, "data-left"), top: attr(tag, "data-top") });

afterEach(() => {
  reportKeepOut(TOOLBAR, null);
  stubInputs = null;
});
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

describe("FR-NOTE-51 stack returns home (BL-59)", () => {
  // sim-10 b05 / FU1 re-test at 1440×900: the Fog bar pushed Scenes under the home band; the
  // stack dropped below Scenes' first row (FR-NOTE-44) and stayed low after the tool closed.
  const bar = { x: 62, y: 56, w: 900, h: 92 };
  const pushedScenes = { x: 546, y: 156, w: 260, h: 440 };
  const scenesHome = { x: 68, y: 60, w: 260, h: 440 };
  const log = { x: 68, y: 652, w: 1150, h: 240 };
  const pushed: StackInputs = {
    initiative: { x: 1028, y: 60, w: 400, h: 500 },
    windows: [pushedScenes, log],
    hard: [bar],
    rows: [{ x: 546, y: 156, bottom: 156 + 32 + 36 }],
  };
  const returned: StackInputs = {
    ...pushed,
    windows: [scenesHome, log],
    hard: [],
    rows: [{ x: 68, y: 60, bottom: 60 + 32 + 36 }],
  };

  test("FR-NOTE-51 stack returns home (BL-59): the bar gone and the windows returned → home (560, 100) in the same render", () => {
    stubH = 57;
    stubInputs = pushed;
    const low = spot(stackTag("dm"));
    // Below the pushed window's title bar + 40 px (FR-NOTE-44), at its home left.
    expect(low.left).toBe("560");
    expect(Number(low.top)).toBeGreaterThanOrEqual(pushedScenes.y + 32 + 40);
    stubInputs = returned;
    expect(spot(stackTag("dm"))).toEqual({ left: "560", top: "100" });
  });

  test("FR-NOTE-51 stack returns home (BL-59): hovered, the stack still re-places on a window / keep-out change (the hover holds only the token re-read)", () => {
    stubH = 57;
    stubInputs = pushed;
    expect(Number(spot(stackTag("dm", true)).top)).toBeGreaterThan(100);
    stubInputs = returned;
    expect(spot(stackTag("dm", true))).toEqual({ left: "560", top: "100" });
  });

  test("FR-NOTE-51 stack returns home (BL-59): a first-row report change re-places the stack", () => {
    stubH = 57;
    stubInputs = pushed;
    const before = Number(spot(stackTag("dm")).top);
    // The pushed window's first row grows (a taller first row): the stack moves below it.
    const firstRowBottom = pushedScenes.y + 32 + 120;
    stubInputs = { ...pushed, rows: [{ x: 546, y: 156, bottom: firstRowBottom }] };
    const after = Number(spot(stackTag("dm")).top);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(firstRowBottom);
  });
});

describe("FR-NOTE-50 toast policy (runtime)", () => {
  const info = (id: string, seq: number): NotificationRecord => ({
    ...pending,
    id,
    seq,
    text: `info ${id}`,
    actionLabel: null,
    actionRole: null,
    state: "info",
  });
  const card = (id: string, seq: number): NotificationRecord => ({ ...pending, id, seq });
  const rows = {
    i1: info("i1", 1),
    c1: card("c1", 2),
    i2: info("i2", 3),
    c2: card("c2", 4),
    i3: info("i3", 5),
  };
  let st: ToastState = { ...SUMMARY_ONLY };
  for (const n of Object.values(rows)) st = addNote(st, n, 0);
  st = setCallout(st, { id: "stats-overkill", content: "Overkill! Thorn" }, 0);
  const ITEMS = ["note-toast", "note-toast-pending-summary", "note-toast-more", "note-callout"];
  /** The stack's items in DOM order: test id + record / callout id. */
  const order = (html: string) =>
    [...html.matchAll(/<[a-z]+ [^>]*data-testid="([a-z-]+)"[^>]*>/g)]
      .filter((m) => ITEMS.includes(m[1] ?? ""))
      .map((m) => {
        const id = / data-(?:record|callout)-id="([^"]*)"/.exec(m[0])?.[1] ?? "";
        return `${m[1]}:${id}`;
      });

  test("FR-NOTE-50 toast policy (runtime): DOM order from home: summary, cards, info, '+N more', callout; info held back first", () => {
    stubH = 57;
    const html = stackHtml("dm", st, rows);
    expect(order(html)).toEqual([
      "note-toast-pending-summary:",
      "note-toast:c1",
      "note-toast:c2",
      "note-toast:i3",
      "note-toast-more:",
      "note-callout:stats-overkill",
    ]);
    expect(html).toContain("+2 more");
    expect(html).toContain('data-class="card"');
    expect(html).toContain("Overkill! Thorn");
  });

  test("FR-NOTE-50 toast policy (runtime): players' home is the bottom (the column runs upwards); a callout alone still shows", () => {
    const tag = /<section [^>]*>/.exec(stackHtml("player", st, rows))?.[0] ?? "";
    expect(tag).toContain("flex-col-reverse");
    expect(/<section [^>]*>/.exec(stackHtml("dm", st, rows))?.[0]).not.toContain(
      "flex-col-reverse",
    );
    const alone = setCallout(initialToasts(0), { id: "x", content: "Goblin 1 falls" }, 0);
    expect(order(stackHtml("player", alone, {}))).toEqual(["note-callout:x"]);
  });
});
