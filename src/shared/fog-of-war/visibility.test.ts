import { describe, expect, test } from "bun:test";
import { doorSeenBy, fogHidden, seenByNobody } from "./visibility";

describe("FR-FOG-11 fog-hidden per player (ADR-0042)", () => {
  test("FR-FOG-11 matrix: seenBy membership; owner; player template; prop", () => {
    expect(fogHidden("token", { seenBy: ["p1"], ownerPlayerId: null }, "p1")).toBe(false);
    expect(fogHidden("token", { seenBy: ["p1"], ownerPlayerId: null }, "p2")).toBe(true);
    expect(fogHidden("token", { seenBy: [], ownerPlayerId: "p1" }, "p1")).toBe(false);
    expect(fogHidden("token", { seenBy: [], ownerPlayerId: "p1" }, "p2")).toBe(true);
    expect(fogHidden("scene-prop", { seenBy: ["p2"] }, "p2")).toBe(false);
    expect(fogHidden("scene-prop", { seenBy: ["p2"] }, "p1")).toBe(true);
    expect(fogHidden("aoe-template", { seenBy: [], placedByPlayerId: null }, "p1")).toBe(true);
    expect(fogHidden("aoe-template", { seenBy: [], placedByPlayerId: "p2" }, "p1")).toBe(false);
  });

  test("FR-FOG-40 seenBy null (pre-v2, before the backfill) → hidden for every player", () => {
    expect(fogHidden("token", { seenBy: null, ownerPlayerId: null }, "p1")).toBe(true);
    expect(fogHidden("scene-prop", {}, "p1")).toBe(true);
    // An owned token stays visible to its owner (FR-FOG-34).
    expect(fogHidden("token", { seenBy: null, ownerPlayerId: "p1" }, "p1")).toBe(false);
  });

  test("FR-FOG-11 independent of the hidden flag (reads seenBy + exemptions only)", () => {
    const t = { seenBy: ["p1"], ownerPlayerId: null, hidden: true };
    expect(fogHidden("token", t, "p1")).toBe(false);
  });

  test("FR-SCN-36 doorSeen: member only; null → nobody", () => {
    expect(doorSeenBy({ "4": ["p1"] }, 4, "p1")).toBe(true);
    expect(doorSeenBy({ "4": ["p1"] }, 4, "p2")).toBe(false);
    expect(doorSeenBy({ "4": ["p1"] }, 5, "p1")).toBe(false);
    expect(doorSeenBy(null, 4, "p1")).toBe(false);
  });

  test("FR-FOG-20 DM Fog badge: fogged and not exempt", () => {
    expect(seenByNobody("token", { fogged: true, ownerPlayerId: null })).toBe(true);
    expect(seenByNobody("token", { fogged: true, ownerPlayerId: "p1" })).toBe(false);
    expect(seenByNobody("token", { ownerPlayerId: null })).toBe(false);
    expect(seenByNobody("aoe-template", { fogged: true, placedByPlayerId: "p1" })).toBe(false);
    expect(seenByNobody("scene-prop", { fogged: true })).toBe(true);
  });
});
