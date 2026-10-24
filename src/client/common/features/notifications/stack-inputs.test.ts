// FR-NOTE-75 (sprint 10, H3; BL-101): where a window body's drawn content ends, from its boxes in
// document order (the runtime walks the body's leaf elements and record rows). Sprint 11 (F2):
// FR-NOTE-78 records (BL-108).
import { describe, expect, test } from "bun:test";
import {
  contentEnd,
  firstRowEnd,
  LOG_ROWS,
  newestRows,
  outerRecords,
  ROW_MAX_H,
} from "./stack-inputs";

const box = (top: number, bottom: number) => ({ top, bottom });

describe("FR-NOTE-75 content end", () => {
  // sim-13 h07: Scenes' body 145..522; New scene row, "Goblin Ambush", "Town".
  const top = 145;
  const bottom = 522;

  test("FR-NOTE-75 content end: the lowest drawn box inside the body (Scenes' two rows → 268)", () => {
    const rows = [box(156, 190), box(160, 186), box(196, 232), box(232, 268)];
    expect(contentEnd(top, bottom, rows)).toBe(268);
  });

  test("FR-NOTE-75 content end: a full or scrolled body ends at its bottom (rows past it are clipped)", () => {
    const rows = Array.from({ length: 20 }, (_, i) => box(156 + i * 36, 192 + i * 36));
    expect(contentEnd(top, bottom, rows)).toBe(bottom);
    // Rows scrolled above the body don't count; a row below it doesn't either.
    expect(contentEnd(top, bottom, [box(80, 120), box(150, 200)])).toBe(200);
    expect(contentEnd(top, bottom, [box(600, 640)])).toBeNull();
  });

  test("FR-NOTE-75 content end: empty or zero-height boxes → null (nothing drawn)", () => {
    expect(contentEnd(top, bottom, [])).toBeNull();
    expect(contentEnd(top, bottom, [box(300, 300)])).toBeNull();
  });

  test("FR-NOTE-75 content end: stops at the first box reaching the bottom", () => {
    let read = 0;
    function* boxes() {
      for (const b of [box(160, 200), box(480, 560), box(160, 170)]) {
        read++;
        yield b;
      }
    }
    expect(contentEnd(top, bottom, boxes())).toBe(bottom);
    expect(read).toBe(2);
  });
});

describe("FR-NOTE-77 first rows", () => {
  // Walkthrough H3 4: the Encounters editor at 68, 60; its body 93..470. The editor's root carries
  // `data-record-id` and fills the body; the first entry row is 196..248.
  const top = 93;
  const bottom = 470;

  test("FR-NOTE-77 first rows: a record container filling the body is skipped; the first row-sized record row ends them", () => {
    expect(firstRowEnd(top, bottom, [box(93, 470), box(196, 248), box(252, 304)])).toBe(248);
    // Rules: tabs and search above the first card (370..418).
    expect(firstRowEnd(212 + 33, 572, [box(370, 418), box(426, 474)])).toBe(418);
  });

  test("FR-NOTE-77 first rows: rows scrolled out of the body don't count; none → null", () => {
    expect(firstRowEnd(top, bottom, [box(40, 80), box(300, 340)])).toBe(340);
    expect(firstRowEnd(top, bottom, [box(93, 470)])).toBeNull();
    expect(firstRowEnd(top, bottom, [])).toBeNull();
    expect(firstRowEnd(top, bottom, [box(100, 100 + ROW_MAX_H + 1)])).toBeNull();
  });
});

describe("FR-NOTE-77 a log's newest rows", () => {
  // Walkthrough H3 re-test 3: the Game log at 68, 484 (1280×720), body 517..643; entries scrolled
  // so the oldest is clipped at the top, the newest end at 597 above the roll bar.
  test("FR-NOTE-77 a log's newest rows: the last 3 row-sized entries drawn in the body", () => {
    const entries = [box(380, 401), box(501, 534), box(534, 555), box(555, 576), box(576, 597)];
    expect(newestRows(517, 643, entries)).toEqual([box(534, 555), box(555, 576), box(576, 597)]);
    // A tall record (not a row) and entries out of the body don't count.
    expect(newestRows(517, 643, [box(517, 643), box(650, 670)])).toEqual([]);
    expect(LOG_ROWS).toBe(3);
  });
});

describe("FR-NOTE-78 records", () => {
  // sim-14 e09: Roll requests' body 92..470; the target chips are buttons with a record id, each
  // request card holds its target rows (records too).
  type R = { id: string; top: number; bottom: number; control: boolean; parent?: string };
  const rec = (id: string, top: number, bottom: number, control = false, parent?: string): R => ({
    id,
    top,
    bottom,
    control,
    ...(parent ? { parent } : {}),
  });
  const walk = (list: R[]) => list.map((r) => ({ ...r, inside: (o: R) => r.parent === o.id }));

  test("FR-NOTE-78 records: the outermost row-sized records that aren't controls, in document order", () => {
    const list = walk([
      rec("chip-all", 174, 197, true),
      rec("chip-brakka", 174, 197, true),
      rec("insight", 276, 366),
      rec("insight-brakka", 296, 312, false, "insight"),
      rec("insight-mira", 312, 328, false, "insight"),
      rec("perception", 372, 459),
      rec("perception-brakka", 392, 408, false, "perception"),
    ]);
    expect(outerRecords(92, 470, list).map((r) => r.id)).toEqual(["insight", "perception"]);
  });

  test("FR-NOTE-78 records: a container taller than a row doesn't count, the rows inside it do; rows out of the body don't", () => {
    const list = walk([
      rec("editor", 93, 470),
      rec("goblin", 196, 248, false, "editor"),
      rec("wolf", 252, 304, false, "editor"),
      rec("below", 480, 500),
    ]);
    expect(outerRecords(92, 470, list).map((r) => r.id)).toEqual(["goblin", "wolf"]);
    // Up to half the body: a request card with its buttons (122 px) counts in a 378-px body,
    // not in a 200-px one (its rows do).
    expect(outerRecords(92, 470, walk([rec("card", 275, 397)])).map((r) => r.id)).toEqual(["card"]);
    expect(outerRecords(92, 292, walk([rec("big", 100, 100 + ROW_MAX_H + 1)]))).toEqual([]);
  });
});
