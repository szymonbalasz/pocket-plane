import { expect, test } from "bun:test";
import { returnFocusToAnchor } from "./controls";

/** Stand-ins: no DOM in `bun test`. */
function anchor(isConnected = true) {
  const a = { isConnected, focused: 0, focus: () => a.focused++ };
  return a;
}
function closeEvent(prevented = false) {
  const e = { defaultPrevented: prevented, preventDefault: () => (e.defaultPrevented = true) };
  return e;
}

test("FR-SHELL-31 anchored popover returns focus to its anchor on close", () => {
  const a = anchor();
  const e = closeEvent();
  returnFocusToAnchor(e as unknown as Event, a as unknown as HTMLElement, false);
  expect(a.focused).toBe(1);
  // Radix's own handler then skips its focus-to-body fallback.
  expect(e.defaultPrevented).toBe(true);
});

test("FR-SHELL-31 focus stays put after an outside interaction, a handled event, or no anchor", () => {
  const outside = anchor();
  returnFocusToAnchor(closeEvent() as unknown as Event, outside as unknown as HTMLElement, true);
  expect(outside.focused).toBe(0);

  const handled = anchor();
  returnFocusToAnchor(
    closeEvent(true) as unknown as Event,
    handled as unknown as HTMLElement,
    false,
  );
  expect(handled.focused).toBe(0);

  const detached = anchor(false);
  returnFocusToAnchor(closeEvent() as unknown as Event, detached as unknown as HTMLElement, false);
  expect(detached.focused).toBe(0);

  const e = closeEvent();
  returnFocusToAnchor(e as unknown as Event, null, false);
  expect(e.defaultPrevented).toBe(false); // a PopoverTrigger popover: Radix's default
});
