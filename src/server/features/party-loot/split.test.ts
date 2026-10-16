// PARTY §13 integration (in-process) for slice 3 on party-loot: `loot.split` (FR-PARTY-26) and
// `loot.edit` on item rows (FR-PARTY-25).
import { describe, expect, test } from "bun:test";
import { ITEM_EDIT_MESSAGE, SPLIT_TEXT } from "@shared/party-board/schemas";
import {
  type Coins,
  LOOT_ENTRY_TYPE,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  type PartyPotRecord,
  WALLET_TYPE,
  type WalletRecord,
} from "@shared/party-loot/schemas";
import { asc } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { lootEntry, notification } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { lootAdd, lootEdit, lootMove, lootSplit } from "./commands";
import { seedLoot } from "./testing";

type T = ReturnType<typeof seedLoot>;

function failure(fn: () => unknown): { code: string; message?: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  return { code: "ok" };
}

const coins = (c: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const coinsOnly = ({ cp, sp, ep, gp, pp }: Coins): Coins => ({ cp, sp, ep, gp, pp });
const rows = (t: T) => t.s.db.select().from(lootEntry).orderBy(asc(lootEntry.seq)).all();
const potOf = (t: T) =>
  (t.snapshot(t.viewer("dm"))[PARTY_POT_TYPE] as PartyPotRecord[])[0] as PartyPotRecord;
const walletOf = (t: T, id: string) => {
  const w = (t.snapshot(t.viewer("dm"))[WALLET_TYPE] as WalletRecord[]).find((x) => x.id === id);
  return w ? coinsOnly(w) : coins({});
};

/** The `party-loot` bundle's pot (5 pp, 30 gp) via the same commands. */
function seedPot(t: T) {
  t.run(lootAdd, { text: "Hoard", pp: 5, gp: 60 }, { actor: t.dm });
  t.run(lootMove, { from: t.party, to: t.mira, gp: 20 }, { actor: t.dm });
  t.run(lootMove, { from: t.party, to: t.thorn, gp: 10 }, { actor: t.dm });
}

const split = (t: T, input: object, actor = t.dm) =>
  t.run(lootSplit, input as never, { actor }) as { entryIds: string[] };

describe("loot.split (FR-PARTY-26)", () => {
  test("FR-PARTY-26 ⌊coin / n⌋ to each character, remainder stays in the pot; one Split move row each, in list order", () => {
    const t = seedLoot();
    seedPot(t);
    expect(coinsOnly(potOf(t))).toEqual(coins({ pp: 5, gp: 30 }));
    const before = rows(t).length;
    t.events.length = 0;
    const r = split(t, { characterIds: [t.thornId, t.miraId], pp: 5, gp: 30 });

    const added = rows(t).slice(before);
    expect(r.entryIds).toEqual(added.map((x) => x.id));
    expect(
      added.map((x) => [x.kind, x.fromKind, x.toKind, x.toCharacterId, x.text, x.pp, x.gp]),
    ).toEqual([
      ["move", "party", "character", t.thornId, SPLIT_TEXT, 2, 15],
      ["move", "party", "character", t.miraId, SPLIT_TEXT, 2, 15],
    ]);
    expect(added.every((x) => x.qty === null && x.editedAt === null)).toBe(true);
    expect(coinsOnly(potOf(t))).toEqual(coins({ pp: 1 }));
    expect(walletOf(t, t.miraId)).toEqual(coins({ pp: 2, gp: 35 }));
    expect(walletOf(t, t.thornId)).toEqual(coins({ pp: 2, gp: 25 }));

    expect(t.events.map((e) => e.event.type)).toEqual(["CoinSplit"]);
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({
      entryIds: r.entryIds,
      characterIds: [t.thornId, t.miraId],
      shares: coins({ pp: 2, gp: 15 }),
    });
    expect(ev?.changes.map((c) => [c.type, c.id, c.before === null])).toEqual([
      [LOOT_ENTRY_TYPE, r.entryIds[0] as string, true],
      [LOOT_ENTRY_TYPE, r.entryIds[1] as string, true],
      [PARTY_POT_TYPE, t.campaignId, false],
      [WALLET_TYPE, t.thornId, false],
      [WALLET_TYPE, t.miraId, false],
    ]);
    expect(ev?.changes[2]).toMatchObject({
      before: coins({ pp: 5, gp: 30 }),
      after: coins({ pp: 1 }),
    });
    expect((ev?.changes[0]?.after as LootEntryRecord | undefined)?.text).toBe(SPLIT_TEXT);
    expect(readEventLog(t.s.db, t.campaignId).at(-1)?.type).toBe("CoinSplit");
  });

  test("FR-PARTY-26 a character's first coin → wallet before null; no notification; no balance check", () => {
    const t = seedLoot();
    const notesBefore = t.s.db.select().from(notification).all().length;
    t.events.length = 0;
    // Empty pot: the split still runs and the pot goes negative (#150).
    split(t, { characterIds: [t.miraId], sp: 7 });
    const ev = t.events[0]?.event;
    expect(ev?.changes.find((c) => c.type === WALLET_TYPE)?.before).toBeNull();
    expect(coinsOnly(potOf(t))).toEqual(coins({ sp: -7 }));
    expect(t.s.db.select().from(notification).all()).toHaveLength(notesBefore);
    expect(t.events.map((e) => e.event.type)).toEqual(["CoinSplit"]);
  });

  test("FR-PARTY-26 validation: Nothing to split / bounds / duplicates → invalid; unknown or other-campaign character → not_found; nothing written", () => {
    const t = seedLoot();
    seedPot(t);
    const before = rows(t);
    const log = readEventLog(t.s.db).length;
    const nothing = failure(() => split(t, { characterIds: [t.miraId, t.thornId], gp: 1 }));
    expect(nothing.code).toBe("invalid");
    for (const bad of [
      { characterIds: [], gp: 10 },
      { characterIds: [t.miraId, t.miraId], gp: 10 },
      { characterIds: [t.miraId], gp: 1_000_000 },
      { characterIds: [t.miraId], gp: -2 },
      { characterIds: [t.miraId], gp: 1.5 },
      { characterIds: [t.miraId], gp: 1, gems: 1 },
      { characterIds: Array.from({ length: 11 }, (_, i) => `c${i}`), gp: 11 },
      { characterIds: [t.miraId] },
    ]) {
      expect(failure(() => split(t, bad)).code).toBe("invalid");
    }
    expect(failure(() => split(t, { characterIds: [t.miraId, t.strangerId], gp: 10 })).code).toBe(
      "not_found",
    );
    expect(failure(() => split(t, { characterIds: ["nope"], gp: 10 })).code).toBe("not_found");
    expect(rows(t)).toEqual(before);
    expect(readEventLog(t.s.db)).toHaveLength(log);
  });

  test("FR-PARTY-26 player loot.split → forbidden, no change", () => {
    const t = seedLoot();
    seedPot(t);
    const before = rows(t);
    t.events.length = 0;
    expect(failure(() => split(t, { characterIds: [t.miraId], gp: 10 }, t.p1Actor)).code).toBe(
      "forbidden",
    );
    expect(rows(t)).toEqual(before);
    expect(t.events).toHaveLength(0);
  });

  test("FR-PARTY-26 crash before commit → no row, no log entry; after commit → all rows", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = seedLoot();
    seedPot(t);
    const before = rows(t);
    const log = readEventLog(t.s.db).length;
    try {
      armCrashHook({ point: "before-commit", target: lootSplit.name }, kill);
      expect(() => split(t, { characterIds: [t.miraId, t.thornId], gp: 30 })).toThrow();
      expect(rows(t)).toEqual(before);
      expect(readEventLog(t.s.db)).toHaveLength(log);
      armCrashHook({ point: "after-commit", target: lootSplit.name }, kill);
      expect(() => split(t, { characterIds: [t.miraId, t.thornId], gp: 30 })).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    expect(rows(t)).toHaveLength(before.length + 2);
    expect(coinsOnly(potOf(t))).toEqual(coins({ pp: 5 }));
  });
});

describe("loot.edit on item rows (FR-PARTY-25)", () => {
  test("FR-PARTY-25 loot.edit on an item row → conflict; nothing changes", () => {
    const t = seedLoot();
    t.run("party.addItem", { name: "Torch", qty: 10, notes: "" }, { actor: t.dm });
    const item = rows(t).find((x) => x.kind === "item");
    expect(item).toMatchObject({ text: "Torch", qty: 10, fromKind: "world", toKind: "party" });
    const before = rows(t);
    t.events.length = 0;
    const r = failure(() =>
      t.run(lootEdit, { entryId: item?.id as string, text: "Torches", ...coins({}) } as never, {
        actor: t.dm,
      }),
    );
    expect(r).toEqual({ code: "conflict", message: ITEM_EDIT_MESSAGE });
    expect(rows(t)).toEqual(before);
    expect(t.events).toHaveLength(0);
    // Item rows leave the pot and wallets alone (coins 0).
    expect(coinsOnly(potOf(t))).toEqual(coins({}));
  });
});
