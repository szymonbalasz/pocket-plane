// PARTY §13 integration (in-process), P core: handout commands, `party.addItem`, the lazy record
// types and their visibility through the registry (snapshot, `sync.load`, filtered changes).
import { describe, expect, test } from "bun:test";
import {
  HANDOUT_BODY_TYPE,
  HANDOUT_LIMIT_MESSAGE,
  HANDOUT_MAX,
  HANDOUT_TYPE,
  type HandoutRecord,
  PARTY_FULL_MESSAGE,
  PARTY_ITEM_MAX,
  PARTY_ITEM_TYPE,
  type SharedWith,
} from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE, PARTY_POT_TYPE, WALLET_TYPE } from "@shared/party-loot/schemas";
import { asc, eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { handout, lootEntry, notification, partyItem } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, RecordChange } from "../../events/types";
import { addPlayer } from "../campaign-management/commands";
import {
  addItem,
  createHandout,
  deleteHandout,
  PARTY_INTENTS,
  shareHandout,
  updateHandout,
} from "./commands";
import { type PartySeed, seedParty } from "./testing";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e.code;
    throw e;
  }
  return "ok";
}
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "ok";
}

const NONE: SharedWith = { mode: "none", playerIds: [] };
const ALL: SharedWith = { mode: "all", playerIds: [] };
const only = (...playerIds: string[]): SharedWith => ({ mode: "players", playerIds });

const create = (t: PartySeed, input: object = {}, actor: Actor = t.dm) =>
  (
    t.run(
      createHandout,
      { title: "Mayor's Letter", body: "Dear heroes", imageAssetIds: [], ...input } as never,
      { actor },
    ) as { handoutId: string }
  ).handoutId;
const update = (t: PartySeed, handoutId: string, input: object, actor: Actor = t.dm) =>
  t.run(updateHandout, { handoutId, ...input } as never, { actor });
const share = (t: PartySeed, handoutId: string, sharedWith: SharedWith, actor: Actor = t.dm) =>
  t.run(shareHandout, { handoutId, sharedWith }, { actor });
const add = (t: PartySeed, input: object, actor: Actor = t.dm) =>
  (t.run(addItem, { notes: "", ...input } as never, { actor }) as { itemId: string }).itemId;
const row = (t: PartySeed, id: string) =>
  t.s.db.select().from(handout).where(eq(handout.id, id)).get();
const items = (t: PartySeed) => t.s.db.select().from(partyItem).orderBy(asc(partyItem.seq)).all();
const notes = (t: PartySeed) => t.s.db.select().from(notification).all();
const types = (e: { event: { changes: RecordChange[] } } | undefined) =>
  e?.event.changes.map((c) => [c.type, c.after === null ? "delete" : "upsert"]);

