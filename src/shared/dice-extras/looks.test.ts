import { expect, test } from "bun:test";
import { defaultLook, lookOf, SetLookInput, STYLE_LOOK, sameLook } from "./looks";

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

test("FR-DICEX-26 SetLookInput: enums, #rrggbb, no owner field", () => {
  const ok = { style: "crimson", body: "#8B1A1A", pips: "#ffffff", material: "metal" };
  expect(SetLookInput.safeParse(ok).success).toBe(true);
  for (const bad of [
    { ...ok, body: "#fff" },
    { ...ok, pips: "white" },
    { ...ok, style: "ruby" },
    { ...ok, material: "wood" },
    { ...ok, ownerPlayerId: "p2" },
  ])
    expect(SetLookInput.safeParse(bad).success).toBe(false);
  for (const s of Object.values(STYLE_LOOK)) expect(SetLookInput.parse(s)).toEqual(s);
});

test("FR-DICEX-20 lookOf: the owner's stored row first, else the derived default", () => {
  const ids = ["p-b", "p-a"];
  const row = (ownerPlayerId: string | null, style: "gold" | "bone") => ({
    id: `l-${ownerPlayerId}`,
    campaignId: "c",
    ownerKey: ownerPlayerId ?? "dm",
    ownerPlayerId,
    ...STYLE_LOOK[style],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const rows = [row(null, "gold"), row("p-b", "bone")];
  expect(lookOf(null, rows, ids)).toEqual(STYLE_LOOK.gold);
  expect(lookOf("p-b", rows, ids)).toEqual(STYLE_LOOK.bone);
  expect(lookOf("p-a", rows, ids)).toEqual(defaultLook("p-a", ids));
  expect(lookOf(null, [], ids)).toEqual(STYLE_LOOK.obsidian);
});

test("FR-DICEX-26 sameLook ignores colour case", () => {
  expect(sameLook(STYLE_LOOK.crimson, { ...STYLE_LOOK.crimson, body: "#9B1C24" })).toBe(true);
  expect(sameLook(STYLE_LOOK.crimson, { ...STYLE_LOOK.crimson, material: "metal" })).toBe(false);
});
