// FR-NOTE-78 (BL-108, sprint 11 F2): the DM stack keeps off windows' primary content (headings,
// the first record) before the fallback's fewest controls, and off the damage-card popup whole.
// Session-sim-14 (`.verify/20261024-061849-session-sim-14/`) e09, g01, r02: rects as the
// screenshots draw them; each repro first runs without the new inputs (`primary`, `records`,
// `popups`) to show where the stack sat.
import { describe, expect, test } from "bun:test";
import { dmStackSpot, STACK_W, type StackWindow } from "./keep-out";

type Box = { x: number; y: number; w: number; h: number };

const hits = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const stack = (p: { left: number; top: number }, h: number): Box => ({
  x: p.left,
  y: p.top,
  w: STACK_W,
  h,
});
/** The window as the runtime measured it before FR-NOTE-78. */
const old = ({ primary: _p, records: _r, ...w }: StackWindow): StackWindow => w;

/** The summary toast ("N pending actions"), as drawn in sim-14. */
const SUMMARY_H = 57;

describe("FR-NOTE-78 keep off windows' primary content", () => {
  // e09: 1280×720, Roll requests at 504, 60 (360 × 410) over the home column, Initiative right of
  // it, the Game log at the bottom; "7 pending actions" sat on the Insight card (title + names).
  const small = { w: 1280, h: 720 };
  const init720 = { x: 868, y: 60, w: 400, h: 583 };
  const insight = { x: 517, y: 276, w: 334, h: 90 };
  const perception = { x: 517, y: 372, w: 334, h: 87 };
  const newRequest = { x: 517, y: 110, w: 80, h: 16 };
  const requests: StackWindow = {
    x: 504,
    y: 60,
    w: 360,
    h: 410,
    used: 470,
    // The target chips are the first records (buttons with a record id).
    head: 197,
    controls: [
      { x: 829, y: 110, w: 20, h: 20 },
      { x: 517, y: 138, w: 145, h: 27 },
      { x: 669, y: 138, w: 182, h: 27 },
      { x: 517, y: 174, w: 54, h: 23 },
      { x: 576, y: 174, w: 55, h: 23 },
      { x: 635, y: 174, w: 42, h: 23 },
      { x: 682, y: 174, w: 51, h: 23 },
      { x: 517, y: 206, w: 56, h: 26 },
      { x: 580, y: 212, w: 14, h: 14 },
      { x: 655, y: 206, w: 115, h: 26 },
      { x: 780, y: 208, w: 22, h: 22 },
      { x: 517, y: 239, w: 56, h: 27 },
      // The rolled totals (links to their log entries), right of the names.
      { x: 826, y: 307, w: 16, h: 15 },
      { x: 826, y: 323, w: 16, h: 15 },
      { x: 826, y: 340, w: 16, h: 15 },
      { x: 826, y: 403, w: 16, h: 15 },
      { x: 826, y: 419, w: 16, h: 15 },
      { x: 826, y: 435, w: 16, h: 15 },
    ],
    primary: [newRequest, insight],
    records: [perception],
  };
  const log720: StackWindow = {
    x: 68,
    y: 484,
    w: 690,
    h: 160,
    used: 644,
    head: 540,
    controls: [
      { x: 81, y: 608, w: 320, h: 28 },
      { x: 408, y: 608, w: 128, h: 28 },
      { x: 545, y: 610, w: 22, h: 22 },
      { x: 576, y: 608, w: 48, h: 28 },
      { x: 632, y: 610, w: 24, h: 24 },
      { x: 666, y: 610, w: 24, h: 24 },
    ],
    logRows: [
      { x: 81, y: 535, w: 664, h: 22 },
      { x: 81, y: 557, w: 664, h: 21 },
      { x: 81, y: 578, w: 664, h: 21 },
    ],
  };

  test("FR-NOTE-78 BL-108 sim-14 e09 (1280×720, Roll requests at 504, 60): the summary keeps off the 'New request' heading and the newest (Insight) card: below it, at 480, 374", () => {
    // The pending cards' targets: a Fire Elemental below the window's card list (its spot above
    // that token, 286, is where sim-14 drew the summary).
    const avoid = [{ x: 495, y: 355, w: 44, h: 44 }];
    // The repro: the fewest controls alone put it on the Insight card.
    const before = dmStackSpot(small, init720, SUMMARY_H, STACK_W, avoid, [log720, old(requests)]);
    expect(before).toMatchObject({ left: 480, top: 286 });
    expect(hits(stack(before, SUMMARY_H), insight)).toBe(true);
    const at = dmStackSpot(small, init720, SUMMARY_H, STACK_W, avoid, [log720, requests]);
    expect(at).toMatchObject({ left: 480, top: 374 });
    const r = stack(at, SUMMARY_H);
    for (const p of [newRequest, insight, ...(log720.logRows ?? [])])
      expect(hits(r, p)).toBe(false);
    for (const c of [...(requests.controls ?? []), ...(log720.controls ?? [])])
      expect(hits(r, c)).toBe(false);
    // Still on window content (the older card): the runtime keeps the summary alone.
    expect(at.covers).toBeGreaterThan(0);
  });

  test("FR-NOTE-78 BL-119 sim-15 c01 (1280×720, Roll requests at 504, 60): the summary keeps off the older (Perception) card's heading too: over its rows, at 480, 408", () => {
    const avoid = [{ x: 495, y: 355, w: 44, h: 44 }];
    // The Perception card's title line ("Perception · public · 3 / 3"), inside its p-2.
    const heading = { x: 526, y: 381, w: 316, h: 19 };
    // The repro (sim-15 c01: 480, 373): on the heading.
    const before = dmStackSpot(small, init720, SUMMARY_H, STACK_W, avoid, [log720, requests]);
    expect(before).toMatchObject({ left: 480, top: 374 });
    expect(hits(stack(before, SUMMARY_H), heading)).toBe(true);
    const at = dmStackSpot(small, init720, SUMMARY_H, STACK_W, avoid, [
      log720,
      { ...requests, headings: [heading] },
    ]);
    expect(at).toMatchObject({ left: 480, top: 408 });
    const r = stack(at, SUMMARY_H);
    for (const p of [newRequest, insight, heading, ...(log720.logRows ?? [])])
      expect(hits(r, p)).toBe(false);
    for (const c of [...(requests.controls ?? []), ...(log720.controls ?? [])])
      expect(hits(r, c)).toBe(false);
  });

  test("FR-NOTE-78 BL-108 sim-14 g01 (1440×900, Party Manager Loot at 424, 60): the summary leaves the wallets for the free row right of 'Party pot', above 'Wallets', at 560, 140", () => {
    const vp = { w: 1440, h: 900 };
    const init = { x: 1028, y: 60, w: 400, h: 512 };
    const wallets = [
      { x: 449, y: 235, w: 555, h: 18 },
      { x: 449, y: 259, w: 555, h: 18 },
      { x: 449, y: 283, w: 555, h: 18 },
    ];
    // "Party pot" sits in a row with Split… (as wide as its text); the others span the body.
    const headings = [
      { x: 449, y: 160, w: 55, h: 15 },
      { x: 449, y: 214, w: 555, h: 15 },
      { x: 449, y: 314, w: 555, h: 15 },
      { x: 449, y: 434, w: 555, h: 15 },
    ];
    const coinRow = (y: number) => [449, 560, 671, 782, 892].map((x) => ({ x, y, w: 107, h: 30 }));
    const pm: StackWindow = {
      x: 424,
      y: 60,
      w: 592,
      h: 512,
      used: 572,
      head: 253,
      controls: [
        ...[437, 533, 607, 683, 723, 813].map((x) => ({ x, y: 106, w: 74, h: 30 })),
        { x: 947, y: 157, w: 52, h: 22 },
        { x: 449, y: 334, w: 495, h: 31 },
        { x: 948, y: 334, w: 51, h: 31 },
        ...coinRow(370),
        { x: 449, y: 455, w: 280, h: 31 },
        { x: 736, y: 455, w: 263, h: 31 },
        ...coinRow(490),
        { x: 449, y: 525, w: 486, h: 31 },
        { x: 939, y: 525, w: 60, h: 31 },
      ],
      primary: [...headings, wallets[0] as Box],
      records: wallets.slice(1),
    };
    const log: StackWindow = {
      x: 68,
      y: 584,
      w: 1150,
      h: 240,
      used: 824,
      head: 650,
      controls: [
        { x: 81, y: 788, w: 320, h: 28 },
        { x: 408, y: 788, w: 128, h: 28 },
        { x: 545, y: 790, w: 22, h: 22 },
        { x: 576, y: 788, w: 48, h: 28 },
        { x: 632, y: 790, w: 24, h: 24 },
        { x: 666, y: 790, w: 24, h: 24 },
      ],
      logRows: [
        { x: 81, y: 716, w: 1130, h: 21 },
        { x: 81, y: 738, w: 1130, h: 21 },
        { x: 81, y: 759, w: 1130, h: 21 },
      ],
    };
    // The repro: on Mira's and Thorn's wallets (no control there).
    const before = dmStackSpot(vp, init, SUMMARY_H, STACK_W, [], [log, old(pm)]);
    expect(wallets.some((w) => hits(stack(before, SUMMARY_H), w))).toBe(true);
    const at = dmStackSpot(vp, init, SUMMARY_H, STACK_W, [], [log, pm]);
    expect(at).toMatchObject({ left: 560, top: 140 });
    const r = stack(at, SUMMARY_H);
    for (const p of [...wallets, ...headings, ...(log.logRows ?? [])])
      expect(hits(r, p)).toBe(false);
    for (const c of [...(pm.controls ?? []), ...(log.controls ?? [])])
      expect(hits(r, c)).toBe(false);
  });

  test("FR-NOTE-78 FR-NOTE-77 walkthrough H3 4 @ 396 kept (1280×720, Encounters at 396, 60, 376 wide, Escort selected; as the runtime measured it): the summary stays on the home row over the name fields, not lower in the form", () => {
    const enc: StackWindow = {
      x: 396,
      y: 60,
      w: 376,
      h: 412,
      used: 471,
      head: 246,
      controls: [
        { x: 409, y: 107, w: 32, h: 32 },
        { x: 449, y: 105, w: 240, h: 36 },
        { x: 409, y: 153, w: 350, h: 29 },
        ...[218, 274].flatMap((y) => [
          { x: 409, y, w: 28, h: 28 },
          { x: 473, y, w: 28, h: 28 },
          { x: 509, y, w: 192, h: 28 },
          { x: 727, y: y + 4, w: 36, h: 20 },
          { x: 771, y, w: 28, h: 28 },
        ]),
        { x: 409, y: 314, w: 16, h: 16 },
        { x: 534, y: 314, w: 16, h: 16 },
        { x: 409, y: 362, w: 16, h: 16 },
        { x: 409, y: 382, w: 16, h: 16 },
        { x: 409, y: 402, w: 16, h: 16 },
        { x: 409, y: 423, w: 86, h: 36 },
        { x: 503, y: 423, w: 73, h: 36 },
      ],
      // The Goblin entry rows: the first one is primary.
      primary: [{ x: 409, y: 194, w: 350, h: 52 }],
      records: [{ x: 409, y: 250, w: 350, h: 52 }],
    };
    const log: StackWindow = { ...log720, used: 636, head: 533 };
    const at = dmStackSpot(small, { ...init720, h: 584 }, 58, STACK_W, [], [log, enc]);
    expect(at.left).toBe(480);
    expect(at.top).toBeLessThanOrEqual(140);
    const r = stack(at, 58);
    for (const p of [...(enc.primary ?? []), ...(enc.records ?? [])])
      expect(hits(r, p)).toBe(false);
  });

  test("FR-NOTE-78 a spot clear of every window's content still wins first (FR-NOTE-75 pass 1 unchanged)", () => {
    // Roll requests moved right of home: the summary goes home over the map.
    const at = dmStackSpot(
      small,
      init720,
      SUMMARY_H,
      STACK_W,
      [],
      [log720, { ...requests, x: 900, primary: [], records: [] }],
      [],
      [],
    );
    expect(at).toMatchObject({ left: 480, top: 100, covers: 0 });
  });
});

