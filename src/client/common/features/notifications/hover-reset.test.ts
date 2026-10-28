// FR-NOTE-14 (sprint 14 F2, K6b / K6c side finding): no `mouseleave` fires when the hovered toast
// unmounts or the whole stack does, so the stack stayed "hovered" and its timers paused (a 4 s
// turn card showed > 60 s). The hover holds only while the stack shows and the last pointer point
// is still on its rect (`hoverHolds`); otherwise it drops (`dropStaleHover`) and timers run.
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  addNote,
  advance,
  closeToast,
  dropStaleHover,
  hoverHolds,
  initialToasts,
  setHovered,
  setTurnCard,
  TURN_CARD_MS,
} from "./toasts";

const card: NotificationRecord = {
  id: "n1",
  campaignId: "c1",
  seq: 1,
  kind: "test",
  audience: "dm",
  audiencePlayerId: null,
  text: "Approve?",
  payload: {},
  actionLabel: "Apply",
  actionRole: "dm",
  actionPlayerId: null,
  state: "pending",
  resolution: null,
  closedAt: null,
  closedByRole: null,
  closedByPlayerId: null,
  byRole: null,
  byPlayerId: null,
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:00:00.000Z",
};

/** The DM stack at 480,60, 320 wide; one card (58 px) then nothing. */
const rect = (h: number) => ({ left: 480, top: 60, right: 800, bottom: 60 + h });

describe("FR-NOTE-14 hover reset (sprint 14 F2)", () => {
  test("FR-NOTE-14 the stack empties under the pointer: hover drops, the next turn card hides after 4 s", () => {
    let s = addNote(initialToasts(0), card, 0);
    s = setHovered(s, true, 100);
    // The DM closes the hovered card: the stack unmounts, no mouseleave.
    s = closeToast(s, "n1", 200);
    expect(s.hovered).toBe(true);
    expect(hoverHolds(false, null, { x: 600, y: 80 })).toBe(false);
    s = dropStaleHover(s, false, 200);
    expect(s.hovered).toBe(false);
    s = setTurnCard(s, "Mira's turn", 1000);
    s = advance(s, 1000 + TURN_CARD_MS + 1);
    expect(s.turn ?? null).toBeNull();
  });

  test("FR-NOTE-14 without the reset the turn card stayed (the K6b repro: > 60 s)", () => {
    let s = setHovered(addNote(initialToasts(0), card, 0), true, 100);
    s = closeToast(s, "n1", 200);
    s = setTurnCard(s, "Mira's turn", 1000);
    s = advance(s, 61_000);
    expect(s.turn?.remaining).toBe(TURN_CARD_MS);
  });

  test("FR-NOTE-14 the hovered toast unmounts and the stack shrinks off the pointer: hover drops", () => {
    // Pointer on the second toast (y 150); the stack shrinks to one 58-px card (bottom 118).
    expect(hoverHolds(true, rect(126), { x: 600, y: 150 })).toBe(true);
    expect(hoverHolds(true, rect(58), { x: 600, y: 150 })).toBe(false);
    const s = setHovered(initialToasts(0), true, 0);
    expect(dropStaleHover(s, false, 10).hovered).toBe(false);
    expect(dropStaleHover(s, false, 10).runningSince).toBe(10);
  });

  test("FR-NOTE-14 the pointer still on the stack: hover holds, timers stay paused", () => {
    expect(hoverHolds(true, rect(58), { x: 600, y: 80 })).toBe(true);
    const s = setHovered(initialToasts(0), true, 0);
    expect(dropStaleHover(s, true, 10)).toBe(s);
    // No pointer point known (hovered before any move): nothing to hold it.
    expect(hoverHolds(true, rect(58), null)).toBe(false);
  });
});
