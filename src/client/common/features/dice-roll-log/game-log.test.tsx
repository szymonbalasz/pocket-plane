// FR-DICE-35 chips in the game log and FR-DICE-37 `focusLogEntry` (DICE §13 unit, sprint 4):
// static render of `GameLog` over a fake sync store; the focus store with fake timers; the
// open / front through a real shell controller.
import { afterEach, describe, expect, test } from "bun:test";
import { DICE_LOOK_TYPE, STYLE_LOOK } from "@shared/dice-extras/looks";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry, type WindowDef } from "../play-shell/registry";
import { createShellController } from "../play-shell/shell-store";
import {
  applyLogFocus,
  createLogFocus,
  FOCUS_MS,
  focusLogEntry,
  type LogFocusTimers,
  logFocus,
  scrollToEntry,
} from "./focus";
import { GameLog } from "./GameLog";
import { DICE_LOG_KIND } from "./window";

const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-17T10:00:00.000Z",
  kind: "roll",
  category: "skill-check",
  public: true,
  undone: false,
  rollerRole: "player",
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload: [
    {
      rollId: "r1",
      expression: "2d20kh1+5",
      mode: "advantage",
      manual: false,
      dice: [
        { faces: 20, value: 13, kept: true },
        { faces: 20, value: 4, kept: false },
      ],
      constant: 5,
      total: 18,
      natural: 13,
      label: "Athletics",
    },
  ],
  rollIds: ["r1"],
  encounterId: null,
  supersededBy: null,
  ...o,
});

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

function store(entries: GameLogEntryView[], role: "dm" | "player" = "player"): RecordStore {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  return {
    ...emptyStore(),
    you,
    records: {
      [GAME_LOG_ENTRY_TYPE]: byId(entries),
      player: byId([
        { id: "p1", name: "Player 1" },
        { id: "p2", name: "Player 2" },
      ]),
      // player-1 stored Gold; the DM and player-2 use the derived defaults.
      [DICE_LOOK_TYPE]: byId([
        { id: "l1", ownerKey: "p1", ownerPlayerId: "p1", ...STYLE_LOOK.gold },
      ]),
    },
  } as unknown as RecordStore;
}

