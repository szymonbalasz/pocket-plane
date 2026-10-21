// FR-DICE-68 (GM1 walkthrough f2): the entry action's confirm lifetime with fake timers. The 4 s
// "Spend?" never closes an open physical-dice form; a close that sent nothing resets the roll
// control (`onClose`), so the next ✓ opens a fresh form.
import { describe, expect, test } from "bun:test";
import { ACTION_CONFIRM_MS, type ConfirmTimers, createActionConfirm } from "./entry-action-confirm";

function fakeTimers() {
  const pending: { fn: () => void; at: number }[] = [];
  let now = 0;
  const timers: ConfirmTimers = {
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
  return { timers, advance, pending };
}

/** A roll control stand-in: the form is open while `manual` is set. */
function setup() {
  const f = fakeTimers();
  const control = { manual: null as { mode: string } | null };
  const c = createActionConfirm(() => {
    control.manual = null; // `cancelManual`
  }, f.timers);
  const openForm = () => {
    control.manual = { mode: "normal" };
    c.form(true);
  };
  return { ...f, control, c, openForm, asking: () => c.api.getState().asking };
}

describe("FR-DICE-68 entry action confirm", () => {
  test("FR-DICE-68 confirm: closes itself after 4 s with no form; ✗ closes at once", () => {
    const t = setup();
    t.c.ask();
    t.advance(ACTION_CONFIRM_MS - 1);
    expect(t.asking()).toBe(true);
    t.advance(1);
    expect(t.asking()).toBe(false);
    t.c.ask();
    t.c.cancel();
    expect([t.asking(), t.pending.length]).toEqual([false, 0]);
  });

  test("FR-GEM-21 physical form (walkthrough f2): an open form stops the 4 s timer; closing it unsent restarts it; the timer's close resets the control", () => {
    const t = setup();
    t.c.ask();
    t.openForm();
    t.advance(60_000);
    expect([t.asking(), t.c.api.getState().form, t.control.manual]).toEqual([
      true,
      true,
      { mode: "normal" },
    ]);
    // Cancel in the form: the confirm stays, its 4 s start again.
    t.control.manual = null;
    t.c.form(false);
    t.advance(ACTION_CONFIRM_MS - 1);
    expect(t.asking()).toBe(true);
    // Second try on the same line: the form opens again, typed dice go out.
    t.openForm();
    t.advance(10_000);
    expect(t.asking()).toBe(true);
    t.c.done();
    expect([t.asking(), t.pending.length]).toEqual([false, 0]);
  });

  test("FR-GEM-21 physical form (walkthrough f2): a confirm closed with the form open (✗) resets the control, so the next ✓ opens a fresh form", () => {
    const t = setup();
    t.c.ask();
    t.openForm();
    t.c.cancel();
    expect([t.asking(), t.control.manual]).toEqual([false, null]);
    t.c.ask();
    t.openForm();
    expect([t.asking(), t.c.api.getState().form]).toEqual([true, true]);
  });
});