describe("handouts (FR-PARTY-01–05, 07, 08)", () => {
  test("FR-PARTY-01 handout, handout-body, party-item registered lazy; absent from every snapshot", () => {
    const t = seedParty();
    const h = create(t);
    share(t, h, ALL);
    add(t, { name: "Torch", qty: 10 });
    expect(t.s.records.get(HANDOUT_TYPE)?.lazy).toBe("all");
    expect(t.s.records.get(HANDOUT_BODY_TYPE)?.lazy).toBe("ids");
    expect(t.s.records.get(PARTY_ITEM_TYPE)?.lazy).toBe("all");
    for (const v of [t.viewer("dm"), t.viewer("player", t.p1.id), t.viewer("player", t.p2.id)]) {
      const snap = t.snapshot(v);
      for (const type of [HANDOUT_TYPE, HANDOUT_BODY_TYPE, PARTY_ITEM_TYPE])
        expect(snap[type]).toBeUndefined();
    }
  });

  test("FR-PARTY-01 the 201st handout → conflict", () => {
    const t = seedParty();
    for (let i = 0; i < HANDOUT_MAX; i++) create(t, { title: `H${i}`, body: "" });
    expect(messageOf(() => create(t, { title: "One more" }))).toBe(HANDOUT_LIMIT_MESSAGE);
    expect(codeOf(() => create(t, { title: "One more" }))).toBe("conflict");
    // Another campaign has its own cap.
    expect(codeOf(() => create(t, { title: "Second" }, t.dmSecond))).toBe("ok");
  });

  test("FR-PARTY-02 input rules → invalid; text cleaned; foreign / unknown assets → not_found", () => {
    const t = seedParty();
    for (const bad of [
      { title: "" },
      { title: "  \u0007 " },
      { title: "x".repeat(81) },
      { body: "x".repeat(10_001) },
      { imageAssetIds: Array.from({ length: 11 }, (_, i) => `${i}`.padStart(22, "a")) },
      { imageAssetIds: [t.images.map, t.images.map] },
      { extra: 1 },
    ]) {
      expect([JSON.stringify(bad).slice(0, 40), codeOf(() => create(t, bad))]).toEqual([
        JSON.stringify(bad).slice(0, 40),
        "invalid",
      ]);
    }
    const id = create(t, { title: "  Map\u0000 ", body: "a\r\nb\t\u0001c  " });
    expect(row(t, id)).toMatchObject({ title: "Map", body: "a\nb\tc" });
    expect(codeOf(() => create(t, { imageAssetIds: [t.images.second] }))).toBe("not_found");
    const unknown = "unknownAssetIdaaaaaaaa";
    expect(codeOf(() => create(t, { imageAssetIds: [unknown] }))).toBe("not_found");
    expect(codeOf(() => update(t, id, { title: "M", body: "", imageAssetIds: [unknown] }))).toBe(
      "not_found",
    );
    expect(create(t, { imageAssetIds: [t.images.poster, t.images.map] })).toBeString();
  });

  test("FR-PARTY-03 create: unshared row, rev 1, HandoutCreated (header + body), event log, no notification", () => {
    const t = seedParty();
    t.events.length = 0;
    const id = create(t, { imageAssetIds: [t.images.map] });
    expect(row(t, id)).toMatchObject({
      campaignId: t.campaignId,
      title: "Mayor's Letter",
      body: "Dear heroes",
      imageAssetIds: [t.images.map],
      sharedWith: NONE,
      rev: 1,
      bodyRev: 1,
      sharedAt: null,
    });
    expect(t.events.map((e) => e.event.type)).toEqual(["HandoutCreated"]);
    const ev = t.events[0];
    expect(ev?.event.payload).toEqual({ handoutId: id });
    expect(types(ev)).toEqual([
      [HANDOUT_TYPE, "upsert"],
      [HANDOUT_BODY_TYPE, "upsert"],
    ]);
    expect(ev?.event.changes.every((c) => c.before === null)).toBe(true);
    expect(ev?.event.changes[0]?.after).not.toHaveProperty("body");
    expect(ev?.event.changes[1]?.after).toEqual({
      id,
      campaignId: t.campaignId,
      body: "Dear heroes",
      rev: 1,
      sharedWith: NONE,
    });
    expect(readEventLog(t.s.db, t.campaignId).at(-1)?.type).toBe("HandoutCreated");
    expect(notes(t)).toHaveLength(0);
  });

  test("FR-PARTY-04 update: same → ack, no event; title-only → header only; body → body too; not_found", () => {
    const t = seedParty();
    const id = create(t);
    const same = { title: "Mayor's Letter", body: "Dear heroes", imageAssetIds: [] };
    t.events.length = 0;
    expect(codeOf(() => update(t, id, same))).toBe("ok");
    expect(t.events).toHaveLength(0);
    expect(row(t, id)?.rev).toBe(1);

    update(t, id, { ...same, title: "Mayor's Letter (copy)" });
    expect(t.events.map((e) => e.event.type)).toEqual(["HandoutUpdated"]);
    expect(t.events[0]?.event.payload).toEqual({ handoutId: id, rev: 2 });
    expect(types(t.events[0])).toEqual([[HANDOUT_TYPE, "upsert"]]);
    expect(row(t, id)).toMatchObject({ rev: 2, bodyRev: 1 });

    t.events.length = 0;
    update(t, id, { ...same, title: "Mayor's Letter (copy)", body: "Dear heroes, come" });
    expect(types(t.events[0])).toEqual([
      [HANDOUT_TYPE, "upsert"],
      [HANDOUT_BODY_TYPE, "upsert"],
    ]);
    expect(t.events[0]?.event.changes[1]?.after).toMatchObject({ rev: 3 });
    expect(row(t, id)).toMatchObject({ rev: 3, bodyRev: 3 });

    t.events.length = 0;
    update(t, id, {
      ...same,
      title: "Mayor's Letter (copy)",
      body: "Dear heroes, come",
      imageAssetIds: [t.images.map],
    });
    expect(types(t.events[0])).toEqual([[HANDOUT_TYPE, "upsert"]]);

    expect(codeOf(() => update(t, "nope", same))).toBe("not_found");
    expect(codeOf(() => update(t, id, same, t.dmSecond))).toBe("not_found");
    // A fresh load equals the last body change: its `rev` is the body's own (convergence).
    expect(t.load(t.viewer("dm"), HANDOUT_BODY_TYPE, [id])).toEqual([
      { id, campaignId: t.campaignId, body: "Dear heroes, come", rev: 3, sharedWith: NONE },
    ]);
  });

  test("FR-PARTY-05 share rules: player checks, none/all with ids → invalid, same share → ack no event", () => {
    const t = seedParty();
    const id = create(t);
    expect(codeOf(() => share(t, id, only("nope")))).toBe("not_found");
    expect(codeOf(() => share(t, id, only(t.secondPlayerId)))).toBe("not_found"); // another campaign's player
    expect(codeOf(() => share(t, id, { mode: "all", playerIds: [t.p1.id] }))).toBe("invalid");
    expect(codeOf(() => share(t, id, { mode: "none", playerIds: [t.p1.id] }))).toBe("invalid");
    expect(codeOf(() => share(t, id, only()))).toBe("invalid");
    expect(codeOf(() => share(t, id, only(t.p1.id, t.p1.id)))).toBe("invalid");
    expect(codeOf(() => share(t, id, only(...Array.from({ length: 21 }, (_, i) => `p${i}`))))).toBe(
      "invalid",
    );
    expect(codeOf(() => share(t, "nope", ALL))).toBe("not_found");
    expect(codeOf(() => share(t, id, ALL, t.dmSecond))).toBe("not_found");
    t.events.length = 0;
    expect(codeOf(() => share(t, id, NONE))).toBe("ok");
    share(t, id, only(t.p1.id, t.p2.id));
    expect(t.events).toHaveLength(1);
    share(t, id, only(t.p2.id, t.p1.id)); // order ignored
    expect(t.events).toHaveLength(1);
  });

  test("FR-PARTY-05 HandoutShared payload + header/body changes; sharedAt iff someone gains access", () => {
    const t = seedParty();
    const id = create(t);
    t.clock.advance(1000);
    t.events.length = 0;
    share(t, id, only(t.p1.id));
    const first = row(t, id)?.sharedAt;
    expect(first).toBeString();
    const ev = t.events[0];
    expect(ev?.event.type).toBe("HandoutShared");
    expect(ev?.event.payload).toEqual({ handoutId: id, before: NONE, after: only(t.p1.id) });
    expect(types(ev)).toEqual([
      [HANDOUT_TYPE, "upsert"],
      [HANDOUT_BODY_TYPE, "upsert"],
    ]);
    // all → players: nobody gains; sharedAt unchanged. Unshare: unchanged too.
    t.clock.advance(1000);
    share(t, id, ALL);
    const second = row(t, id)?.sharedAt;
    expect(second).not.toBe(first as string); // player-2 gained access
    share(t, id, only(t.p1.id));
    expect(row(t, id)?.sharedAt).toBe(second as string);
    share(t, id, NONE);
    expect(row(t, id)?.sharedAt).toBe(second as string);
    expect(row(t, id)?.rev).toBe(1); // sharing is not a content update
    expect(notes(t)).toHaveLength(0); // FR-PARTY-06 notifications come with slice 2
  });

  test("FR-PARTY-07 loads: DM full; listed player redacted header (no ids) + body without sharedWith; others nothing", () => {
    const t = seedParty();
    const h1 = create(t, { title: "All" });
    const h2 = create(t, { title: "P1 only", body: "secret map" });
    const h3 = create(t, { title: "Prep", body: "prep" });
    share(t, h1, ALL);
    share(t, h2, only(t.p1.id));
    const dm = t.viewer("dm");
    const p1 = t.viewer("player", t.p1.id);
    const p2 = t.viewer("player", t.p2.id);
    const ids = (rs: unknown[]) => (rs as { id: string }[]).map((r) => r.id);
    expect(ids(t.load(dm, HANDOUT_TYPE))).toEqual([h1, h2, h3]);
    expect((t.load(dm, HANDOUT_TYPE)[1] as HandoutRecord).sharedWith).toEqual(only(t.p1.id));
    const p1Headers = t.load(p1, HANDOUT_TYPE) as Record<string, unknown>[];
    expect(ids(p1Headers)).toEqual([h1, h2]);
    expect(p1Headers.map((h) => h.sharedWith)).toEqual([{ mode: "all" }, { mode: "players" }]);
    expect(ids(t.load(p2, HANDOUT_TYPE))).toEqual([h1]);
    expect(t.load(p1, HANDOUT_BODY_TYPE, [h2, h3])).toEqual([
      { id: h2, campaignId: t.campaignId, body: "secret map", rev: 1 },
    ]);
    expect(t.load(p2, HANDOUT_BODY_TYPE, [h2, h3])).toEqual([]);
    expect(ids(t.load(dm, HANDOUT_BODY_TYPE, [h2, h3]))).toEqual([h2, h3]);
    // Another campaign's DM never loads ours.
    expect(t.load(t.viewer("dm", null, t.secondCampaignId), HANDOUT_TYPE)).toEqual([]);
    expect(t.load(t.viewer("dm", null, t.secondCampaignId), HANDOUT_BODY_TYPE, [h1])).toEqual([]);
  });

  test("FR-PARTY-07 share changes per viewer: gainers upsert, losers delete, others nothing; mode all covers a later player", () => {
    const t = seedParty();
    const id = create(t);
    const p1 = t.viewer("player", t.p1.id);
    const p2 = t.viewer("player", t.p2.id);
    const wire = (v: ReturnType<typeof t.viewer>) =>
      (t.events.at(-1)?.event.changes ?? []).map((c) => {
        const w = t.s.records.filterChange(c, v);
        return w ? `${w.type}:${w.op}` : null;
      });
    share(t, id, only(t.p1.id));
    expect(wire(p1)).toEqual(["handout:upsert", "handout-body:upsert"]);
    expect(wire(p2)).toEqual([null, null]);
    const p1Header = t.s.records.filterChange(
      t.events.at(-1)?.event.changes[0] as RecordChange,
      p1,
    );
    expect(p1Header?.data).toMatchObject({ sharedWith: { mode: "players" } });
    expect(JSON.stringify(p1Header?.data)).not.toContain(t.p1.id);
    share(t, id, ALL);
    // player-1 keeps access: the header's redacted mode changes, the body's wire doesn't (dropped).
    expect(wire(p1)).toEqual(["handout:upsert", null]);
    expect(wire(p2)).toEqual(["handout:upsert", "handout-body:upsert"]);
    share(t, id, only(t.p2.id));
    expect(wire(p1)).toEqual(["handout:delete", "handout-body:delete"]);
    share(t, id, ALL);
    // A player added after an `all` share sees it.
    const late = t.run(addPlayer, { name: "Player 3" }, { actor: t.dm });
    expect(t.load(t.viewer("player", late.id), HANDOUT_TYPE)).toHaveLength(1);
    share(t, id, NONE);
    expect(wire(p1)).toEqual(["handout:delete", "handout-body:delete"]);
    expect(wire(t.viewer("player", late.id))).toEqual(["handout:delete", "handout-body:delete"]);
  });

  test("FR-PARTY-08 delete: header + body deletes to who saw it; notifications stay; not_found", () => {
    const t = seedParty();
    const id = create(t);
    share(t, id, only(t.p1.id));
    t.events.length = 0;
    t.run(deleteHandout, { handoutId: id }, { actor: t.dm });
    expect(row(t, id)).toBeUndefined();
    expect(t.events.map((e) => e.event.type)).toEqual(["HandoutDeleted"]);
    expect(types(t.events[0])).toEqual([
      [HANDOUT_TYPE, "delete"],
      [HANDOUT_BODY_TYPE, "delete"],
    ]);
    const p1 = t.viewer("player", t.p1.id);
    const p2 = t.viewer("player", t.p2.id);
    const changes = t.events[0]?.event.changes ?? [];
    expect(changes.map((c) => t.s.records.filterChange(c, p1)?.op)).toEqual(["delete", "delete"]);
    expect(changes.map((c) => t.s.records.filterChange(c, p2))).toEqual([null, null]);
    expect(codeOf(() => t.run(deleteHandout, { handoutId: id }, { actor: t.dm }))).toBe(
      "not_found",
    );
    const other = create(t);
    expect(codeOf(() => t.run(deleteHandout, { handoutId: other }, { actor: t.dmSecond }))).toBe(
      "not_found",
    );
  });

  test("PARTY §10 players sending DM-only intents → forbidden, no change", () => {
    const t = seedParty();
    const id = create(t);
    const logBefore = readEventLog(t.s.db).length;
    for (const actor of [t.p1Actor, t.p2Actor]) {
      expect(codeOf(() => create(t, {}, actor))).toBe("forbidden");
      expect(codeOf(() => update(t, id, { title: "X", body: "", imageAssetIds: [] }, actor))).toBe(
        "forbidden",
      );
      expect(codeOf(() => share(t, id, ALL, actor))).toBe("forbidden");
      expect(codeOf(() => t.run(deleteHandout, { handoutId: id }, { actor }))).toBe("forbidden");
      expect(codeOf(() => add(t, { name: "Torch", qty: 1 }, actor))).toBe("forbidden");
    }
    expect(readEventLog(t.s.db)).toHaveLength(logBefore);
    expect(Object.values(PARTY_INTENTS).every((n) => t.s.intents.has(n))).toBe(true);
  });
});

