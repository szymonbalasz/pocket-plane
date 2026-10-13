// LOOT §13 unit: zod rules, formatCoins, gpValue, notification text + the notify decision.
import { describe, expect, test } from "bun:test";
import { formatCoins, formatGpValue, gpValue, lootNotificationText, notifiesLoot } from "./format";
import {
  type Coins,
  LootAddIntent,
  LootEditIntent,
  LootMoveIntent,
  PartyPotRecord,
  WalletRecord,
} from "./schemas";

const c = (x: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...x });
const party = { kind: "party" } as const;
const world = { kind: "world" } as const;
const mira = { kind: "character", characterId: "m" } as const;
const thorn = { kind: "character", characterId: "t" } as const;

describe("FR-LOOT-02 loot input", () => {
  test("FR-LOOT-02 text cleaned and bounded; text or a non-zero coin", () => {
    expect(LootAddIntent.parse({ text: " a\u0000b\t " })).toEqual({ text: "ab", ...c({}) });
    expect(LootAddIntent.safeParse({ text: "x".repeat(200) }).success).toBe(true);
    expect(LootAddIntent.safeParse({ text: "x".repeat(201) }).success).toBe(false);
    expect(LootAddIntent.safeParse({}).success).toBe(false);
    expect(LootAddIntent.safeParse({ text: " \n " }).success).toBe(false);
    expect(LootAddIntent.parse({ gp: -2 })).toEqual({ text: "", ...c({ gp: -2 }) });
  });

  test("FR-LOOT-02 coins are integers ±999 999; fields strict", () => {
    expect(LootAddIntent.safeParse({ pp: 999_999, cp: -999_999 }).success).toBe(true);
    expect(LootAddIntent.safeParse({ pp: 1_000_000 }).success).toBe(false);
    expect(LootAddIntent.safeParse({ cp: -1_000_000 }).success).toBe(false);
    expect(LootAddIntent.safeParse({ gp: 1.5 }).success).toBe(false);
    expect(LootAddIntent.safeParse({ gp: "5" }).success).toBe(false);
    expect(LootAddIntent.safeParse({ gp: 5, gems: 1 }).success).toBe(false);
  });

  test("FR-LOOT-04 edit needs every field", () => {
    const full = { entryId: "e", text: "Idol", ...c({ gp: 50 }) };
    expect(LootEditIntent.safeParse(full).success).toBe(true);
    const { cp: _cp, ...missing } = full;
    expect(LootEditIntent.safeParse(missing).success).toBe(false);
    expect(LootEditIntent.safeParse({ ...full, text: "", gp: 0 }).success).toBe(false);
  });
});

describe("FR-LOOT-06 move input", () => {
  test("FR-LOOT-06 coins ≥ 0, integer, at least one > 0", () => {
    expect(LootMoveIntent.safeParse({ from: party, to: mira, gp: 1 }).success).toBe(true);
    expect(LootMoveIntent.safeParse({ from: party, to: mira }).success).toBe(false);
    expect(LootMoveIntent.safeParse({ from: party, to: mira, gp: -1 }).success).toBe(false);
    expect(LootMoveIntent.safeParse({ from: party, to: mira, gp: 0.5 }).success).toBe(false);
    expect(LootMoveIntent.safeParse({ from: party, to: mira, pp: 999_999 }).success).toBe(true);
    expect(LootMoveIntent.safeParse({ from: party, to: mira, pp: 1_000_000 }).success).toBe(false);
  });

  test("FR-LOOT-06 endpoint pairing and shape", () => {
    const ok = (from: unknown, to: unknown) =>
      LootMoveIntent.safeParse({ from, to, gp: 1 }).success;
    expect(ok(mira, thorn)).toBe(true);
    expect(ok(mira, party)).toBe(true);
    expect(ok(world, mira)).toBe(true);
    expect(ok(mira, world)).toBe(true);
    expect(ok(mira, mira)).toBe(false);
    expect(ok(party, party)).toBe(false);
    expect(ok(party, world)).toBe(false);
    expect(ok(world, party)).toBe(false);
    expect(ok(world, world)).toBe(false);
    expect(ok({ kind: "character" }, party)).toBe(false);
    expect(ok({ kind: "party", characterId: "m" }, mira)).toBe(false);
    expect(ok({ kind: "guild" }, mira)).toBe(false);
  });

  test("FR-LOOT-06 move text 0–100, cleaned", () => {
    const base = { from: party, to: mira, gp: 1 };
    expect(LootMoveIntent.parse({ ...base, text: " Rope\u0007 " }).text).toBe("Rope");
    expect(LootMoveIntent.safeParse({ ...base, text: "x".repeat(100) }).success).toBe(true);
    expect(LootMoveIntent.safeParse({ ...base, text: "x".repeat(101) }).success).toBe(false);
  });

  test("FR-LOOT-09 pot / wallet coins are unbounded signed safe integers", () => {
    const pot = { id: "c", campaignId: "c", ...c({ gp: 2_000_000, sp: -5 }) };
    expect(PartyPotRecord.safeParse(pot).success).toBe(true);
    expect(WalletRecord.safeParse({ ...pot, characterId: "m" }).success).toBe(true);
    expect(PartyPotRecord.safeParse({ ...pot, gp: 1.5 }).success).toBe(false);
  });
});

describe("FR-LOOT-12 formatting", () => {
  test("FR-LOOT-12 formatCoins: order pp → cp, zeros skipped, negatives with −", () => {
    expect(formatCoins(c({ gp: 50, sp: 30 }))).toBe("50 gp, 30 sp");
    expect(formatCoins(c({ cp: 1, sp: 2, ep: 3, gp: 4, pp: 5 }))).toBe(
      "5 pp, 4 gp, 3 ep, 2 sp, 1 cp",
    );
    expect(formatCoins(c({ gp: -2 }))).toBe("−2 gp");
    expect(formatCoins(c({}))).toBe("");
  });

  test("FR-LOOT-12 gpValue", () => {
    expect(gpValue(c({ pp: 1, gp: 2, ep: 1, sp: 3, cp: 4 }))).toBe(12.84);
    expect(gpValue(c({ gp: -15 }))).toBe(-15);
    expect(formatGpValue(c({ pp: 5, gp: 30 }))).toBe("80.00");
    expect(formatGpValue(c({ sp: 1, cp: 1 }))).toBe("0.11");
    expect(formatGpValue(c({ gp: -15 }))).toBe("−15.00");
  });
});

describe("FR-LOOT-13 notification", () => {
  test("FR-LOOT-13 text variants and the 280 cut", () => {
    expect(lootNotificationText("Silver dagger", c({ gp: 50 }))).toBe(
      "Party loot: Silver dagger (50 gp)",
    );
    expect(lootNotificationText("Potion", c({}))).toBe("Party loot: Potion");
    expect(lootNotificationText("", c({ pp: 5 }))).toBe("Party loot: 5 pp");
    const long = lootNotificationText("x".repeat(200), c({ cp: 1, sp: 1, ep: 1, gp: 1, pp: 1 }));
    expect(long.length).toBeLessThanOrEqual(280);
    const cut = lootNotificationText("y".repeat(300), c({}));
    expect(cut).toHaveLength(280);
    expect(cut.endsWith("…")).toBe(true);
  });

  test("FR-LOOT-03 notify decision: none when any coin < 0", () => {
    expect(notifiesLoot(c({ gp: 50 }))).toBe(true);
    expect(notifiesLoot(c({}))).toBe(true);
    expect(notifiesLoot(c({ gp: -2 }))).toBe(false);
    expect(notifiesLoot(c({ gp: 5, sp: -50 }))).toBe(false);
  });
});
