// Sprint 14 F2 (BL-130), K3 walkthrough step 2 (`.verify/sprint12/walkthroughs/20261027-k3-notices/`
// 27): DM 1280×720, Initiative and the Game log at their defaults, Compendium open on a homebrew
// record at 484, 60; three "Saved …" alerts within ~2 s → the summary + 3 alerts (320 × 220) sat
// at 480, 140 on the record's heading and its 7 buttons: alerts never folded. The runtime's fold
// frame by frame, the height measured a frame after each step (as `settle.test.ts`).
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import { dmStackSpot, STACK_W, type StackWindow } from "./keep-out";
import {
  canFold,
  foldCap,
  initialToasts,
  MAX_VISIBLE,
  type StackSettle,
  setSummary,
  settleStack,
  syncAlerts,
  UNSETTLED,
  visibleToasts,
} from "./toasts";

const vp = { w: 1280, h: 720 };
const init = { x: 868, y: 60, w: 400, h: 583 };
const log: StackWindow = { x: 68, y: 508, w: 690, h: 200, used: 708, head: 564 };
// The record page: its heading "Lamp 7" and Back, Clone, Edit, Delete, Add to party / sheet.
const heading = { x: 505, y: 255, w: 120, h: 22 };
const buttons = [
  { x: 505, y: 196, w: 60, h: 26 },
  { x: 571, y: 196, w: 60, h: 26 },
  { x: 637, y: 196, w: 60, h: 26 },
  { x: 703, y: 196, w: 60, h: 26 },
  { x: 735, y: 196, w: 96, h: 26 },
  { x: 735, y: 228, w: 96, h: 26 },
  { x: 700, y: 110, w: 130, h: 30 },
];
const compendium: StackWindow = {
  x: 484,
  y: 60,
  w: 370,
  h: 435,
  used: 340,
  head: 150,
  primary: [heading],
  controls: buttons,
};
// Thorn and Mira left of Compendium (footprints + 4 px).
const pcs = [
  { x: 366, y: 286, w: 52, h: 62 },
  { x: 413, y: 286, w: 52, h: 62 },
];
const SUMMARY_H = 58;
const ALERT_H = 46;
/** The "+N more" pill under the alerts (20 px + its 8-px gap); in the summary's row when alone. */
const PILL_H = 28;
/** The stack's height: the summary, the alerts shown, 8-px gaps, the pill below them. */
const heightOf = (alerts: number, more = 0) =>
  SUMMARY_H + alerts * (ALERT_H + 8) + (more > 0 && alerts > 0 ? PILL_H : 0);

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const spotFor = (h: number) =>
  dmStackSpot(vp, init, h, STACK_W, [], [log, compendium], [], [], [], pcs);

/** The summary ("4 pending actions") and three "Saved …" alerts, oldest first. */
function stackState() {
  let s = setSummary(initialToasts(0), 4, 0);
  s = syncAlerts(
    s,
    [5, 6, 7].map((n) => ({ id: `saved-${n}` })),
    0,
  );
  return s;
}

