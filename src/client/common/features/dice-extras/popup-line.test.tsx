// The popup line (FR-DICEX-46, -47; DICEX §6.1 tables A, B): the pure cell layout, "+N", tags,
// hand-off flights and pixel budget, the short-screen fit, and the static render of the cards
// (cells, `data-shown`, per-row totals) inside a shell over the page's popup store. T5 (DM #347):
// the card × 1.4 (62-px cells, 448 × ≤ 268), today's 320 × 190 where the viewport can't hold it.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type DiceThrow, throwDice } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { EDGE_GAP, TOP_BAR_H } from "../play-shell/geometry";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import {
  popupRegion,
  ROLL_POPUP_H,
  ROLL_POPUP_W,
  ROLL_POPUPS_MAX,
} from "../play-shell/toast-region";
import { landing } from "./landing";
import {
  cellTag,
  POPUP_BASE,
  POPUP_BIG,
  POPUP_SCALE,
  popupGeomAt,
  popupHeight,
  popupLine,
  popupsThatFit,
} from "./popup-logic";
import { CELL_STILL_PAD, rollPopups } from "./popups";
import { RollPopupStack } from "./RollPopup";
import type { DisplaySetting } from "./settings";
import { diceExtras } from "./store";
import { handoffFlights } from "./Throw3D";

const g = globalThis as { window?: unknown; document?: unknown };
const setViewport = (w: number, h: number) => {
  g.window = { innerWidth: w, innerHeight: h, addEventListener() {}, removeEventListener() {} };
};
beforeAll(() => {
  setViewport(1280, 720);
  g.document = { title: "", hidden: false };
});
afterAll(() => {
  delete g.window;
  delete g.document;
});
afterEach(() => {
  diceExtras.failed();
  rollPopups.api.setState({ popups: [] });
  landing.api.setState({ holding: new Map() });
});

const d6s = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ faces: 6, value: ((from + i - 1) % 6) + 1, kept: true }));

const item = (o: Record<string, unknown> = {}) => ({
  rollId: "r1",
  expression: "1d6",
  mode: "normal",
  manual: false,
  dice: d6s(1),
  constant: 0,
  total: 1,
  natural: null,
  label: null,
  ...o,
});

const entry = (o: Partial<GameLogEntryView> = {}, items: unknown[] = [item()]) =>
  ({
    id: "e1",
    n: 1,
    kind: "roll",
    category: "other",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Thorn",
    payload: items,
    ...o,
  }) as unknown as GameLogEntryView;

/** One entry rolling `n`d6. */
const nd6 = (n: number, id = "e1", at = 1) =>
  entry({ id, n: at }, [
    item({ rollId: `r${id}`, expression: `${n}d6`, dice: d6s(n), total: n * 3, label: `${n}d6` }),
  ]);

const throwOf = (entries: GameLogEntryView[]) => throwDice(entries) as DiceThrow;

