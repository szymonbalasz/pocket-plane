// LOOT §13 unit + integration (in-process): commands, events, notify decision, visibility,
// derived pot / wallets, conservation, window.
import { describe, expect, test } from "bun:test";
import {
  type Coins,
  LOOT_ENTRY_TYPE,
  LOOT_WINDOW,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  type PartyPotRecord,
  WALLET_TYPE,
  type WalletRecord,
} from "@shared/party-loot/schemas";
import { asc, eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { lootEntry, notification } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { lootAdd, lootEdit, lootMove } from "./commands";
import { seedLoot } from "./testing";

type T = ReturnType<typeof seedLoot>;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e.code;
    throw e;
  }
  return "ok";
}

const entries = (t: T) =>
  t.s.db.select().from(lootEntry).orderBy(asc(lootEntry.seq)).all() as { id: string }[];
const notes = (t: T) => t.s.db.select().from(notification).orderBy(asc(notification.seq)).all();
const potOf = (t: T, v = t.viewer("dm")) =>
  (t.snapshot(v)[PARTY_POT_TYPE] as PartyPotRecord[])[0] as PartyPotRecord;
const walletsOf = (t: T, v = t.viewer("dm")) =>
  Object.fromEntries((t.snapshot(v)[WALLET_TYPE] as WalletRecord[]).map((w) => [w.id, w]));
