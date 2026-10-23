// FR-NOTE-75 (sprint 10, H3; BL-101): where a window body's drawn content ends, from its boxes in
// document order (the runtime walks the body's leaf elements and record rows).
import { describe, expect, test } from "bun:test";
import { contentEnd } from "./stack-inputs";

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