function render(role: "dm" | "player" = "player", display: DisplaySetting = "flat") {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ShellProvider registry={createWindowRegistry(role, [])}>
          <RollPopupStack client={role} display={display} />
        </ShellProvider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const attr = (html: string, testId: string, name: string) =>
  new RegExp(`data-testid="${testId}"[^>]*?${name}="([^"]*)"`).exec(html)?.[1];

/** Each `dicex-popup-cell`'s attributes, in document order. */
const cellsOf = (html: string) =>
  [...html.matchAll(/<span[^>]*data-testid="dicex-popup-cell"[^>]*>/g)].map((m) => {
    const tag = m[0];
    const a = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(tag)?.[1];
    return {
      entry: a("data-entry-id"),
      line: a("data-line"),
      index: a("data-index"),
      value: a("data-value"),
      style: a("style"),
    };
  });

describe("FR-DICEX-46 popup line layout", () => {
  test("FR-DICEX-46 popup line layout: 1, 4, 10, 20 d6 → 1 × 1, 1 × 4, 2 lines (6 + 4), 11 + '+9' (the 12th die's entry)", () => {
    const of = (n: number) => popupLine(throwOf([nd6(n)]).dice);
    const lines = (n: number) => {
      const l = of(n);
      return [1, 2].map((k) => l.cells.filter((c) => c.line === k).length);
    };
    expect(lines(1)).toEqual([1, 0]);
    expect(of(1).lines).toBe(1);
    expect(lines(4)).toEqual([4, 0]);
    expect(lines(10)).toEqual([6, 4]);
    expect(of(10).more).toBeNull();
    expect(lines(12)).toEqual([6, 6]);
    expect(of(12).more).toBeNull();
    const twenty = of(20);
    expect(lines(20)).toEqual([6, 5]);
    expect(twenty.more).toMatchObject({ n: 9, line: 2, index: 11 });
    // The first hidden die's entry: a frame of 10d6 (e1) + 10d6 (e2) → the 12th die is e2's.
    const two = throwOf([nd6(10, "e1", 1), nd6(10, "e2", 2)]);
    const both = popupLine(two.dice, two.more);
    expect(both.more).toMatchObject({ n: 9, entryId: "e2" });
    expect(both.cells.map((c) => c.die.entryId)).toEqual([...Array(10).fill("e1"), "e2"]);
    // Dice beyond the throw's 20 count in "+N" too (FR-DICEX-14).
    expect(popupLine(two.dice, 5).more?.n).toBe(14);
  });

  test("FR-DICEX-46 popup line layout: 62 px cells (T5: 44 × 1.4), 6 px gap, 6 per line, never scaled by the count, at 1280×720 and 1920×1080; today's 44 px at 390×844; throwDice order", () => {
    const l = popupLine(throwOf([nd6(10)]).dice);
    expect(l.cells.map((c) => [c.x, c.y])).toEqual([
      ...[0, 1, 2, 3, 4, 5].map((i) => [i * 68, 0]),
      ...[0, 1, 2, 3].map((i) => [i * 68, 68]),
    ]);
    expect([POPUP_BIG.cell, POPUP_BIG.gap, POPUP_BIG.lineW, l.h]).toEqual([62, 6, 402, 130]);
    const base = popupLine(throwOf([nd6(10)]).dice, 0, POPUP_BASE);
    expect([POPUP_BASE.cell, POPUP_BASE.gap, POPUP_BASE.lineW, base.h]).toEqual([44, 4, 284, 92]);
    expect(base.cells[7]).toMatchObject({ x: 48, y: 48 });
    for (const [w, h, px] of [
      [390, 844, 44],
      [1280, 720, 62],
      [1920, 1080, 62],
    ] as const) {
      setViewport(w, h);
      rollPopups.add({ entries: [nd6(10)], looks: {}, big: null, threeD: false });
      const cells = cellsOf(render());
      expect(cells).toHaveLength(10);
      for (const c of cells) expect(c.style).toContain(`width:${px}px;height:${px}px`);
      expect(cells.map((c) => c.index)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
      expect(cells.map((c) => c.line)).toEqual([...Array(6).fill("1"), ...Array(4).fill("2")]);
      rollPopups.api.setState({ popups: [] });
    }
    setViewport(1280, 720);
  });

  test("FR-DICEX-46 popup line layout: a 20d6 popup → 11 cells + dicex-popup-more '+9'; data-dice = all, data-shown = cells; each cell has its entry", () => {
    rollPopups.add({
      entries: [nd6(10, "e1", 1), nd6(10, "e2", 2)],
      looks: {},
      big: null,
      threeD: false,
    });
    const html = render();
    expect(attr(html, "dicex-popup", "data-dice")).toBe("20");
    expect(attr(html, "dicex-popup", "data-shown")).toBe("11");
    expect(attr(html, "dicex-popup-more", "data-value")).toBe("9");
    expect(attr(html, "dicex-popup-more", "data-entry-id")).toBe("e2");
    expect(html).toMatch(/data-testid="dicex-popup-more"[^>]*>\+9</);
    const cells = cellsOf(html);
    expect(cells).toHaveLength(11);
    expect(cells.every((c) => c.entry === "e1" || c.entry === "e2")).toBe(true);
  });

  test("FR-DICEX-46 popup line layout: mixed frame (d20 adv + 2d6 + offered 1d6) → dropped dimmed, offered dashed, its tag cut to the cell with the full text for the Tooltip", () => {
    const mixed = entry({ id: "m1" }, [
      item({
        rollId: "ra",
        expression: "1d20+5",
        mode: "advantage",
        dice: [
          { faces: 20, value: 17, kept: true },
          { faces: 20, value: 4, kept: false },
        ],
        constant: 5,
        total: 22,
        natural: 17,
        label: "Longsword",
        offered: [{ rollId: "ro", label: "Divine Fury", value: 5, expression: "1d6", dice: [5] }],
      }),
      item({ rollId: "rb", expression: "2d6", dice: d6s(2, 3), total: 7, label: "Damage" }),
    ]);
    const t = throwOf([mixed]);
    const line = popupLine(t.dice);
    expect(line.cells).toHaveLength(5);
    const offered = line.cells.find((c) => c.die.offered);
    expect(offered && cellTag(offered.die)).toEqual({
      tag: "Divine Fury",
      full: "Divine Fury on a hit",
    });
    expect(cellTag(line.cells[0]?.die as never)).toBeNull();
    rollPopups.add({ entries: [mixed], looks: {}, big: null, threeD: false });
    const html = render();
    expect(attr(html, "dicex-popup", "data-dice")).toBe(String(t.dice.length));
    expect(attr(html, "dicex-popup", "data-shown")).toBe(String(t.dice.length));
    // Dropped dimmed (struck), offered dashed (chips draw both).
    expect(html).toMatch(
      /data-testid="dicex-die"[^>]*data-kept="false"[^>]*class="[^"]*opacity-40/,
    );
    expect(html).toMatch(/data-testid="dicex-die"[^>]*data-offered="true"/);
    expect(html).toContain('stroke-dasharray="12 9"');
    // The tag: on the cell's bottom edge, cut to the cell's width.
    expect(html).toMatch(/class="absolute -bottom-1 left-0 w-full truncate[^"]*">Divine Fury</);
  });

  test("FR-DICEX-46 popup line layout: hand-off targets = cell centres, the die at full size (62 px, T5), turned upright; dice past cell 11 target '+N' and fade", () => {
    const cell = (i: number) => ({
      x: 800 + (i % 6) * 68,
      y: 500 + Math.floor(i / 6) * 68,
      w: 62,
      h: 62,
    });
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const turns: Record<string, number> = {};
    const cells = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let i = 0; i < 13; i++) {
      boxes[`e1:${i}`] = { x: 100 + i * 70, y: 300, w: 66, h: 66 };
      turns[`e1:${i}`] = 0.5;
      if (i < 11) cells.set(`e1:${i}`, cell(i));
    }
    const more = cell(11);
    const flights = handoffFlights(boxes, cells, more, turns);
    expect(flights.size).toBe(13);
    for (const [key, f] of flights) {
      const box = boxes[key] as { x: number; y: number; w: number; h: number };
      const i = Number(key.split(":")[1]);
      const to = i < 11 ? cell(i) : more;
      expect(f.fade).toBe(i >= 11);
      expect(f.turn).toBe(i < 11 ? 0.5 : 0);
      // The box holds the die and its margin: the die itself ends as wide as its cell.
      expect((box.w * f.k) / CELL_STILL_PAD).toBeCloseTo(62);
      // The box's centre after the flight = the target cell's centre.
      expect(box.x + box.w / 2 + f.dx).toBeCloseTo(to.x + to.w / 2);
      expect(box.y + box.h / 2 + f.dy).toBeCloseTo(to.y + to.h / 2);
    }
    // No "+N" on screen: dice without a cell don't fly.
    expect(handoffFlights(boxes, cells, null).size).toBe(11);
  });

  test("FR-DICEX-46 popup line layout: handoff / play / chips give the same cells", () => {
    const cellsIn = (big: boolean, threeD: boolean, display: DisplaySetting) => {
      rollPopups.add({
        entries: [nd6(4)],
        looks: {},
        big: big ? { id: "e1", entryIds: ["e1"] } : null,
        threeD,
      });
      const html = render("player", display);
      rollPopups.api.setState({ popups: [] });
      return {
        mode: attr(html, "dicex-popup-pip", "data-mode"),
        cells: cellsOf(html).map(({ entry: e, line: l, index, style }) => ({ e, l, index, style })),
      };
    };
    const handoff = cellsIn(true, true, "screen");
    const play = cellsIn(false, true, "screen");
    const chips = cellsIn(false, false, "flat");
    expect([handoff.mode, play.mode, chips.mode]).toEqual(["handoff", "play", "chips"]);
    expect(handoff.cells).toHaveLength(4);
    expect(play.cells).toEqual(handoff.cells);
    expect(chips.cells).toEqual(handoff.cells);
  });

  test("FR-DICEX-46 FR-DICEX-49 a cell's data-value only once its entry landed", () => {
    rollPopups.add({ entries: [nd6(3)], looks: {}, big: null, threeD: false });
    landing.hold(["e1"]);
    expect(cellsOf(render()).map((c) => c.value)).toEqual([undefined, undefined, undefined]);
    rollPopups.rested("e1", "play");
    expect(cellsOf(render()).map((c) => c.value)).toEqual(["1", "2", "3"]);
  });
});