const coins = (c: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const add = (t: T, input: Parameters<T["run"]>[1], actor: Actor = t.dm) =>
  t.run(lootAdd, input as never, { actor }) as { entryId: string };
const move = (t: T, input: object, actor: Actor = t.dm) =>
  t.run(lootMove, input as never, { actor }) as { entryId: string };

describe("loot.add (FR-LOOT-01–03, FR-LOOT-13)", () => {
  test("FR-LOOT-01 FR-LOOT-03 row + event-log rows; LootAdded then NotificationCreated", () => {
    const t = seedLoot();
    t.events.length = 0;
    const r = add(t, { text: "Goblin chief's pouch", gp: 12, sp: 30 });
    const [row] = entries(t) as unknown as (typeof lootEntry.$inferSelect)[];
    expect(row).toMatchObject({
      id: r.entryId,
      campaignId: t.campaignId,
      kind: "loot",
      fromKind: "world",
      toKind: "party",
      text: "Goblin chief's pouch",
      gp: 12,
      sp: 30,
      editedAt: null,
    });
    expect(t.events.map((e) => e.event.type)).toEqual(["LootAdded", "NotificationCreated"]);
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({
      entryId: r.entryId,
      text: "Goblin chief's pouch",
      ...coins({ gp: 12, sp: 30 }),
    });
    expect(ev?.changes.map((c) => [c.type, c.before === null])).toEqual([
      [LOOT_ENTRY_TYPE, true],
      [PARTY_POT_TYPE, false],
    ]);
    expect(ev?.changes[1]?.after).toMatchObject(coins({ gp: 12, sp: 30 }));
    const log = readEventLog(t.s.db, t.campaignId).map((l) => l.type);
    expect(log.slice(-2)).toEqual(["LootAdded", "NotificationCreated"]);
    expect(notes(t)).toEqual([
      expect.objectContaining({
        kind: "loot-received",
        audience: "all",
        state: "info",
        actionLabel: null,
        text: "Party loot: Goblin chief's pouch (12 gp, 30 sp)",
        payload: { entryId: r.entryId },
      }),
    ]);
  });

  test("FR-LOOT-03 LootAdded lists the party-pot only when its value changed", () => {
    const t = seedLoot();
    t.events.length = 0;
    add(t, { text: "Potion of healing ×2" });
    const textOnly = t.events.find((e) => e.event.type === "LootAdded")?.event;
    expect(textOnly?.changes.map((c) => c.type)).toEqual([LOOT_ENTRY_TYPE]);
    t.events.length = 0;
    add(t, { text: "Pouch", gp: 12 });
    const withCoins = t.events.find((e) => e.event.type === "LootAdded")?.event;
    expect(withCoins?.changes.map((c) => c.type)).toEqual([LOOT_ENTRY_TYPE, PARTY_POT_TYPE]);
    expect(withCoins?.changes[1]).toMatchObject({ before: { gp: 0 }, after: { gp: 12 } });
  });

  test("FR-LOOT-13 notify decision: spends and change-making create none; text / coin variants", () => {
    const t = seedLoot();
    add(t, { text: "Paid the ferryman", gp: -2 });
    add(t, { text: "Change", gp: 5, sp: -50 });
    expect(notes(t)).toHaveLength(0);
    add(t, { text: "Potion of healing ×2" });
    add(t, { pp: 5 });
    expect(notes(t).map((n) => n.text)).toEqual([
      "Party loot: Potion of healing ×2",
      "Party loot: 5 pp",
    ]);
    // Spend → LootAdded only in the event log.
    const types = readEventLog(t.s.db, t.campaignId).map((l) => l.type);
    expect(types.filter((x) => x === "LootAdded")).toHaveLength(4);
    expect(types.filter((x) => x === "NotificationCreated")).toHaveLength(2);
  });

  test("FR-LOOT-03 notify forced to throw → nothing is written", () => {
    const t = seedLoot();
    const logBefore = readEventLog(t.s.db).length;
    t.s.db.$client.run(
      "CREATE TRIGGER fail_note BEFORE INSERT ON notification BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    t.events.length = 0;
    expect(codeOf(() => add(t, { text: "Gold", gp: 10 }))).toBe("internal");
    expect(entries(t)).toHaveLength(0);
    expect(readEventLog(t.s.db)).toHaveLength(logBefore);
    expect(t.events).toHaveLength(0);
    // A spend never calls notify, so it commits.
    expect(codeOf(() => add(t, { text: "Spend", gp: -1 }))).toBe("ok");
  });

  test("FR-LOOT-02 input rules → invalid; text cleaned", () => {
    const t = seedLoot();
    for (const bad of [
      {},
      { text: "   " },
      { text: "", gp: 0 },
      { gp: 1.5 },
      { gp: 1_000_000 },
      { sp: -1_000_000 },
      { text: "x".repeat(201) },
      { text: "ok", gems: 1 },
      { text: 5 },
    ]) {
      expect([JSON.stringify(bad), codeOf(() => add(t, bad))]).toEqual([
        JSON.stringify(bad),
        "invalid",
      ]);
    }
    expect(entries(t)).toHaveLength(0);
    add(t, { text: "  Ruby\u0007\n ", cp: 999_999, pp: -999_999 });
    expect((entries(t)[0] as LootEntryRecord).text).toBe("Ruby");
    add(t, { text: "y".repeat(200) });
    expect(entries(t)).toHaveLength(2);
  });

  test("FR-LOOT-05 player loot.add / loot.edit → forbidden, no event", () => {
    const t = seedLoot();
    const e = add(t, { text: "Idol", gp: 5 });
    t.events.length = 0;
    expect(codeOf(() => add(t, { text: "Mine", gp: 5 }, t.p1Actor))).toBe("forbidden");
    expect(
      codeOf(() =>
        t.run(
          lootEdit,
          { entryId: e.entryId, text: "Idol", cp: 0, sp: 0, ep: 0, gp: 500, pp: 0 },
          { actor: t.p1Actor },
        ),
      ),
    ).toBe("forbidden");
    expect(t.events).toHaveLength(0);
    expect(entries(t)).toHaveLength(1);
  });
});

describe("loot.edit (FR-LOOT-04)", () => {
  const full = (entryId: string, c: Partial<Coins>, text = "Silver idol") => ({
    entryId,
    text,
    ...coins(c),
  });

  test("FR-LOOT-04 LootEdited before / after; pot only when coins change; no notification", () => {
    const t = seedLoot();
    const e = add(t, { text: "Silver idol", gp: 500 });
    const noteBefore = notes(t);
    t.events.length = 0;
    t.run(lootEdit, full(e.entryId, { gp: 50 }), { actor: t.dm });
    expect(t.events.map((x) => x.event.type)).toEqual(["LootEdited"]);
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({
      entryId: e.entryId,
      before: { text: "Silver idol", ...coins({ gp: 500 }) },
      after: { text: "Silver idol", ...coins({ gp: 50 }) },
    });
    expect(ev?.changes.map((c) => c.type)).toEqual([LOOT_ENTRY_TYPE, PARTY_POT_TYPE]);
    expect(ev?.changes[0]?.after).toMatchObject({ gp: 50 });
    expect(typeof (ev?.changes[0]?.after as LootEntryRecord | undefined)?.editedAt).toBe("string");
    expect(ev?.changes[1]).toMatchObject({ before: { gp: 500 }, after: { gp: 50 } });
    expect(notes(t)).toEqual(noteBefore);
    expect(notes(t)[0]?.text).toBe("Party loot: Silver idol (500 gp)");

    // Text-only edit → entry change only.
    t.events.length = 0;
    t.run(lootEdit, full(e.entryId, { gp: 50 }, "Silver idol (cracked)"), { actor: t.dm });
    expect(t.events[0]?.event.changes.map((c) => c.type)).toEqual([LOOT_ENTRY_TYPE]);
    expect(readEventLog(t.s.db, t.campaignId).at(-1)?.type).toBe("LootEdited");
  });

  test("FR-LOOT-04 unchanged → ack, no write, no event; move → conflict; other campaign → not_found", () => {
    const t = seedLoot();
    const e = add(t, { text: "Silver idol", gp: 50 });
    const before = entries(t);
    const logLen = readEventLog(t.s.db).length;
    t.events.length = 0;
    expect(t.run(lootEdit, full(e.entryId, { gp: 50 }, "  Silver idol "), { actor: t.dm })).toBe(
      undefined,
    );
    expect(t.events).toHaveLength(0);
    expect(entries(t)).toEqual(before);
    expect(readEventLog(t.s.db)).toHaveLength(logLen);

    const m = move(t, { from: t.party, to: t.mira, gp: 1 });
    expect(codeOf(() => t.run(lootEdit, full(m.entryId, { gp: 2 }), { actor: t.dm }))).toBe(
      "conflict",
    );
    const other = add(t, { text: "Elsewhere", gp: 1 }, t.dmSecond);
    expect(codeOf(() => t.run(lootEdit, full(other.entryId, { gp: 2 }), { actor: t.dm }))).toBe(
      "not_found",
    );
    expect(codeOf(() => t.run(lootEdit, full("nope", { gp: 2 }), { actor: t.dm }))).toBe(
      "not_found",
    );
    // Edit needs every field.
    expect(
      codeOf(() => t.run(lootEdit, { entryId: e.entryId, text: "x" } as never, { actor: t.dm })),
    ).toBe("invalid");
  });
});

describe("loot.move (FR-LOOT-06–08)", () => {
  test("FR-LOOT-06 invalid coins, pairings and fields → invalid", () => {
    const t = seedLoot();
    for (const bad of [
      { from: t.party, to: t.mira },
      { from: t.party, to: t.mira, gp: 0 },
      { from: t.party, to: t.mira, gp: -1 },
      { from: t.party, to: t.mira, gp: 1.5 },
      { from: t.party, to: t.mira, gp: 1_000_000 },
      { from: t.mira, to: t.mira, gp: 1 },
      { from: t.party, to: t.party, gp: 1 },
      { from: t.party, to: t.world, gp: 1 },
      { from: t.world, to: t.party, gp: 1 },
      { from: t.world, to: t.world, gp: 1 },
      { from: t.party, to: t.mira, gp: 1, text: "x".repeat(101) },
      { from: t.party, to: t.mira, gp: 1, extra: true },
      { from: { kind: "character" }, to: t.party, gp: 1 },
      { from: { kind: "party", characterId: t.miraId }, to: t.mira, gp: 1 },
      { to: t.mira, gp: 1 },
    ]) {
      expect([JSON.stringify(bad), codeOf(() => move(t, bad))]).toEqual([
        JSON.stringify(bad),
        "invalid",
      ]);
    }
    expect(entries(t)).toHaveLength(0);
  });

  test("FR-LOOT-06 unknown / other-campaign / non-character id → not_found", () => {
    const t = seedLoot();
    expect(codeOf(() => move(t, { from: t.party, to: t.stranger, gp: 1 }))).toBe("not_found");
    const ghost = { kind: "character", characterId: "ghost" };
    expect(codeOf(() => move(t, { from: ghost, to: t.party, gp: 1 }))).toBe("not_found");
    expect(codeOf(() => move(t, { from: t.party, to: t.stranger, gp: 1 }, t.p1Actor))).toBe(
      "not_found",
    );
    expect(entries(t)).toHaveLength(0);
  });

  test("FR-LOOT-07 role matrix: DM any; player own → pot / other PC, pot → own; else forbidden", () => {
    const t = seedLoot();
    const ok = (input: object, actor: Actor) => codeOf(() => move(t, input, actor));
    // DM: any move, incl. `world` ends and another PC's coin.
    expect(ok({ from: t.party, to: t.mira, gp: 1 }, t.dm)).toBe("ok");
    expect(ok({ from: t.thorn, to: t.mira, gp: 1 }, t.dm)).toBe("ok");
    expect(ok({ from: t.world, to: t.thorn, gp: 1 }, t.dm)).toBe("ok");
    expect(ok({ from: t.mira, to: t.world, gp: 1 }, t.dm)).toBe("ok");
    // Player 1 owns Mira.
    expect(ok({ from: t.mira, to: t.party, gp: 1 }, t.p1Actor)).toBe("ok");
    expect(ok({ from: t.mira, to: t.thorn, gp: 1 }, t.p1Actor)).toBe("ok");
    expect(ok({ from: t.party, to: t.mira, gp: 1 }, t.p1Actor)).toBe("ok");
    const n = entries(t).length;
    t.events.length = 0;
    expect(ok({ from: t.thorn, to: t.mira, gp: 1 }, t.p1Actor)).toBe("forbidden");
    expect(ok({ from: t.thorn, to: t.party, gp: 1 }, t.p1Actor)).toBe("forbidden");
    expect(ok({ from: t.party, to: t.thorn, gp: 1 }, t.p1Actor)).toBe("forbidden");
    expect(ok({ from: t.mira, to: t.world, gp: 1 }, t.p1Actor)).toBe("forbidden");
    expect(ok({ from: t.world, to: t.mira, gp: 1 }, t.p1Actor)).toBe("forbidden");
    expect(ok({ from: t.party, to: t.mira, gp: 1 }, t.p2Actor)).toBe("forbidden");
    expect(entries(t)).toHaveLength(n);
    expect(t.events).toHaveLength(0);
  });

  test("FR-LOOT-08 changes list the pot iff a party end and one wallet per character end", () => {
    const t = seedLoot();
    t.events.length = 0;
    const m1 = move(t, { from: t.party, to: t.mira, gp: 20 });
    const e1 = t.events.at(-1)?.event;
    expect(e1?.type).toBe("CoinMoved");
    expect(e1?.payload).toEqual({
      entryId: m1.entryId,
      from: t.party,
      to: t.mira,
      text: "",
      ...coins({ gp: 20 }),
    });
    expect(e1?.changes.map((c) => [c.type, c.id, c.before === null])).toEqual([
      [LOOT_ENTRY_TYPE, m1.entryId, true],
      [PARTY_POT_TYPE, t.campaignId, false],
      [WALLET_TYPE, t.miraId, true],
    ]);
    expect(e1?.changes[2]?.after).toEqual({
      id: t.miraId,
      campaignId: t.campaignId,
      characterId: t.miraId,
      ...coins({ gp: 20 }),
    });
    move(t, { from: t.mira, to: t.thorn, gp: 2, text: "Rations" }, t.p1Actor);
    const e2 = t.events.at(-1)?.event;
    expect(e2?.changes.map((c) => [c.type, c.id, c.before === null])).toEqual([
      [LOOT_ENTRY_TYPE, expect.any(String), true],
      [WALLET_TYPE, t.miraId, false],
      [WALLET_TYPE, t.thornId, true],
    ]);
    expect(e2?.changes[1]).toMatchObject({ before: { gp: 20 }, after: { gp: 18 } });
    move(t, { from: t.thorn, to: t.world, gp: 1 });
    expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toEqual([
      LOOT_ENTRY_TYPE,
      WALLET_TYPE,
    ]);
    expect(t.events.some((e) => e.event.type === "NotificationCreated")).toBe(false);
    expect(notes(t)).toHaveLength(0);
    expect(readEventLog(t.s.db, t.campaignId).filter((l) => l.type === "CoinMoved")).toHaveLength(
      3,
    );
  });

  test("FR-LOOT-07 FR-LOOT-09 no balance check: pot and wallets may go negative", () => {
    const t = seedLoot();
    move(t, { from: t.party, to: t.mira, gp: 10 }, t.p1Actor);
    move(t, { from: t.thorn, to: t.mira, sp: 5 }, t.dm);
    expect(potOf(t)).toMatchObject(coins({ gp: -10 }));
    expect(walletsOf(t)[t.thornId]).toMatchObject(coins({ sp: -5 }));
    expect(walletsOf(t)[t.miraId]).toMatchObject(coins({ gp: 10, sp: 5 }));
  });
});

describe("derived pot and wallets (FR-LOOT-09), visibility (FR-LOOT-10), window (FR-LOOT-11)", () => {
  test("FR-LOOT-09 pot zeros with no entries; wallet only for characters with a move", () => {
    const t = seedLoot();
    expect(potOf(t)).toEqual({ id: t.campaignId, campaignId: t.campaignId, ...coins({}) });
    expect(t.snapshot(t.viewer("dm"))[WALLET_TYPE]).toEqual([]);
    add(t, { text: "Coins", gp: 3 });
    move(t, { from: t.party, to: t.thorn, gp: 1 });
    expect(Object.keys(walletsOf(t))).toEqual([t.thornId]);
  });

  test("FR-LOOT-09 conservation after 105 random entries (incl. below the window)", () => {
    const t = seedLoot();
    // Deterministic LCG: the test stays reproducible.
    let x = 42;
    const rnd = (n: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x % n;
    };
    const ends = [t.party, t.mira, t.thorn, t.world];
    const lootSum = coins({});
    const worldIn = coins({});
    for (let i = 0; i < 105; i++) {
      const c = coins({ gp: rnd(50), sp: rnd(20), cp: rnd(5) + 1 });
      if (rnd(3) === 0) {
        const signed = coins({ gp: c.gp - 25, sp: c.sp, cp: c.cp });
        add(t, { text: `e${i}`, ...signed });
        for (const k of ["cp", "sp", "ep", "gp", "pp"] as const) lootSum[k] += signed[k];
        continue;
      }
      const from = ends[rnd(4)] as (typeof ends)[number];
      let to = ends[rnd(4)] as (typeof ends)[number];
      if (to === from) to = from === t.party ? t.mira : t.party;
      if (from.kind === "world" && to.kind !== "character") to = t.thorn;
      if (to.kind === "world" && from.kind !== "character") continue;
      move(t, { from, to, ...c });
      const sign = from.kind === "world" ? 1 : to.kind === "world" ? -1 : 0;
      for (const k of ["cp", "sp", "ep", "gp", "pp"] as const) worldIn[k] += sign * c[k];
    }
    expect(entries(t).length).toBeGreaterThan(LOOT_WINDOW);
    const pot = potOf(t);
    const ws = Object.values(walletsOf(t));
    for (const k of ["cp", "sp", "ep", "gp", "pp"] as const) {
      const held = pot[k] + ws.reduce((n, w) => n + w[k], 0);
      expect([k, held]).toEqual([k, lootSum[k] + worldIn[k]]);
    }
    // FR-LOOT-11: the window holds the newest 100, the pot counts all of them.
    const snap = t.snapshot(t.viewer("player", t.p1.id))[LOOT_ENTRY_TYPE] as LootEntryRecord[];
    expect(snap).toHaveLength(LOOT_WINDOW);
    const all = entries(t) as unknown as LootEntryRecord[];
    // S9 (FR-LOOT-32): player entries carry no `seq`; the same rows by id.
    expect(snap.map((e) => e.id)).toEqual(all.slice(-LOOT_WINDOW).map((e) => e.id));
  });

  test("FR-LOOT-10 visibility: DM and player full for the campaign; other campaign hidden", () => {
    const t = seedLoot();
    add(t, { text: "Coins", gp: 3 });
    move(t, { from: t.party, to: t.thorn, gp: 1 });
    const dm = t.snapshot(t.viewer("dm"));
    const p1 = t.snapshot(t.viewer("player", t.p1.id));
    // S9 (FR-LOOT-32, review ruling 7): a player's entry is the DM's without `seq` (redacted).
    const noSeq = (rows: unknown[]) => rows.map((r) => ({ ...(r as object), seq: undefined }));
    for (const type of [LOOT_ENTRY_TYPE, PARTY_POT_TYPE, WALLET_TYPE]) {
      const entry = type === LOOT_ENTRY_TYPE;
      expect([type, entry ? noSeq(p1[type] ?? []) : p1[type]]).toEqual([
        type,
        entry ? noSeq(dm[type] ?? []) : dm[type],
      ]);
      for (const r of dm[type] as { id: string }[]) {
        expect(t.s.records.view(type, r, t.viewer("player", t.p1.id)).vis).toBe(
          entry ? "redacted" : "full",
        );
        expect(t.s.records.view(type, r, t.viewer("dm")).vis).toBe("full");
        const other = t.viewer("dm", null, t.secondCampaignId);
        expect(t.s.records.view(type, r, other).vis).toBe("hidden");
      }
    }
    // OQ-LOOT-13: player 1 sees Thorn's wallet too.
    expect((p1[WALLET_TYPE] as WalletRecord[]).map((w) => w.id)).toEqual([t.thornId]);
    const second = t.snapshot(t.viewer("dm", null, t.secondCampaignId));
    expect(second[LOOT_ENTRY_TYPE]).toEqual([]);
    expect(second[PARTY_POT_TYPE]).toEqual([
      { id: t.secondCampaignId, campaignId: t.secondCampaignId, ...coins({}) },
    ]);
  });

  test("FR-LOOT-01 seq is DB insertion order across campaigns", () => {
    const t = seedLoot();
    add(t, { text: "a" });
    add(t, { text: "b" }, t.dmSecond);
    add(t, { text: "c" });
    const rows = t.s.db
      .select()
      .from(lootEntry)
      .where(eq(lootEntry.campaignId, t.campaignId))
      .orderBy(asc(lootEntry.seq))
      .all();
    expect(rows.map((r) => [r.text, r.seq])).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
  });
});
