// HOLD §13 unit: zod bounds (FR-HOLD-03–05) and the pure per-viewer redaction (FR-HOLD-08) and
// `stronghold-index` (FR-HOLD-01).
import { describe, expect, test } from "bun:test";
import { byCreated } from "../reminders/schemas";
import {
  CreateStrongholdIntent,
  type Facility,
  indexOf,
  MoveRowIntent,
  redactIndex,
  redactStronghold,
  SaveFacilityIntent,
  SaveStaffIntent,
  type StrongholdRecord,
  strongholdVisibility,
  UpdateStrongholdIntent,
} from "./schemas";

const fac = (facility: unknown) =>
  SaveFacilityIntent.safeParse({ strongholdId: "h1", facility }).success;
const staff = (s: unknown) => SaveStaffIntent.safeParse({ strongholdId: "h1", staff: s }).success;

describe("HOLD §13 unit", () => {
  test("FR-HOLD-04 facility input", () => {
    expect(fac({ name: "Forge Hall", state: "built" })).toBe(true);
    const p = SaveFacilityIntent.parse({
      strongholdId: "h1",
      facility: { name: " Forge\u0007 Hall ", state: "built", incomeDice: "2D6", effect: "a\r\nb" },
    }).facility;
    expect(p).toEqual({
      name: "Forge Hall",
      state: "built",
      cost: null,
      buildDays: null,
      upkeep: null,
      incomeDice: "2d6",
      effect: "a\nb",
      order: "",
      replacesId: null,
      dmOnly: false,
    });
    expect(fac({ name: "", state: "built" })).toBe(false);
    expect(fac({ name: "x".repeat(61), state: "built" })).toBe(false);
    expect(fac({ name: "F", state: "ruined" })).toBe(false);
    expect(fac({ name: "F", state: "built", cost: 1_000_000 })).toBe(false);
    expect(fac({ name: "F", state: "built", cost: 999_999, buildDays: 999, upkeep: 99_999 })).toBe(
      true,
    );
    expect(fac({ name: "F", state: "built", buildDays: 1000 })).toBe(false);
    expect(fac({ name: "F", state: "built", upkeep: -1 })).toBe(false);
    expect(fac({ name: "F", state: "built", upkeep: 1.5 })).toBe(false);
    expect(fac({ name: "F", state: "built", incomeDice: "lots" })).toBe(false);
    expect(fac({ name: "F", state: "built", effect: "x".repeat(601) })).toBe(false);
    expect(fac({ name: "F", state: "built", order: "x".repeat(81) })).toBe(false);
    expect(fac({ name: "F", state: "built", level: 2 })).toBe(false);
  });

  test("FR-HOLD-05 staff input", () => {
    expect(staff({ name: "Brenna", role: "smith", wage: 2, facilityId: "f1" })).toBe(true);
    expect(staff({ name: "" })).toBe(false);
    expect(staff({ name: "B", role: "x".repeat(41) })).toBe(false);
    expect(staff({ name: "B", wage: 100_000 })).toBe(false);
    expect(staff({ name: "B", notes: "x".repeat(201) })).toBe(false);
    expect(staff({ name: "B", creature: "c1" })).toBe(false);
  });

  test("FR-HOLD-03 header input; FR-HOLD-12 patch needs a field; FR-HOLD-15 move index", () => {
    expect(CreateStrongholdIntent.safeParse({ name: "x".repeat(60) }).success).toBe(true);
    expect(CreateStrongholdIntent.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(UpdateStrongholdIntent.safeParse({ strongholdId: "h1" }).success).toBe(false);
    expect(UpdateStrongholdIntent.safeParse({ strongholdId: "h1", defenders: 9_999 }).success).toBe(
      true,
    );
    expect(
      UpdateStrongholdIntent.safeParse({ strongholdId: "h1", defenders: 10_000 }).success,
    ).toBe(false);
    expect(
      UpdateStrongholdIntent.safeParse({ strongholdId: "h1", notes: "x".repeat(4_001) }).success,
    ).toBe(false);
    expect(
      MoveRowIntent.safeParse({ strongholdId: "h1", list: "rooms", id: "f", index: 0 }).success,
    ).toBe(false);
  });

  const f = (id: string, over: Partial<Facility> = {}): Facility => ({
    id,
    name: id,
    state: "built",
    cost: null,
    buildDays: null,
    upkeep: null,
    incomeDice: null,
    effect: "",
    order: "",
    replacesId: null,
    dmOnly: false,
    ...over,
  });
  const hold = (over: Partial<StrongholdRecord> = {}): StrongholdRecord => ({
    id: "h1",
    campaignId: "c1",
    seq: 4,
    name: "Greystone Keep",
    dmOnly: false,
    defenders: 12,
    defendersDmOnly: false,
    notes: "Rebuilt",
    notesDmOnly: false,
    facilities: [
      f("forge"),
      f("vault", { dmOnly: true }),
      f("steam", { replacesId: "vault" }),
      f("old", { state: "replaced" }),
      f("new", { replacesId: "old" }),
    ],
    staff: [
      {
        id: "brenna",
        name: "Brenna",
        role: "",
        wage: 2,
        notes: "",
        facilityId: "forge",
        dmOnly: false,
      },
      {
        id: "guard",
        name: "Guard",
        role: "",
        wage: 1,
        notes: "",
        facilityId: "vault",
        dmOnly: false,
      },
      { id: "spy", name: "Spy", role: "", wage: 5, notes: "", facilityId: null, dmOnly: true },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...over,
  });

  test("FR-HOLD-08 visibility per player", () => {
    expect(strongholdVisibility(hold({ dmOnly: true }), { role: "player" })).toBe("hidden");
    expect(strongholdVisibility(hold({ dmOnly: true }), { role: "dm" })).toBe("full");
    expect(strongholdVisibility(hold(), { role: "player" })).toBe("redacted");
    const r = redactStronghold(hold());
    // Vault and spy removed; Brenna's facility kept; a pointer at the vault nulled.
    expect(r.facilities.map((x) => x.id)).toEqual(["forge", "steam", "old", "new"]);
    expect(r.facilities.find((x) => x.id === "steam")?.replacesId).toBeNull();
    expect(r.facilities.find((x) => x.id === "new")?.replacesId).toBe("old");
    expect(r.staff.map((m) => [m.id, m.facilityId])).toEqual([
      ["brenna", "forge"],
      ["guard", null],
    ]);
    expect([r.defenders, r.notes]).toEqual([12, "Rebuilt"]);
    // No flags, `seq` or `updatedAt` for players.
    const json = JSON.stringify(r);
    for (const k of ["dmOnly", "DmOnly", '"seq"', "updatedAt"]) expect(json).not.toContain(k);
    const hidden = redactStronghold(hold({ defendersDmOnly: true, notesDmOnly: true }));
    expect(hidden).not.toHaveProperty("defenders");
    expect(hidden).not.toHaveProperty("notes");
    // A DM-only edit leaves the player's record identical (FR-HOLD-09).
    const edited = hold({
      updatedAt: "2026-02-01T00:00:00.000Z",
      facilities: hold().facilities.map((x) => (x.id === "vault" ? { ...x, effect: "new" } : x)),
    });
    expect(redactStronghold(edited)).toEqual(redactStronghold(hold()));
  });

  test("FR-HOLD-01 stronghold-index per viewer", () => {
    expect(indexOf(hold())).toEqual({ id: "h1", campaignId: "c1", name: "Greystone Keep" });
    const secret = indexOf(hold({ dmOnly: true }));
    expect(secret.dmOnly).toBe(true);
    expect(strongholdVisibility(secret, { role: "player" })).toBe("hidden");
    expect(strongholdVisibility(indexOf(hold()), { role: "player" })).toBe("redacted");
    expect(redactIndex(indexOf(hold()))).toEqual({
      id: "h1",
      campaignId: "c1",
      name: "Greystone Keep",
    });
  });

  test("FR-HOLD-08 players' order by createdAt", () => {
    const a = redactStronghold(hold({ id: "a", createdAt: "2026-01-01T00:00:00.001Z" }));
    const b = redactStronghold(hold({ id: "b", createdAt: "2026-01-01T00:00:00.000Z" }));
    expect([a, b].sort(byCreated).map((x) => x.id)).toEqual(["b", "a"]);
  });
});
