import { describe, expect, test } from "bun:test";
import { fogHidden } from "./visibility";

describe("FR-FOG-11 fog-hidden", () => {
  test("FR-FOG-11 matrix: owned / ownerless token; prop; DM vs player template", () => {
    expect(fogHidden("token", { fogged: true, ownerPlayerId: null })).toBe(true);
    expect(fogHidden("token", { fogged: true, ownerPlayerId: "p1" })).toBe(false);
    expect(fogHidden("token", { ownerPlayerId: null })).toBe(false);
    expect(fogHidden("token", { fogged: false, ownerPlayerId: null })).toBe(false);
    expect(fogHidden("scene-prop", { fogged: true })).toBe(true);
    expect(fogHidden("scene-prop", { fogged: false })).toBe(false);
    expect(fogHidden("aoe-template", { fogged: true, placedByPlayerId: null })).toBe(true);
    expect(fogHidden("aoe-template", { fogged: true, placedByPlayerId: "p2" })).toBe(false);
  });

  test("FR-FOG-11 independent of the hidden flag (reads only fogged + exemption)", () => {
    const t = { fogged: true as const, ownerPlayerId: null, hidden: false };
    expect(fogHidden("token", t)).toBe(true);
    const hiddenClear = { ...t, hidden: true, fogged: undefined };
    expect(fogHidden("token", hiddenClear)).toBe(false);
  });
});
