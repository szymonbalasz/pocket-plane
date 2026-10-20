// BL-33: the weapon-combat leak scan masks record IDs and tokens before matching short leak
// strings, and still fails on a real leaked damage string.
import { describe, expect, test } from "bun:test";
import { formatUuid } from "../../commands/context";
import { leaksIn } from "./testing";

const LINE_LEAKS = ['"rolled"', "2d6", "expression"];
const frame = (data: Record<string, unknown>) =>
  JSON.stringify([{ type: "event", changes: [{ type: "game-log-entry", ...data }] }]);

describe("leaksIn (BL-33)", () => {
  test("an ID that spells 2d6 is not a leak", () => {
    const id = "0b12d6aa-42d6-4f00-92d6-1c2d6e0d2d60";
    const raw = frame({ id, data: { id, text: "13 slashing + 4 fire (half) damage" } });
    expect(raw).toContain("2d6");
    expect(leaksIn(raw, LINE_LEAKS)).toEqual([]);
  });

  test("seeded-format IDs and base64url tokens that spell 2d6 are not leaks", () => {
    const seeded = formatUuid(Uint8Array.from([0x2d, 0x60, ...Array(14).fill(0x2d)]));
    const token = "Ab2d6xYz_-0123456789ab";
    const raw = frame({ id: seeded, data: { assetId: token } });
    expect(raw).toContain("2d6");
    expect(leaksIn(raw, LINE_LEAKS)).toEqual([]);
  });

  test("a real leaked damage string still fails the scan, next to IDs", () => {
    const id = "0b12d6aa-42d6-4f00-92d6-1c2d6e0d2d60";
    const raw = frame({ id, data: { id, text: "+ 4 fire (half) (2d6: 2 + 6) damage" } });
    expect(leaksIn(raw, LINE_LEAKS)).toEqual(["2d6"]);
    expect(leaksIn(frame({ id, damage: "2d6+5 slashing" }), LINE_LEAKS)).toEqual(["2d6"]);
    expect(leaksIn(frame({ id, rolled: [2, 6], expression: "2d6" }), LINE_LEAKS)).toEqual(
      LINE_LEAKS,
    );
  });
});