describe("BL-130 K3 alerts fold into the summary when they'd cover a window's controls", () => {
  test("FR-NOTE-77 BL-130 K3 repro: summary + 3 alerts (220 px) has no spot clear of Compendium; the summary alone (58) has one left of it at 152, 100", () => {
    expect(heightOf(3)).toBe(220);
    const tall = spotFor(heightOf(3));
    expect(tall.covers).toBeGreaterThan(0);
    const short = spotFor(SUMMARY_H);
    expect(short).toMatchObject({ left: compendium.x - 12 - STACK_W, top: 100, covers: 0 });
    const r = { x: short.left, y: short.top, w: STACK_W, h: SUMMARY_H };
    for (const b of [compendium, log, init, ...pcs]) expect(hit(r, b)).toBe(false);
  });

  test("FR-NOTE-50 BL-130 visibleToasts: `alerts` keeps the newest alerts; the held-back ones join '+N more' (in the summary's row when it shows alone)", () => {
    const s = stackState();
    expect(visibleToasts(s, 0).shown.map((t) => t.kind)).toEqual([
      "summary",
      "alert",
      "alert",
      "alert",
    ]);
    const one = visibleToasts(s, 0, false, 1);
    expect(one.shown.map((t) => t.key)).toEqual(["summary", "toast:string:saved-7"]);
    expect(one.more).toBe(2);
    const none = visibleToasts(s, 0, false, 0);
    expect(none.shown.map((t) => t.kind)).toEqual(["summary"]);
    expect(none).toMatchObject({ more: 3, inSummary: 0 });
  });

  test("FR-NOTE-77 BL-130 foldCap: cards / info fold first, then one alert a measured step, down to alertMin; without alerts as before", () => {
    const o = { need: true, min: 0, stackH: 220, shown: 0, alerts: 3, alertMin: 0 };
    // No card to fold: the cap goes to its floor and the oldest alert folds in the same step.
    let f = foldCap({ cap: MAX_VISIBLE, foldedAt: null }, o);
    expect(f).toEqual({ cap: 0, alerts: 2, foldedAt: 220 });
    // The next step waits for the new height.
    expect(foldCap(f, { ...o, alerts: 2 })).toBe(f);
    f = foldCap(f, { ...o, stackH: 166, alerts: 2 });
    f = foldCap(f, { ...o, stackH: 112, alerts: 1 });
    expect(f).toEqual({ cap: 0, alerts: 0, foldedAt: 112 });
    expect(canFold(f, { ...o, alerts: 0 })).toBe(false);
    // With a card above the floor, it folds before any alert; at the floor, the alerts go.
    const c2 = foldCap({ cap: 2, foldedAt: null }, { ...o, shown: 2, min: 1 });
    expect(c2).toEqual({ cap: 1, foldedAt: 220 });
    const atFloor = foldCap({ cap: MAX_VISIBLE, foldedAt: null }, { ...o, shown: 1, min: 1 });
    expect(atFloor).toEqual({ cap: 1, alerts: 2, foldedAt: 220 });
    // Alerts only, nothing else: one stays.
    const solo = { need: true, min: 1, stackH: 154, shown: 0, alerts: 3, alertMin: 1 };
    let g = foldCap({ cap: MAX_VISIBLE, foldedAt: null }, solo);
    g = foldCap(g, { ...solo, stackH: 100, alerts: 2 });
    expect(g.alerts).toBe(1);
    expect(foldCap(g, { ...solo, stackH: 46, alerts: 1 })).toBe(g);
    // No `alerts` input: unchanged sprint-12 behaviour (alerts never fold).
    expect(foldCap({ cap: 0, foldedAt: 5 }, { need: true, min: 0, stackH: 9, shown: 0 })).toEqual({
      cap: 0,
      foldedAt: 5,
    });
  });

  test("FR-NOTE-77 BL-130 K3 frame by frame: the oldest alerts fold into '+2 more' until a spot holds the stack: left of Compendium at 152, 100, off the record's heading and buttons and above the PCs", () => {
    const toasts = stackState();
    let s: StackSettle = UNSETTLED;
    let measured = heightOf(3);
    let last = { left: 0, top: 0 };
    for (let frame = 0; frame < 12; frame++) {
      const spot = spotFor(measured);
      for (let render = 0; render < 3; render++) {
        const v = visibleToasts(toasts, s.fold.cap, false, s.fold.alerts);
        const alerts = v.shown.filter((t) => t.kind === "alert").length;
        s = settleStack(s, {
          need: spot.covers > 0,
          min: 0,
          stackH: measured,
          shown: 0,
          alerts,
          alertMin: 0,
          spot,
          now: frame * 16,
        });
      }
      last = s.drawn ?? last;
      const v = visibleToasts(toasts, s.fold.cap, false, s.fold.alerts);
      measured = heightOf(v.shown.filter((t) => t.kind === "alert").length, v.more);
    }
    const v = visibleToasts(toasts, s.fold.cap, false, s.fold.alerts);
    // Summary + 2 alerts + "+1 more" (194 px) reaches Thorn and Mira (286); summary + the newest
    // alert + "+2 more" (140) clears 100..240: two folds, the newest "Saved Lamp 7" stays.
    expect(v.shown.map((t) => t.key)).toEqual(["summary", "toast:string:saved-7"]);
    expect(v.more).toBe(2);
    expect(measured).toBe(140);
    expect(last).toEqual({ left: 152, top: 100 });
    expect(s.hold).toBe(false);
    const r = { x: last.left, y: last.top, w: STACK_W, h: measured };
    for (const b of [heading, ...buttons, ...pcs]) expect(hit(r, b)).toBe(false);
  });

  test("FR-NOTE-77 BL-130 one alert that fits stays: the K3 single-alert case (summary + 1 alert, 112 px) keeps its alert", () => {
    const one = syncAlerts(setSummary(initialToasts(0), 4, 0), [{ id: "saved-1" }], 0);
    const h = heightOf(1);
    const spot = dmStackSpot(vp, init, h, STACK_W, [], [log], [], [], [], pcs);
    expect(spot.covers).toBe(0);
    const s = settleStack(UNSETTLED, {
      need: false,
      min: 0,
      stackH: h,
      shown: 0,
      alerts: 1,
      alertMin: 0,
      spot,
      now: 0,
    });
    expect(visibleToasts(one, s.fold.cap, false, s.fold.alerts).shown).toHaveLength(2);
  });
});