describe("party inventory core (FR-PARTY-17–19, 25)", () => {
  test("FR-PARTY-19 add: insert, kind item world → party with qty, coins 0, PartyItemAdded then loot-received", () => {
    const t = seedParty();
    const potBefore = t.snapshot(t.viewer("dm"))[PARTY_POT_TYPE];
    const walletsBefore = t.snapshot(t.viewer("dm"))[WALLET_TYPE];
    t.events.length = 0;
    const itemId = add(t, { name: "  Potion of healing ", qty: 2 });
    expect(items(t)).toEqual([
      expect.objectContaining({ id: itemId, name: "Potion of healing", qty: 2, notes: "" }),
    ]);
    expect(t.events.map((e) => e.event.type)).toEqual(["PartyItemAdded", "NotificationCreated"]);
    const ev = t.events[0]?.event;
    expect(types(t.events[0])).toEqual([
      [PARTY_ITEM_TYPE, "upsert"],
      [LOOT_ENTRY_TYPE, "upsert"],
    ]);
    const entry = ev?.changes[1]?.after as Record<string, unknown>;
    expect(entry).toMatchObject({
      kind: "item",
      from: { kind: "world" },
      to: { kind: "party" },
      text: "Potion of healing",
      qty: 2,
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    });
    expect(ev?.payload).toEqual({
      itemId,
      entryId: entry.id,
      name: "Potion of healing",
      qty: 2,
      notes: "",
    });
    expect(notes(t)).toEqual([
      expect.objectContaining({
        kind: "loot-received",
        audience: "all",
        text: "Party loot: Potion of healing ×2",
        payload: { entryId: entry.id },
      }),
    ]);
    // FR-PARTY-25: pot and wallets unaffected (coins 0).
    expect(t.snapshot(t.viewer("dm"))[PARTY_POT_TYPE]).toEqual(potBefore as never);
    expect(t.snapshot(t.viewer("dm"))[WALLET_TYPE]).toEqual(walletsBefore as never);
    expect(t.events[0]?.event.changes.map((c) => c.type)).not.toContain(PARTY_POT_TYPE);
  });

  test("FR-PARTY-18 FR-PARTY-19 merge key: name case-insensitive + trimmed, notes exact; qty cap → conflict", () => {
    const t = seedParty();
    const torch = add(t, { name: "Torch", qty: 10 });
    expect(add(t, { name: "  tORCH", qty: 5 })).toBe(torch);
    const other = add(t, { name: "Torch", qty: 1, notes: "Oiled" });
    expect(other).not.toBe(torch);
    expect(items(t).map((i) => [i.name, i.qty, i.notes])).toEqual([
      ["Torch", 15, ""],
      ["Torch", 1, "Oiled"],
    ]);
    expect(codeOf(() => add(t, { name: "torch", qty: 9_985 }))).toBe("conflict");
    expect(add(t, { name: "torch", qty: 9_984 })).toBe(torch);
    for (const bad of [
      { name: "", qty: 1 },
      { name: "x".repeat(61), qty: 1 },
      { name: "Rope", qty: 0 },
      { name: "Rope", qty: 10_000 },
      { name: "Rope", qty: 1.5 },
      { name: "Rope", qty: 1, notes: "x".repeat(121) },
      { name: "Rope", qty: 1, weight: 3 },
    ])
      expect(codeOf(() => add(t, bad))).toBe("invalid");
    // Log rows record each add's qty, not the merged total.
    const qtys = t.s.db
      .select()
      .from(lootEntry)
      .orderBy(asc(lootEntry.seq))
      .all()
      .filter((e) => e.kind === "item")
      .map((e) => e.qty);
    expect(qtys).toEqual([10, 5, 1, 9_984]);
  });

  test("FR-PARTY-17 FR-PARTY-19 the 61st row → conflict; a merge still fits; visibility full per campaign", () => {
    const t = seedParty();
    for (let i = 0; i < PARTY_ITEM_MAX; i++) add(t, { name: `Item ${i}`, qty: 1 });
    expect(messageOf(() => add(t, { name: "Extra", qty: 1 }))).toBe(PARTY_FULL_MESSAGE);
    expect(codeOf(() => add(t, { name: "item 3", qty: 1 }))).toBe("ok");
    const all = t.load(t.viewer("dm"), PARTY_ITEM_TYPE);
    expect(all).toHaveLength(PARTY_ITEM_MAX);
    expect(t.load(t.viewer("player", t.p2.id), PARTY_ITEM_TYPE)).toEqual(all);
    expect(t.load(t.viewer("dm", null, t.secondCampaignId), PARTY_ITEM_TYPE)).toEqual([]);
  });

  test("FR-PARTY-19 notify forced to throw → nothing is written", () => {
    const t = seedParty();
    const logBefore = readEventLog(t.s.db).length;
    t.s.db.$client.run(
      "CREATE TRIGGER fail_note BEFORE INSERT ON notification BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    t.events.length = 0;
    expect(codeOf(() => add(t, { name: "Torch", qty: 1 }))).toBe("internal");
    expect(items(t)).toHaveLength(0);
    expect(t.s.db.select().from(lootEntry).all()).toHaveLength(0);
    expect(readEventLog(t.s.db)).toHaveLength(logBefore);
    expect(t.events).toHaveLength(0);
  });
});
