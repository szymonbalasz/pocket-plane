// FR-DICE-35 chips in the game log and FR-DICE-37 `focusLogEntry` (DICE §13 unit, sprint 4):
// static render of `GameLog` over a fake sync store; the focus store with fake timers; the
// open / front through a real shell controller.
import { afterEach, describe, expect, test } from "bun:test";
import { DICE_LOOK_TYPE, STYLE_LOOK } from "@shared/dice-extras/looks";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { landing } from "../dice-extras/landing";
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
import { EntryDetails, GameLog } from "./GameLog";
import { heldSegments } from "./logic";
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

function renderWith(
  el: React.ReactElement,
  entries: GameLogEntryView[],
  role: "dm" | "player" = "player",
) {
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
        {el}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const render = (entries: GameLogEntryView[], role: "dm" | "player" = "player") =>
  renderWith(<GameLog />, entries, role);

/** FR-KIT-45: each entry's Tooltip body (rendered on open), in order. */
const details = (entries: GameLogEntryView[], role: "dm" | "player" = "player") =>
  renderWith(
    <div>
      {entries.map((e) => (
        <EntryDetails key={e.id} e={e} />
      ))}
    </div>,
    entries,
    role,
  );

/** Each `dice-log-die` wrapper with its inner `dicex-die`. */
const chips = (html: string) =>
  [
    ...html.matchAll(
      /<(?:span|s) data-testid="dice-log-die" data-faces="(\d*)" data-value="(\d+)" data-kept="(\w+)" data-offered="(\w+)"[^>]*><span data-testid="dicex-die" data-shape="(\w+)"/g,
    ),
  ].map((m) => ({ faces: m[1], value: m[2], kept: m[3], offered: m[4], shape: m[5] }));

afterEach(() => {
  logFocus.clear(logFocus.api.getState().seq);
  landing.api.setState({ holding: new Map() });
});

describe("FR-DICE-35 log die chips (GameLog)", () => {
  // FR-KIT-45: the chips are in the entry Tooltip's line now; the row shows the result boxes.
  test("FR-DICE-35 log die chips: a dice-log-die wrapper per chip with the inner data-shape", () => {
    const html = details([
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
    // The dropped die stays struck markup (`<s>`), as its text was in sprint 3.
    expect(html).toMatch(/<s data-testid="dice-log-die"[^>]*data-value="4" data-kept="false"/);
    // No element carries two test IDs (review B31): the wrapper and the shape are separate.
    expect(html).not.toMatch(/data-testid="[^"]*"[^>]*data-testid=/);
    expect(html).toContain("Athletics");
    expect(html).toContain('aria-label="d20: 13"');
  });

  test("FR-DICE-35 log die chips: chips in the roller's look (stored row, else the default)", () => {
    const html = details([
      entry(),
      entry({ id: "e2", n: 2, rollerPlayerId: "p2", actorName: "Thorn" }),
      entry({ id: "e3", n: 3, rollerRole: "dm", rollerPlayerId: null, actorName: "Goblin" }),
    ]);
    const rows = html.split('data-testid="dice-log-entry-details"').slice(1);
    expect(rows[0]).toContain(`fill="${STYLE_LOOK.gold.body}"`); // player-1: stored Gold
    expect(rows[1]).toContain(`fill="${STYLE_LOOK.sapphire.body}"`); // player-2: default
    expect(rows[2]).toContain(`fill="${STYLE_LOOK.obsidian.body}"`); // DM: Obsidian
  });

  test("FR-DICE-35 log die chips: a chip fits the line (18 px, centred, no taller line box)", () => {
    const html = details([entry()]);
    expect(html).toContain('width="18" height="18"');
    expect(html).toMatch(/data-testid="dice-log-die"[^>]*class="[^"]*-my-0\.5[^"]*align-middle/);
  });
});

/** The element opening at `from`, as markup (static render, balanced tags). */
function elementAt(html: string, from: number): string {
  const tag = /<(\/?)[a-z][\w-]*[^>]*?(\/?)>/gi;
  tag.lastIndex = from;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (m[2]) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, tag.lastIndex);
  }
  return html.slice(from);
}

/** Its text content: the text nodes in order. */
function textContentAt(html: string, from: number): string {
  return elementAt(html, from)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

describe("FR-DICE-93 a log line copies as one line (BL-57)", () => {
  test("FR-DICE-93 line copies as one line: the value is a text node outside <svg>, no inline-flex, textContent = lineText", () => {
    const kh3 = entry({
      id: "e2",
      n: 2,
      actorName: "Brakka",
      payload: [
        {
          rollId: "r2",
          expression: "4d6kh3",
          mode: "normal",
          manual: true,
          dice: [
            { faces: 6, value: 5, kept: true },
            { faces: 6, value: 3, kept: false },
            { faces: 6, value: 6, kept: true },
            { faces: 6, value: 6, kept: true },
          ],
          constant: 0,
          total: 17,
          natural: null,
          label: null,
        },
      ],
    });
    const d100 = entry({
      id: "e3",
      n: 3,
      payload: [
        {
          rollId: "r3",
          expression: "1d100+2",
          mode: "normal",
          manual: false,
          dice: [{ faces: 100, value: 47, kept: true }],
          constant: 2,
          total: 49,
          natural: null,
          label: "Wild",
        },
      ],
    });
    const entries = [entry(), kh3, d100];
    // FR-KIT-45: the line with its chips is the entry Tooltip's.
    const html = details(entries);
    // No `<text>` in any svg; no inline-flex on a line, its chips or its badges.
    expect(html).not.toContain("<text");
    const starts = [...html.matchAll(/<span[^>]*data-testid="dice-log-entry-line"/g)].map(
      (m) => m.index ?? 0,
    );
    expect(starts).toHaveLength(3);
    starts.forEach((at, i) => {
      expect(elementAt(html, at)).not.toContain("inline-flex");
      const e = entries[i] as GameLogEntryView;
      const segs = formatEntry(e).segments;
      // lineText's markup (dropped "~3~", badge "(physical)") aside, digit for digit.
      const plain = segs.map((s) => s.text).join("");
      expect(lineText(segs).replace(/~/g, "").replace("(physical)", "physical")).toBe(plain);
      expect(textContentAt(html, at)).toBe(plain);
    });
    expect(textContentAt(html, starts[0] ?? 0)).toBe("Mira — Athletics (adv): 13 4 + 5 = 18");
    expect(textContentAt(html, starts[1] ?? 0)).toBe("Brakka — 4d6kh3: 5 3 + 6 + 6 = 17 physical");
    expect(textContentAt(html, starts[2] ?? 0)).toBe("Mira — Wild: 47 + 2 = 49");
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

  test("FR-DICE-37 FR-DICEX-39 focusLogEntry: the default timers run unbound (no 'Illegal invocation'); the highlight clears after 2 s", () => {
    // Browser-strict fake timers: like the DOM's, they throw when called on another receiver.
    const { timers, advance } = fakeTimers();
    const g = globalThis as { setTimeout: unknown; clearTimeout: unknown };
    const real = { setTimeout: g.setTimeout, clearTimeout: g.clearTimeout };
    const strict = <A extends unknown[], R>(f: (...a: A) => R) =>
      function (this: unknown, ...a: A): R {
        if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
        return f(...a);
      };
    g.setTimeout = strict(timers.setTimeout);
    g.clearTimeout = strict(timers.clearTimeout);
    try {
      const f = createLogFocus();
      expect(() => f.focus("e1")).not.toThrow();
      expect(() => f.focus("e1")).not.toThrow();
      expect(f.api.getState().entryId).toBe("e1");
      advance(FOCUS_MS);
      expect(f.api.getState().entryId).toBeNull();
    } finally {
      Object.assign(g, real);
    }
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

describe("FR-DICE-40 log line held", () => {
  /** Hold `ids` as the live-throw path does while their dice fly (FR-DICEX-49). */
  const hold = (...ids: string[]) =>
    landing.api.setState({ holding: new Map(ids.map((id) => [id, 6000])) });
  const rowOf = (html: string, id: string) =>
    html.split('data-testid="dice-log-entry"').find((r) => r.includes(`data-record-id="${id}"`)) ??
    "";

  test("FR-DICE-40 log line held: blank chips (no data-value, dropped kept), total and adv marker '…', aria-busy, no natural marker; others shown", () => {
    hold("e1");
    const html = render([entry(), entry({ id: "e2", n: 2 })]);
    const held = rowOf(html, "e1");
    expect(held).toContain('data-landed="false"');
    expect(held).toContain('aria-busy="true"');
    // FR-KIT-44: the row's box reads "…" with no outcome; the screen reader's line is held too.
    expect(held).toMatch(/data-testid="dice-log-entry-total"[^>]*data-held=""[^>]*>…</);
    expect(held).not.toMatch(/data-testid="dice-log-entry-total"[^>]*data-outcome/);
    expect(held).toContain("Mira — Athletics (…): … … + 5 = …");
    expect(held).not.toContain(">18<");
    expect(held).not.toContain("natural");

    // FR-KIT-45: the Tooltip's line: two blank chips in the look, the dropped one still struck.
    const tip = details([entry()]);
    expect(tip).not.toMatch(/data-testid="dice-log-die"[^>]*data-value=/);
    expect(tip).toMatch(/<s data-testid="dice-log-die"[^>]*data-kept="false"/);
    expect(tip.match(/data-shape="d20"/g)).toHaveLength(2);
    expect(tip).not.toContain("<text");
    expect(tip).toContain("<span>Athletics</span><span> (…)</span>");
    expect(tip).toContain(">…</strong>");
    expect(tip).not.toContain(">18<");
    expect(tip).not.toContain("natural");
    // Actor, label and category are not held.
    expect(tip).toContain("Mira");
    expect(tip).toContain("Skill check");

    const shown = rowOf(html, "e2");
    expect(shown).toContain('data-landed="true"');
    expect(shown).not.toContain("aria-busy");
    expect(shown).toMatch(/data-testid="dice-log-entry-total"[^>]*>18</);
    expect(details([entry({ id: "e2", n: 2 })])).toContain('data-value="13"');
  });

  test("FR-DICE-40 at the landing the numbers show (and fade in: each number carries data-landing)", () => {
    hold("e1");
    expect(render([entry()])).toContain('data-landed="false"');
    landing.api.setState({ holding: new Map() });
    const html = render([entry()]);
    expect(html).toContain('data-landed="true"');
    expect(html).toMatch(/data-testid="dice-log-entry-total"[^>]*data-landing="true"[^>]*>18</);
    const tip = details([entry()]);
    expect(tip).toMatch(/data-testid="dice-log-die"[^>]*data-value="13"[^>]*data-landing="true"/);
    expect(tip).toContain('<strong data-landing="true" class="font-semibold">18</strong>');
  });

  test("FR-DICE-40 render only: lineText and the stored entry unchanged; held segments keep every non-number run", () => {
    const e = entry();
    const before = JSON.stringify(e);
    hold("e1");
    render([e]);
    expect(JSON.stringify(e)).toBe(before);
    const segs = [
      { text: "Mira", style: "actor" as const },
      { text: " — " },
      { text: "Attack" },
      { text: " (dis: Prone)" },
      { text: ": " },
      { text: "1", die: { faces: 20, value: 1, kept: true } },
      { text: " + 5" },
      { text: " = " },
      { text: "6", style: "total" as const },
      { text: " — natural 1" },
      { text: " " },
      { text: "physical", style: "badge" as const },
    ];
    expect(
      heldSegments(segs)
        .map((s) => s.text)
        .join(""),
    ).toBe("Mira — Attack (…): … + 5 = … physical");
    expect(heldSegments(segs).find((s) => s.die)?.blank).toBe(true);
  });
});
