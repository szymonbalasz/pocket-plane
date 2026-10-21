import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OVERLAY_OPEN_ATTR,
  overlayOpenOn,
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_MS,
  TooltipController,
  TooltipGroup,
} from "./overlays";
import { currentStop, rovingMove, rowStops } from "./roving";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** A tooltip whose trigger's overlay state is a plain flag. */
function tip(group = new TooltipGroup()) {
  const s = { overlay: false, changes: [] as boolean[] };
  const ctl = new TooltipController(
    group,
    () => s.overlay,
    (o) => s.changes.push(o),
  );
  return Object.assign(s, { ctl, group });
}

describe("FR-SHELL-30 delay", () => {
  test("FR-SHELL-30 tooltip opens after 400 ms", () => {
    const t = tip();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(399);
    expect(t.ctl.open).toBe(false);
    jest.advanceTimersByTime(1);
    expect(t.ctl.open).toBe(true);
    expect(t.changes).toEqual([true]);
  });

  test("FR-SHELL-30 one constant: 400 ms open, 300 ms skip, used by both providers", () => {
    expect(TOOLTIP_DELAY_MS).toBe(400);
    expect(TOOLTIP_SKIP_DELAY_MS).toBe(300);
    const g = new TooltipGroup();
    expect([g.delay, g.skipDelay]).toEqual([400, 300]);
    for (const client of ["dm", "player"]) {
      const src = readFileSync(join(import.meta.dir, `../../../${client}/main.tsx`), "utf8");
      expect(src).toContain("delayDuration={TOOLTIP_DELAY_MS}");
      expect(src).toContain("skipDelayDuration={TOOLTIP_SKIP_DELAY_MS}");
    }
  });

  test("FR-SHELL-30 leaving before the delay cancels the open", () => {
    const t = tip();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(300);
    t.ctl.pointerLeave();
    jest.advanceTimersByTime(1000);
    expect(t.ctl.open).toBe(false);
  });

  test("FR-SHELL-30 further pointer moves don't restart the delay", () => {
    const t = tip();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(300);
    t.ctl.pointerMove();
    jest.advanceTimersByTime(100);
    expect(t.ctl.open).toBe(true);
  });

  test("FR-SHELL-30 skip delay: the next trigger within 300 ms opens at once", () => {
    const group = new TooltipGroup();
    const a = tip(group);
    const b = tip(group);
    a.ctl.pointerMove();
    jest.advanceTimersByTime(400);
    a.ctl.pointerLeave();
    jest.advanceTimersByTime(299);
    b.ctl.pointerMove();
    expect(b.ctl.open).toBe(true);
  });

  test("FR-SHELL-30 skip delay: after 300 ms the next trigger waits the full delay", () => {
    const group = new TooltipGroup();
    const a = tip(group);
    const b = tip(group);
    a.ctl.pointerMove();
    jest.advanceTimersByTime(400);
    a.ctl.pointerLeave();
    jest.advanceTimersByTime(300);
    b.ctl.pointerMove();
    expect(b.ctl.open).toBe(false);
    jest.advanceTimersByTime(400);
    expect(b.ctl.open).toBe(true);
  });

  test("FR-SHELL-30 one tooltip open at a time", () => {
    const group = new TooltipGroup();
    const a = tip(group);
    const b = tip(group);
    a.ctl.focus(true);
    jest.advanceTimersByTime(400);
    b.ctl.pointerMove();
    expect(b.ctl.open).toBe(true);
    expect(a.ctl.open).toBe(false);
  });

  test("FR-SHELL-30 keyboard focus opens after the delay; pointer focus doesn't", () => {
    const k = tip();
    k.ctl.focus(true);
    jest.advanceTimersByTime(399);
    expect(k.ctl.open).toBe(false);
    jest.advanceTimersByTime(1);
    expect(k.ctl.open).toBe(true);
    const p = tip();
    p.ctl.focus(false);
    jest.advanceTimersByTime(1000);
    expect(p.ctl.open).toBe(false);
  });
});