describe("FR-NOTE-78 keep off the damage-card popup", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 512 };
  const scenes: StackWindow = { x: 68, y: 60, w: 260, h: 438, used: 210, head: 212 };
  const log: StackWindow = { x: 68, y: 584, w: 1150, h: 240, used: 824, head: 650 };
  // r02: Brakka's damage card popup at 377, 67 (440 × 258): heading, To hit / damage fields,
  // Add target, Dismiss / Later / Apply.
  const popup = {
    x: 377,
    y: 67,
    w: 440,
    h: 258,
    controls: [
      { x: 390, y: 150, w: 203, h: 32 },
      { x: 601, y: 150, w: 203, h: 32 },
      { x: 390, y: 237, w: 414, h: 32 },
      { x: 598, y: 281, w: 72, h: 32 },
      { x: 678, y: 281, w: 58, h: 32 },
      { x: 744, y: 281, w: 60, h: 32 },
    ],
  };

  test("FR-NOTE-78 BL-108 sim-14 r02 (1440×900, the damage-card popup at 377, 67): '1 pending action' leaves its heading and damage field: below it + 12, at 560, 337", () => {
    // The repro: the popup wasn't an input; the summary sat home, on its heading row.
    const before = dmStackSpot(vp, init, SUMMARY_H, STACK_W, [], [log, scenes]);
    expect(hits(stack(before, SUMMARY_H), popup)).toBe(true);
    const at = dmStackSpot(
      vp,
      init,
      SUMMARY_H,
      STACK_W,
      [],
      [log, scenes],
      [],
      [],
      [],
      [],
      [popup],
    );
    expect(at).toMatchObject({ left: 560, top: 337, covers: 0 });
    expect(hits(stack(at, SUMMARY_H), { ...popup, h: popup.h + 12 })).toBe(false);
  });

  test("FR-NOTE-78 a popup with room left of it: the shift left of it, like Initiative", () => {
    const wide = { x: 1280, y: 900 };
    const p = { ...popup, x: 700, controls: [] };
    const at = dmStackSpot(
      { w: wide.x, h: wide.y },
      null,
      SUMMARY_H,
      STACK_W,
      [],
      [],
      [],
      [],
      [],
      [],
      [p],
    );
    expect(at).toMatchObject({ left: 700 - 12 - STACK_W, top: 100 });
  });

  test("FR-NOTE-78 no spot clears the popup (1280×720, a popup across the column down to the launcher): the stack covers it (the runtime folds to the summary) over none of its controls", () => {
    const small = { w: 1280, h: 720 };
    const tall = {
      x: 300,
      y: 60,
      w: 440,
      h: 600,
      controls: [
        { x: 313, y: 100, w: 200, h: 32 },
        { x: 521, y: 100, w: 200, h: 32 },
        { x: 313, y: 160, w: 414, h: 32 },
        { x: 540, y: 616, w: 72, h: 32 },
        { x: 620, y: 616, w: 58, h: 32 },
        { x: 686, y: 616, w: 60, h: 32 },
      ],
    };
    const init720 = { x: 868, y: 60, w: 400, h: 583 };
    const at = dmStackSpot(small, init720, SUMMARY_H, STACK_W, [], [], [], [], [], [], [tall]);
    expect(at.covers).toBeGreaterThan(0);
    const r = stack(at, SUMMARY_H);
    for (const c of tall.controls) expect(hits(r, c)).toBe(false);
    expect(hits(r, { ...init720, x: init720.x - 12, w: init720.w + 12 })).toBe(false);
  });
});