describe("FR-DICEX-47 popup size", () => {
  test("FR-DICEX-47 popup size (T5, DM #347): × 1.4 of table B: ≤ 448 × 268 with 3 rows and 2 dice lines, 138 px with 1 row + 1 line; today's 320 × 190 / 98 kept for small viewports", () => {
    expect(POPUP_SCALE).toBe(1.4);
    // Table B (W1's keep-out constants) × 1.4, whole px: pad 14, rows 31, gap 11, tag 6.
    expect([ROLL_POPUP_W, ROLL_POPUP_H]).toEqual([320, 190]);
    expect(POPUP_BIG).toMatchObject({ w: 448, maxH: 268, pad: 14, row: 31, rowsGap: 11, tag: 6 });
    expect(popupHeight(3, 2)).toBe(POPUP_BIG.maxH);
    expect(popupHeight(5, 2)).toBe(POPUP_BIG.maxH); // rows beyond 3 scroll inside
    expect(popupHeight(1, 1)).toBe(138);
    expect(popupHeight(1, 2)).toBe(206);
    expect(POPUP_BASE).toMatchObject({ w: ROLL_POPUP_W, maxH: ROLL_POPUP_H, pad: 10, row: 22 });
    expect(popupHeight(3, 2, POPUP_BASE)).toBe(190);
    expect(popupHeight(1, 1, POPUP_BASE)).toBe(98);
    // The line fits the card's inner width (448 − 2 × 16; 320 − 2 × 12).
    for (const g of [POPUP_BIG, POPUP_BASE]) {
      expect(g.lineW).toBeLessThanOrEqual(g.w - 2 * (g.pad + 2));
    }
    // The big card wherever the viewport holds it (desktop, both clients), else today's.
    for (const client of ["dm", "player"] as const) {
      expect(popupGeomAt(client, { w: 1280, h: 720 })).toBe(POPUP_BIG);
      expect(popupGeomAt(client, { w: 1920, h: 1080 })).toBe(POPUP_BIG);
      expect(popupGeomAt(client, { w: 390, h: 844 })).toBe(POPUP_BASE);
      // K5: the player's corner 20 px above the bottom edge: 330 is short for both clients.
      expect(popupGeomAt(client, { w: 1280, h: 330 })).toBe(POPUP_BASE);
    }
    rollPopups.add({ entries: [nd6(1)], looks: {}, big: null, threeD: false });
    const html = render();
    expect(html).toContain(
      "width:448px;max-height:268px;gap:11px;padding-block:13px;padding-inline:15px",
    );
    expect(attr(html, "dicex-popup", "data-scale")).toBe("1.4");
    // Numbers, name line and total bigger (14 → 20 px; markers 12 → 17), the die 62 px.
    expect(html).toMatch(/data-testid="dicex-popup-row"[^>]*class="[^"]*text-xl/);
    expect(html).toMatch(/data-testid="dicex-popup-total" class="[^"]*text-xl/);
    expect(html).toMatch(/<svg viewBox="0 0 100 100" width="62" height="62"/);
    expect(html).toMatch(/data-face="1"[^>]*style="[^"]*font-size:28.52px/);
    expect(html).toMatch(/class="[^"]*size-7"[^>]*data-testid="dicex-popup-close"/);
    setViewport(390, 844);
    const small = render();
    expect(small).toContain(
      "width:320px;max-height:190px;gap:8px;padding-block:9px;padding-inline:11px",
    );
    expect(small).toMatch(/data-testid="dicex-popup-total" class="[^"]*text-sm/);
    setViewport(1280, 720);
  });

  test("FR-DICEX-47 popup size: each row's total at its right, in its own row", () => {
    const rows = ["a", "b", "c"].map((id, i) =>
      entry({ id, n: i + 1, actorName: `Actor ${id}` }, [
        item({ rollId: `r${id}`, total: 10 + i, label: `Roll ${id}` }),
      ]),
    );
    rollPopups.add({ entries: rows, looks: {}, big: null, threeD: false });
    const html = render();
    const inRow = [
      ...html.matchAll(
        /data-testid="dicex-popup-row" data-record-id="(\w)"[^>]*>(?:(?!<\/button>).)*?data-testid="dicex-popup-total"[^>]*>(\d+)</g,
      ),
    ].map((m) => [m[1], m[2]]);
    expect(inRow).toEqual([
      ["a", "10"],
      ["b", "11"],
      ["c", "12"],
    ]);
    expect(html).toContain("max-height:93px");
  });

  test("FR-DICEX-47 popup size: short screen → only the popups that fit the toast region (oldest dropped), none past the viewport or over the top bar; T5's bigger cards: fewer at once", () => {
    const H = POPUP_BIG.maxH;
    const three = [H, H, H];
    const toast = 40;
    const playerRoom = (vh: number, noteH: number) => {
      const r = popupRegion("player", noteH, 0);
      return vh - ("bottom" in r ? r.bottom : 0) - TOP_BAR_H - EDGE_GAP;
    };
    const dmRoom = (vh: number, noteH: number) => {
      const r = popupRegion("dm", noteH, 0);
      return vh - EDGE_GAP - ("top" in r ? r.top : 0);
    };
    // Full cards (3 rows, 2 lines, 268 px). 1280×720 with a toast: 2 each (room 592 on the
    // player's side since K5's corner moved down, 560 on the DM's); without a toast 2 each.
    // 1280×800, 1440×900: 2. 1920×1080: all 3.
    expect([playerRoom(720, toast), dmRoom(720, toast)]).toEqual([592, 560]);
    expect(popupsThatFit(three, playerRoom(720, toast))).toBe(2);
    expect(popupsThatFit(three, dmRoom(720, toast))).toBe(2);
    expect(popupsThatFit(three, playerRoom(720, 0))).toBe(2);
    expect(popupsThatFit(three, dmRoom(720, 0))).toBe(2);
    for (const vh of [800, 900]) {
      expect(popupsThatFit(three, playerRoom(vh, toast)), `${vh}`).toBe(2);
      expect(popupsThatFit(three, dmRoom(vh, toast)), `${vh}`).toBe(2);
    }
    expect(popupsThatFit(three, playerRoom(1080, toast))).toBe(ROLL_POPUPS_MAX);
    expect(popupsThatFit(three, dmRoom(1080, toast))).toBe(ROLL_POPUPS_MAX);
    // A one-line roll (1 row, 1 line: 138 px): all 3 even at 1280×720 with a toast.
    const one = popupHeight(1, 1);
    expect(popupsThatFit([one, one, one], playerRoom(720, toast))).toBe(3);
    expect(popupsThatFit([one, one, one], dmRoom(720, toast))).toBe(3);
    // Smaller cards fit more; the newest always shows.
    expect(popupsThatFit([98, 98, 98], playerRoom(720, toast))).toBe(3);
    expect(popupsThatFit([H], 50)).toBe(1);
    // The store drops the oldest at once.
    for (const id of ["a", "b", "c"]) {
      rollPopups.add({ entries: [nd6(1, id)], looks: {}, big: null, threeD: false });
    }
    rollPopups.drop(["a"]);
    expect(rollPopups.api.getState().popups.map((p) => p.id)).toEqual(["b", "c"]);
  });
});
