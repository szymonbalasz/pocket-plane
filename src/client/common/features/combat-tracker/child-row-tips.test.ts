// Walkthrough F3 3a: on a child row's name line, a mark or chip with its own Tooltip keeps the
// pointer's moves (the row's folded-tail Tooltip doesn't start, so the chip's wins).
import { describe, expect, test } from "bun:test";
import type { PointerEvent } from "react";
import { ownTipWins } from "./parts";

const event = (target: { tip: boolean; inside: boolean }) => {
  let stopped = false;
  const tip = {};
  const e = {
    target: { closest: () => (target.tip ? tip : null) },
    currentTarget: { contains: (x: unknown) => target.inside && x === tip },
    stopPropagation: () => {
      stopped = true;
    },
  } as unknown as PointerEvent<HTMLElement>;
  ownTipWins(e);
  return stopped;
};

describe("FR-KIT-29 F3 3a child row tips", () => {
  test("FR-KIT-29 walkthrough F3 3a: a move over a chip with its own Tooltip (data-tip) stops at the chip; elsewhere it reaches the row's Tooltip", () => {
    expect(event({ tip: true, inside: true })).toBe(true);
    expect(event({ tip: false, inside: false })).toBe(false);
    // A `data-tip` outside the container (the row's own trigger) never stops it.
    expect(event({ tip: true, inside: false })).toBe(false);
  });
});