// Walkthrough F2 (`.verify/20261024-f2/report.md`) 1b, 2a: with live cards folded, the stack was
// the summary + a "+2 more" pill below it, 92 px; no primary-clear spot held that height, so it
// took the form (the Roll requests composer, Loot's "Add loot"). Folded to the summary alone, the
// pill sits in the summary's row (`moreInSummary`): the stack is the summary's 58 px, and takes 1a
// / 2b's spots. Rects as the walkthrough's screenshots (02, 03) draw them.
describe("FR-NOTE-78 walkthrough F2 1b / 2a: live cards folded into the summary", () => {
  const FOLDED_OLD_H = 92;
  const FOLDED_H = 58;

  test("FR-NOTE-78 walkthrough F2 1b (1280×720, Roll requests at 504, 60, Perception + Insight, 2 live cards): folded to the summary's 58 px → 480, 405 below the Insight card, off the composer (92 px: 480, 175 on it)", () => {
    const small = { w: 1280, h: 720 };
    const init720 = { x: 868, y: 60, w: 400, h: 583 };
    const insight = { x: 517, y: 275, w: 334, h: 122 };
    const perception = { x: 517, y: 403, w: 334, h: 122 };
    const newRequest = { x: 517, y: 111, w: 300, h: 13 };
    const composer = [
      { x: 517, y: 138, w: 145, h: 27 },
      { x: 669, y: 138, w: 182, h: 27 },
      { x: 517, y: 174, w: 54, h: 23 },
      { x: 576, y: 174, w: 55, h: 23 },
      { x: 635, y: 174, w: 42, h: 23 },
      { x: 682, y: 174, w: 51, h: 23 },
      { x: 517, y: 206, w: 56, h: 26 },
      { x: 580, y: 212, w: 14, h: 14 },
      { x: 655, y: 206, w: 115, h: 26 },
      { x: 777, y: 205, w: 24, h: 24 },
      { x: 517, y: 239, w: 56, h: 27 },
    ];
    const requests: StackWindow = {
      x: 504,
      y: 60,
      w: 360,
      h: 410,
      used: 470,
      head: 197,
      controls: [
        { x: 829, y: 110, w: 20, h: 20 },
        ...composer,
        { x: 654, y: 360, w: 124, h: 28 },
        { x: 785, y: 360, w: 57, h: 28 },
      ],
      primary: [newRequest, insight],
      records: [perception],
    };
    const log: StackWindow = {
      x: 68,
      y: 484,
      w: 690,
      h: 160,
      used: 636,
      head: 533,
      controls: [
        { x: 81, y: 608, w: 320, h: 28 },
        { x: 408, y: 608, w: 128, h: 28 },
        { x: 542, y: 608, w: 28, h: 28 },
        { x: 576, y: 608, w: 48, h: 28 },
        { x: 630, y: 608, w: 28, h: 28 },
        { x: 664, y: 608, w: 28, h: 28 },
      ],
      logRows: [
        { x: 81, y: 535, w: 660, h: 21 },
        { x: 81, y: 556, w: 660, h: 21 },
        { x: 81, y: 577, w: 660, h: 21 },
      ],
    };
    // The repro: summary + "+2 more" below it (92 px) → on the composer.
    const before = dmStackSpot(small, init720, FOLDED_OLD_H, STACK_W, [], [log, requests]);
    expect(before).toMatchObject({ left: 480, top: 175 });
    expect(composer.some((c) => hits(stack(before, FOLDED_OLD_H), c))).toBe(true);
    // The pill in the summary's row: 1a's spot.
    const at = dmStackSpot(small, init720, FOLDED_H, STACK_W, [], [log, requests]);
    expect(at).toMatchObject({ left: 480, top: 405 });
    const r = stack(at, FOLDED_H);
    for (const p of [newRequest, insight, ...composer, ...(log.logRows ?? [])])
      expect(hits(r, p)).toBe(false);
    // BL-119: with the Perception card's heading measured, no spot clears it, the composer and
    // the Game log's title bar: the fewest controls stay first (it keeps 405, off the composer).
    const heading = { x: 526, y: 412, w: 316, h: 20 };
    const withHeading = dmStackSpot(
      small,
      init720,
      FOLDED_H,
      STACK_W,
      [],
      [log, { ...requests, headings: [heading] }],
    );
    expect(withHeading).toMatchObject({ left: 480, top: 405 });
  });

  test("FR-NOTE-78 walkthrough F2 2a (1440×900, Party Manager Loot at 424, 60, 2 live cards): folded to the summary's 58 px → 560, 624 over older Game log entries, off 'Add loot' (92 px: 560, 333 on it)", () => {
    const vp = { w: 1440, h: 900 };
    const init = { x: 1028, y: 60, w: 400, h: 512 };
    const wide = (y: number, h = 15) => ({ x: 449, y, w: 419, h });
    const wallets = [wide(235, 18), wide(259, 18), wide(283, 18)];
    const headings = [{ x: 449, y: 160, w: 51, h: 15 }, wide(214), wide(314), wide(433)];
    const coins = (y: number) => [449, 531, 613, 695, 778].map((x) => ({ x, y, w: 78, h: 31 }));
    const addLoot = [
      { x: 449, y: 334, w: 345, h: 31 },
      { x: 800, y: 334, w: 56, h: 31 },
      ...coins(370),
    ];
    const pm: StackWindow = {
      x: 424,
      y: 60,
      w: 456,
      h: 512,
      used: 572,
      head: 253,
      controls: [
        { x: 437, y: 106, w: 88, h: 30 },
        { x: 525, y: 106, w: 72, h: 30 },
        { x: 597, y: 106, w: 71, h: 30 },
        { x: 668, y: 106, w: 45, h: 30 },
        { x: 713, y: 106, w: 76, h: 30 },
        { x: 789, y: 106, w: 77, h: 30 },
        { x: 804, y: 157, w: 52, h: 22 },
        ...addLoot,
        { x: 449, y: 454, w: 207, h: 31 },
        { x: 663, y: 454, w: 193, h: 31 },
        ...coins(490),
        { x: 449, y: 526, w: 342, h: 31 },
        { x: 796, y: 526, w: 60, h: 31 },
      ],
      primary: [...headings, wallets[0] as Box],
      records: wallets.slice(1),
    };
    const log: StackWindow = {
      x: 68,
      y: 584,
      w: 1150,
      h: 240,
      used: 824,
      head: 650,
      controls: [
        { x: 81, y: 788, w: 320, h: 28 },
        { x: 408, y: 788, w: 128, h: 28 },
        { x: 545, y: 790, w: 22, h: 22 },
        { x: 576, y: 788, w: 48, h: 28 },
        { x: 632, y: 790, w: 24, h: 24 },
        { x: 666, y: 790, w: 24, h: 24 },
      ],
      logRows: [
        { x: 81, y: 715, w: 1130, h: 21 },
        { x: 81, y: 736, w: 1130, h: 21 },
        { x: 81, y: 757, w: 1130, h: 22 },
      ],
    };
    // The repro: 92 px reaches the Game log's newest row at 624, so it took "Add loot".
    const before = dmStackSpot(vp, init, FOLDED_OLD_H, STACK_W, [], [log, pm]);
    expect(before).toMatchObject({ left: 560, top: 333 });
    expect(addLoot.some((c) => hits(stack(before, FOLDED_OLD_H), c))).toBe(true);
    // The pill in the summary's row: 2b's spot (accepted).
    const at = dmStackSpot(vp, init, FOLDED_H, STACK_W, [], [log, pm]);
    expect(at).toMatchObject({ left: 560, top: 624 });
    const r = stack(at, FOLDED_H);
    for (const p of [...wallets, ...headings, ...(pm.controls ?? []), ...(log.logRows ?? [])])
      expect(hits(r, p)).toBe(false);
  });
});