function render(entries: GameLogEntryView[], role: "dm" | "player" = "player") {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: store(entries, role),
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <GameLog />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** Each `dice-log-die` wrapper with its inner `dicex-die`. */
const chips = (html: string) =>
  [
    ...html.matchAll(
      /<span data-testid="dice-log-die" data-faces="(\d*)" data-value="(\d+)" data-kept="(\w+)" data-offered="(\w+)"[^>]*><span data-testid="dicex-die" data-shape="(\w+)"/g,
    ),
  ].map((m) => ({ faces: m[1], value: m[2], kept: m[3], offered: m[4], shape: m[5] }));

afterEach(() => {
  logFocus.clear(logFocus.api.getState().seq);
});

describe("FR-DICE-35 log die chips (GameLog)", () => {
  test("FR-DICE-35 log die chips: a dice-log-die wrapper per chip with the inner data-shape", () => {
    const html = render([
      entry(),
      entry({
        id: "e2",
        n: 2,
        rollerPlayerId: "p2",
        actorName: "Thorn",
        payload: [
          {
            rollId: "r2",
            expression: "1d8+2d6",
            mode: "normal",
            manual: false,
            dice: [
              { faces: 8, value: 7, kept: true },
              { faces: 6, value: 1, kept: true },
              { faces: 6, value: 6, kept: true },
            ],
            constant: 0,
            total: 14,
            natural: null,
            label: null,
          },
        ],
      }),
    ]);
    expect(chips(html)).toEqual([
      { faces: "20", value: "13", kept: "true", offered: "false", shape: "d20" },
      { faces: "20", value: "4", kept: "false", offered: "false", shape: "d20" },
      { faces: "8", value: "7", kept: "true", offered: "false", shape: "d8" },
      { faces: "6", value: "1", kept: "true", offered: "false", shape: "d6" },
      { faces: "6", value: "6", kept: "true", offered: "false", shape: "d6" },
    ]);
    // No element carries two test IDs (review B31): the wrapper and the shape are separate.
    expect(html).not.toMatch(/data-testid="[^"]*"[^>]*data-testid=/);
    // The line text is still there for copy / screen readers.
    expect(html).toContain("Athletics");
    expect(html).toContain('aria-label="d20: 13"');
  });

  test("FR-DICE-35 log die chips: chips in the roller's look (stored row, else the default)", () => {
    const html = render([
      entry(),
      entry({ id: "e2", n: 2, rollerPlayerId: "p2", actorName: "Thorn" }),
      entry({ id: "e3", n: 3, rollerRole: "dm", rollerPlayerId: null, actorName: "Goblin" }),
    ]);
    const rows = html.split('data-testid="dice-log-entry"').slice(1);
    expect(rows[0]).toContain(`fill="${STYLE_LOOK.gold.body}"`); // player-1: stored Gold
    expect(rows[1]).toContain(`fill="${STYLE_LOOK.sapphire.body}"`); // player-2: default
    expect(rows[2]).toContain(`fill="${STYLE_LOOK.obsidian.body}"`); // DM: Obsidian
  });

  test("FR-DICE-35 log die chips: a chip fits the line (18 px, centred, no taller line box)", () => {
    const html = render([entry()]);
    expect(html).toContain('width="18" height="18"');
    expect(html).toMatch(/data-testid="dice-log-die"[^>]*class="[^"]*-my-0\.5[^"]*align-middle/);
  });
});

describe("FR-DICE-37 focusLogEntry", () => {
  function fakeTimers() {
    const pending: { fn: () => void; at: number }[] = [];
    let now = 0;
    const timers: LogFocusTimers = {
      setTimeout(fn, ms) {
        const t = { fn, at: now + ms };
        pending.push(t);
        return t;
      },
      clearTimeout(h) {
        const i = pending.indexOf(h as (typeof pending)[number]);
        if (i >= 0) pending.splice(i, 1);
      },
    };
    const advance = (ms: number) => {
      now += ms;
      for (const t of [...pending].filter((p) => p.at <= now)) {
        pending.splice(pending.indexOf(t), 1);
        t.fn();
      }
    };
    return { timers, advance };
  }

  const Body = () => null;
  const def = (kind: string, over: Partial<WindowDef> = {}): WindowDef => ({
    kind,
    title: kind,
    clients: ["dm", "player"],
    defaultSize: { w: 340, h: 280 },
    minSize: { w: 300, h: 200 },
    defaultPosition: { anchor: "bottom-left" },
    component: Body,
    ...over,
  });

  function shell() {
    const registry = createWindowRegistry("player", [
      def(DICE_LOG_KIND, { defaultOpen: true }),
      def("other.window", { defaultOpen: true, defaultPosition: { anchor: "top-left" } }),
    ]);
    const c = createShellController({
      registry,
      storage: { read: () => null, write: () => {} },
      viewport: () => ({ w: 1280, h: 720 }),
    });
    c.restore("k");
    const all = new Set([DICE_LOG_KIND, "other.window"]);
    return { c, open: (kind: string) => c.dispatch({ type: "open", kind }, all), all };
  }
  const logOf = (c: ReturnType<typeof shell>["c"]) => {
    const ws = c.store.getState().windows;
    const w = ws.find((x) => x.kind === DICE_LOG_KIND);
    const topZ = Math.max(...ws.filter((x) => x.state !== "closed").map((x) => x.z));
    return { state: w?.state ?? "closed", front: w?.z === topZ };
  };

  test("FR-DICE-37 focusLogEntry: a closed log opens and fronts, the entry is focused for 2 s", () => {
    const { timers, advance } = fakeTimers();
    const f = createLogFocus(timers);
    const { c, open, all } = shell();
    c.dispatch({ type: "close", kind: DICE_LOG_KIND }, all);
    expect(logOf(c).state).toBe("closed");
    f.focus("e1");
    expect(applyLogFocus(f, store([entry()]), open, DICE_LOG_KIND)).toBe(true);
    expect(logOf(c)).toEqual({ state: "open", front: true });
    expect(f.api.getState().entryId).toBe("e1");
    advance(FOCUS_MS - 1);
    expect(f.api.getState().entryId).toBe("e1");
    advance(1);
    expect(f.api.getState().entryId).toBeNull();
  });

  test("FR-DICE-37 focusLogEntry: a minimised log is restored and fronted", () => {
    const f = createLogFocus(fakeTimers().timers);
    const { c, open, all } = shell();
    c.dispatch({ type: "minimise", kind: DICE_LOG_KIND }, all);
    c.dispatch({ type: "focus", kind: "other.window" }, all);
    expect(logOf(c).state).toBe("minimised");
    f.focus("e1");
    applyLogFocus(f, store([entry()]), open, DICE_LOG_KIND);
    expect(logOf(c)).toEqual({ state: "open", front: true });
  });

  test("FR-DICE-37 focusLogEntry: an unknown id → the log opens only, nothing focused", () => {
    const f = createLogFocus(fakeTimers().timers);
    const { c, open, all } = shell();
    c.dispatch({ type: "close", kind: DICE_LOG_KIND }, all);
    f.focus("below-the-window");
    expect(applyLogFocus(f, store([entry()]), open, DICE_LOG_KIND)).toBe(false);
    expect(logOf(c).state).toBe("open");
    expect(f.api.getState().entryId).toBeNull();
  });

  test("FR-DICE-37 focusLogEntry: a new focus restarts the 2 s; the entry carries data-focused", () => {
    const { timers, advance } = fakeTimers();
    const f = createLogFocus(timers);
    f.focus("e1");
    advance(1500);
    f.focus("e2");
    advance(1500);
    expect(f.api.getState().entryId).toBe("e2");
    advance(500);
    expect(f.api.getState().entryId).toBeNull();
    // The shared store drives the rendered list.
    focusLogEntry("e2");
    const html = render([entry(), entry({ id: "e2", n: 2 })]);
    expect(html).toMatch(/data-record-id="e1"[^>]*data-focused="false"/);
    expect(html).toMatch(/data-record-id="e2"[^>]*data-focused="true"[^>]*ring-2/);
  });

  test("FR-DICE-37 focusLogEntry: scrolls the focused row into view", () => {
    const calls: unknown[] = [];
    const row = { scrollIntoView: (o: unknown) => calls.push(o) };
    const list = {
      querySelector: (sel: string) =>
        sel === '[data-testid="dice-log-entry"][data-record-id="e2"]' ? row : null,
    } as unknown as ParentNode;
    expect(scrollToEntry(list, "e2")).toBe(true);
    expect(calls).toEqual([{ block: "nearest" }]);
    expect(scrollToEntry(list, "nope")).toBe(false);
    expect(scrollToEntry(list, null)).toBe(false);
  });
});