describe("FR-SHELL-31 suppression", () => {
  test("FR-SHELL-31 press closes the tooltip; stays closed until the pointer leaves", () => {
    const t = tip();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(400);
    t.ctl.press();
    expect(t.ctl.open).toBe(false);
    t.ctl.pointerMove();
    t.ctl.focus(true);
    jest.advanceTimersByTime(2000);
    expect(t.ctl.open).toBe(false);
    t.ctl.pointerLeave();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(400);
    expect(t.ctl.open).toBe(true);
  });

  test("FR-SHELL-31 press cancels a pending open", () => {
    const t = tip();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(200);
    t.ctl.press();
    jest.advanceTimersByTime(2000);
    expect(t.ctl.open).toBe(false);
    expect(t.changes).toEqual([]);
  });

  test("FR-SHELL-31 no tooltip while the trigger's popover is open", () => {
    const t = tip();
    t.overlay = true;
    t.ctl.pointerMove();
    t.ctl.focus(true);
    jest.advanceTimersByTime(2000);
    expect(t.ctl.open).toBe(false);
  });

  test("FR-SHELL-31 popover opening while hovering closes the tooltip and cancels a pending one", () => {
    const t = tip();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(400);
    t.overlay = true;
    t.ctl.overlayChanged();
    expect(t.ctl.open).toBe(false);
    const u = tip();
    u.ctl.pointerMove();
    jest.advanceTimersByTime(200);
    u.overlay = true;
    jest.advanceTimersByTime(1000);
    expect(u.ctl.open).toBe(false);
  });

  test("FR-SHELL-31 Escape returns focus to the trigger → no tooltip until leave and return", () => {
    const t = tip();
    t.ctl.pointerMove();
    t.ctl.press(); // click opens the popover
    t.overlay = true;
    t.ctl.overlayChanged();
    t.ctl.blur(); // focus moves into the popover
    t.overlay = false; // Escape
    t.ctl.overlayChanged();
    t.ctl.focus(true); // focus returned to the trigger
    jest.advanceTimersByTime(2000);
    expect(t.ctl.open).toBe(false);
    t.ctl.pointerLeave();
    t.ctl.pointerMove();
    jest.advanceTimersByTime(400);
    expect(t.ctl.open).toBe(true);
  });

  test("FR-SHELL-31 keyboard-opened popover: focus return stays shut, tabbing away clears it", () => {
    const t = tip();
    t.ctl.focus(true);
    t.ctl.press(); // Enter
    t.overlay = true;
    t.ctl.overlayChanged();
    t.ctl.blur();
    t.overlay = false;
    t.ctl.overlayChanged();
    t.ctl.focus(true);
    jest.advanceTimersByTime(2000);
    expect(t.ctl.open).toBe(false);
    t.ctl.blur(); // Tab away
    t.ctl.focus(true); // and back
    jest.advanceTimersByTime(400);
    expect(t.ctl.open).toBe(true);
  });

  test("FR-SHELL-31 overlay state read from aria-expanded or the anchor marker", () => {
    const el = (attrs: Record<string, string>) =>
      ({ getAttribute: (n: string) => attrs[n] ?? null }) as unknown as Element;
    expect(overlayOpenOn(null)).toBe(false);
    expect(overlayOpenOn(el({}))).toBe(false);
    expect(overlayOpenOn(el({ "aria-expanded": "false" }))).toBe(false);
    expect(overlayOpenOn(el({ "aria-expanded": "true" }))).toBe(true);
    expect(overlayOpenOn(el({ [OVERLAY_OPEN_ATTR]: "true" }))).toBe(true);
  });
});

describe("FR-SHELL-84 tooltips on keyboard focus", () => {
  test("FR-SHELL-84 tooltips on focus: Tab onto a trigger → open after 400 ms; blur or Escape → gone; a click focus → none; the next Tab focus opens again", () => {
    const t = tip();
    t.ctl.focus(true); // Tab
    jest.advanceTimersByTime(400);
    expect(t.ctl.open).toBe(true);
    t.ctl.blur();
    expect(t.ctl.open).toBe(false);
    t.ctl.focus(true);
    jest.advanceTimersByTime(400);
    expect(t.ctl.open).toBe(true);
    t.ctl.dismiss(); // Escape (Radix's dismissable layer → onOpenChange(false))
    expect(t.ctl.open).toBe(false);
    t.ctl.blur();
    // A click: pointer down latches, the pointer focus doesn't open.
    t.ctl.pointerMove();
    t.ctl.press();
    t.ctl.focus(false);
    jest.advanceTimersByTime(2000);
    expect(t.ctl.open).toBe(false);
    // Tabbing away and back (the latch clears on blur): opens again.
    t.ctl.blur();
    t.ctl.pointerLeave();
    t.ctl.focus(true);
    jest.advanceTimersByTime(400);
    expect(t.ctl.open).toBe(true);
  });

  test("FR-SHELL-84 roving tabIndex: one tab stop per chip row; ←/→ (Home / End) move between its chips and stop at the ends; the last focused chip keeps the stop", () => {
    expect(rovingMove("ArrowRight", 0, 3)).toBe(1);
    expect(rovingMove("ArrowRight", 2, 3)).toBe(2);
    expect(rovingMove("ArrowLeft", 0, 3)).toBe(0);
    expect(rovingMove("ArrowLeft", 2, 3)).toBe(1);
    expect(rovingMove("Home", 2, 3)).toBe(0);
    expect(rovingMove("End", 0, 3)).toBe(2);
    expect(rovingMove("Tab", 0, 3)).toBeNull();
    expect(rovingMove("ArrowRight", 0, 0)).toBeNull();
    // A chip inside its menu button (the DM's chips) is reached through the button, once.
    const host = new Map([
      ["chip-a", "menu-a"],
      ["chip-b", "chip-b"],
      ["more", "more"],
    ]);
    const stops = rowStops(["chip-a", "chip-b", "more"], (t) => host.get(t) ?? t);
    expect(stops).toEqual(["menu-a", "chip-b", "more"]);
    expect(rowStops(["x", "x2"], () => "btn")).toEqual(["btn"]);
    expect(currentStop(stops, undefined)).toBe(0);
    expect(currentStop(stops, "more")).toBe(2);
    expect(currentStop(stops, "gone")).toBe(0);
  });

  test("FR-SHELL-84 every shared Tooltip trigger is enrolled (marked, made reachable) in overlays.tsx", () => {
    const src = readFileSync(join(import.meta.dir, "overlays.tsx"), "utf8");
    expect(src).toContain("[TIP_ATTR]");
    expect(src).toContain("enrollTrigger(trigger)");
  });
});
