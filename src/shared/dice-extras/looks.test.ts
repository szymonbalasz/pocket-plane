import { expect, test } from "bun:test";
import { defaultLook, STYLE_LOOK } from "./looks";

test("FR-DICEX-24 default looks by sorted player id: same for any snapshot order; DM Obsidian", () => {
  const dmOrder = ["p-c", "p-a", "p-b"];
  const playerOrder = ["p-b", "p-c", "p-a"];
  for (const id of dmOrder) {
    expect(defaultLook(id, dmOrder)).toEqual(defaultLook(id, playerOrder));
  }
  expect(defaultLook("p-a", dmOrder).style).toBe("crimson");
  expect(defaultLook("p-b", dmOrder).style).toBe("sapphire");
  expect(defaultLook("p-c", dmOrder).style).toBe("emerald");
  expect(defaultLook(null, dmOrder)).toEqual(STYLE_LOOK.obsidian);
  // Eight players wrap around; an unknown id falls back to the first player style.
  const eight = Array.from({ length: 8 }, (_, i) => `p${i}`);
  expect(defaultLook("p7", eight).style).toBe("crimson");
  expect(defaultLook("nobody", dmOrder).style).toBe("crimson");
});
