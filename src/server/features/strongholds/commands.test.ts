// HOLD §13 integration (in-memory): create / update / facilities / staff / move / remove incl.
// no-op `ack`, caps, `forbidden` for players, `not_found` across campaigns; facility removal with
// its reminders; delete moving the Stores to the party (split balances, hidden text, full party);
// show / hide with a 500-entry ledger (window-only changes); the 48 KB event bound.
import { describe, expect, test } from "bun:test";
import { PARTY_ITEM_TYPE } from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE, STORES_COIN_TYPE } from "@shared/party-loot/schemas";
import { REMINDER_TYPE } from "@shared/reminders/schemas";
import {
  FACILITIES_MAX,
  FACILITY_EFFECT_MAX,
  FACILITY_ORDER_MAX,
  HOLD_NAME_MAX,
  HOLD_NOTES_MAX,
  STAFF_MAX,
  STAFF_NOTES_MAX,
  STAFF_ROLE_MAX,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  type StrongholdRecord,
} from "@shared/strongholds/schemas";
import { eq } from "drizzle-orm";
import { stateDigest } from "../../db/digest";
import { lootEntry, lootEntrySeqNext, partyItem } from "../../db/schema";
import { partyPot, storesCoinOf } from "../party-loot/rows";
import { getReminder } from "../reminders/rows";
import { getStronghold, listStrongholds } from "./rows";
import { codeOf, coinConservation, errorOf, type RsSeed, seedRs } from "./testing";

const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);
const hold = (t: RsSeed, id: string) => getStronghold(t.s.db, t.campaignId, id) as StrongholdRecord;
const dm = (t: RsSeed, name: string, input: unknown) => t.run(name, input, { actor: t.dm });
const stores = (strongholdId: string) => ({ kind: "stores" as const, strongholdId });

describe("HOLD §13 commands", () => {
  test("FR-HOLD-11 FR-HOLD-12 create and update: defaults, names, caps, no-op, rights, campaigns", () => {
    const t = seedRs();
    const n = t.events.length;
    const id = t.hold("Greystone Keep");
    expect(hold(t, id)).toMatchObject({
      dmOnly: true,
      defenders: 0,
      notes: "",
      facilities: [],
      staff: [],
    });
    const created = t.since(n);
    expect(created.map((e) => [e.event.type, e.event.changes.map((c) => c.type)])).toEqual([
      ["StrongholdCreated", [STRONGHOLD_TYPE, STRONGHOLD_INDEX_TYPE]],
    ]);
    expect(created[0]?.event.quietWhenUnchanged).toBe(true);
    // FR-HOLD-03: unique per campaign, case-insensitive; the second campaign may reuse it.
    expect(errorOf(() => t.hold("GREYSTONE keep"))).toEqual({
      code: "conflict",
      message: "A stronghold with that name exists",
    });
    expect(
      codeOf(() => t.run("hold.create", { name: "Greystone Keep" }, { actor: t.dmSecond })),
    ).toBe("ok");
    // FR-HOLD-02: ≤ 8.
    const t2 = seedRs();
    for (let i = 0; i < 8; i++) t2.hold(`Hold ${i}`);
    expect(errorOf(() => t2.hold("Ninth"))).toEqual({
      code: "conflict",
      message: "Stronghold limit reached (8)",
    });
    // Update: same values → no event; rename → index change too.
    const m = t.events.length;
    dm(t, "hold.update", { strongholdId: id, dmOnly: true, defenders: 0 });
    expect(t.since(m)).toEqual([]);
    dm(t, "hold.update", { strongholdId: id, name: "Greystone Hold", defenders: 12 });
    const upd = t.since(m);
    expect(upd.map((e) => [e.event.type, e.event.payload])).toEqual([
      ["StrongholdUpdated", { strongholdId: id, part: "header" }],
    ]);
    expect(upd[0]?.event.changes.map((c) => c.type)).toEqual([
      STRONGHOLD_TYPE,
      STRONGHOLD_INDEX_TYPE,
    ]);
    // OQ-HOLD-08 A: every HOLD intent is the DM's.
    const intents: [string, unknown][] = [
      ["hold.create", { name: "Mine" }],
      ["hold.update", { strongholdId: id, defenders: 1 }],
      ["hold.saveFacility", { strongholdId: id, facility: { name: "F", state: "built" } }],
      ["hold.saveStaff", { strongholdId: id, staff: { name: "S" } }],
      ["hold.moveRow", { strongholdId: id, list: "staff", id: "s", index: 0 }],
      ["hold.removeStaff", { strongholdId: id, staffId: "s" }],
      ["hold.removeFacility", { strongholdId: id, facilityId: "f" }],
      ["hold.delete", { strongholdId: id }],
    ];
    for (const [name, input] of intents)
      expect([name, codeOf(() => t.run(name, input, { actor: t.p1Actor }))]).toEqual([
        name,
        "forbidden",
      ]);
    // FR-HOLD-18: another campaign's stronghold → not_found.
    for (const [name, input] of intents.slice(1))
      expect([name, codeOf(() => t.run(name, input, { actor: t.dmSecond }))]).toEqual([
        name,
        "not_found",
      ]);
  });

  test("FR-HOLD-13 FR-HOLD-14 FR-HOLD-15 FR-HOLD-16 facilities and staff", () => {
    const t = seedRs();
    const id = t.hold("Greystone Keep");
    const old = t.facility(id, { name: "Old Bathhouse", state: "replaced" });
    const steam = t.facility(id, { name: "Steam Rooms", state: "built", replacesId: old });
    expect(hold(t, id).facilities.map((f) => [f.name, f.replacesId])).toEqual([
      ["Old Bathhouse", null],
      ["Steam Rooms", old],
    ]);
    // Replace by id; same values → no event; a gone / self / unknown pointer.
    const n = t.events.length;
    dm(t, "hold.saveFacility", {
      strongholdId: id,
      facility: { id: steam, name: "Steam Rooms", state: "built", replacesId: old },
    });
    expect(t.since(n)).toEqual([]);
    dm(t, "hold.saveFacility", {
      strongholdId: id,
      facility: { id: steam, name: "Steam Rooms", state: "built", replacesId: old, upkeep: 3 },
    });
    expect(t.since(n).map((e) => e.event.payload)).toEqual([
      { strongholdId: id, part: "facility", facilityId: steam },
    ]);
    const save = (facility: unknown) =>
      codeOf(() => dm(t, "hold.saveFacility", { strongholdId: id, facility }));
    expect(save({ id: "gone", name: "X", state: "built" })).toBe("not_found");
    expect(save({ id: steam, name: "S", state: "built", replacesId: steam })).toBe("invalid");
    expect(save({ name: "S", state: "built", replacesId: "nope" })).toBe("not_found");
    // Staff.
    const brenna = (
      dm(t, "hold.saveStaff", {
        strongholdId: id,
        staff: { name: "Brenna", role: "smith", wage: 2, facilityId: steam },
      }) as { staffId: string }
    ).staffId;
    const tobin = (
      dm(t, "hold.saveStaff", { strongholdId: id, staff: { name: "Tobin" } }) as {
        staffId: string;
      }
    ).staffId;
    expect(
      codeOf(() =>
        dm(t, "hold.saveStaff", { strongholdId: id, staff: { name: "S", facilityId: "nope" } }),
      ),
    ).toBe("not_found");
    expect(
      codeOf(() => dm(t, "hold.saveStaff", { strongholdId: id, staff: { id: "gone", name: "S" } })),
    ).toBe("not_found");
    // Move: clamped; same place → no event; `part: order`.
    const m = t.events.length;
    dm(t, "hold.moveRow", { strongholdId: id, list: "staff", id: brenna, index: 0 });
    expect(t.since(m)).toEqual([]);
    dm(t, "hold.moveRow", { strongholdId: id, list: "staff", id: brenna, index: 9 });
    expect(hold(t, id).staff.map((s) => s.id)).toEqual([tobin, brenna]);
    expect(t.since(m).map((e) => e.event.payload)).toEqual([{ strongholdId: id, part: "order" }]);
    expect(
      codeOf(() =>
        dm(t, "hold.moveRow", { strongholdId: id, list: "facilities", id: "x", index: 0 }),
      ),
    ).toBe("not_found");
    // Remove staff.
    dm(t, "hold.removeStaff", { strongholdId: id, staffId: tobin });
    expect(hold(t, id).staff.map((s) => s.id)).toEqual([brenna]);
    expect(codeOf(() => dm(t, "hold.removeStaff", { strongholdId: id, staffId: tobin }))).toBe(
      "not_found",
    );
    // Caps: 24 facilities, 40 staff.
    const big = t.hold("Big");
    for (let i = 0; i < FACILITIES_MAX; i++) t.facility(big, { name: `F${i}`, state: "planned" });
    expect(errorOf(() => t.facility(big, { name: "One more", state: "planned" }))).toEqual({
      code: "conflict",
      message: "Facility limit reached (24)",
    });
    for (let i = 0; i < STAFF_MAX; i++)
      dm(t, "hold.saveStaff", { strongholdId: big, staff: { name: `S${i}` } });
    expect(
      errorOf(() => dm(t, "hold.saveStaff", { strongholdId: big, staff: { name: "More" } })),
    ).toEqual({ code: "conflict", message: "Staff limit reached (40)" });
  });

  test("FR-HOLD-17 removing a facility removes its reminders", () => {
    const t = seedRs();
    const id = t.hold("Greystone Keep", true);
    const old = t.facility(id, { name: "Old Bathhouse", state: "replaced" });
    const steam = t.facility(id, { name: "Steam Rooms", state: "built", replacesId: old });
    dm(t, "hold.saveStaff", { strongholdId: id, staff: { name: "Attendant", facilityId: steam } });
    const rem = (
      t.run(
        "rem.save",
        { target: { kind: "party" }, text: "Steam", strongholdId: id, facilityId: steam },
        { actor: t.dm },
      ) as { reminderId: string }
    ).reminderId;
    // Removing Old Bathhouse: Steam Rooms no longer replaces anything.
    dm(t, "hold.removeFacility", { strongholdId: id, facilityId: old });
    expect(hold(t, id).facilities.map((f) => [f.name, f.replacesId])).toEqual([
      ["Steam Rooms", null],
    ]);
    const n = t.events.length;
    dm(t, "hold.removeFacility", { strongholdId: id, facilityId: steam });
    const evs = t.since(n);
    expect(evs.map((e) => [e.event.type, e.event.payload])).toEqual([
      ["FacilityRemoved", { strongholdId: id, facilityId: steam, reminderIds: [rem] }],
    ]);
    expect(getReminder(t.s.db, t.campaignId, rem)).toBeNull();
    expect(hold(t, id).staff[0]?.facilityId).toBeNull();
    // Players get the reminder delete in the same event.
    const del = evs[0]?.event.changes.find((c) => c.type === REMINDER_TYPE);
    expect(del && t.s.records.filterChange(del, t.p1V)).toEqual({
      type: REMINDER_TYPE,
      id: rem,
      op: "delete",
    });
    expect(
      codeOf(() => dm(t, "hold.removeFacility", { strongholdId: id, facilityId: steam })),
    ).toBe("not_found");
  });

  test("FR-HOLD-19 delete moves Stores to the party", () => {
    const t = seedRs();
    const tower = t.hold("HOLD-SECRET-TOWER");
    t.run(
      "rem.save",
      { target: { kind: "party" }, text: "t", strongholdId: tower },
      { actor: t.dm },
    );
    dm(t, "party.addItem", { name: "HOLD-SECRET-ITEM", qty: 1, notes: "", holder: stores(tower) });
    dm(t, "party.addItem", { name: "Rope", qty: 2, notes: "", holder: stores(tower) });
    dm(t, "party.addItem", { name: "Rope", qty: 3, notes: "" });
    dm(t, "loot.move", { from: { kind: "world" }, to: stores(tower), gp: 10 });
    const potBefore = partyPot(t.s.db, t.campaignId);
    const n = t.events.length;
    dm(t, "hold.delete", { strongholdId: tower });
    expect(listStrongholds(t.s.db, t.campaignId)).toEqual([]);
    const ev = t.since(n);
    expect(ev.map((e) => e.event.type)).toEqual(["StrongholdDeleted"]);
    const p = ev[0]?.event.payload as { reminderIds: string[]; entryIds: string[] };
    expect([p.reminderIds.length, p.entryIds.length]).toEqual([1, 3]);
    // Items merged into the party (Rope 3 + 2), the item appended; 10 gp to the pot.
    const party = t.s.db.select().from(partyItem).all();
    expect(party.map((i) => [i.name, i.qty, i.strongholdId])).toEqual([
      ["Rope", 5, null],
      ["HOLD-SECRET-ITEM", 1, null],
    ]);
    expect(partyPot(t.s.db, t.campaignId).gp).toBe(potBefore.gp + 10);
    expect(storesCoinOf(t.s.db, t.campaignId, tower)).toBeNull();
    // A hidden Stores: the entries carry no text (review ruling 3a) and the hidden copy.
    const entries = t.s.db.select().from(lootEntry).all().slice(-3);
    expect(entries.map((e) => [e.kind, e.fromKind, e.toKind, e.text, e.storesHidden])).toEqual([
      ["item", "stores", "party", "HOLD-SECRET-ITEM", true],
      ["item", "stores", "party", "Rope", true],
      ["move", "stores", "party", "", true],
    ]);
    const changeTypes = new Set(ev[0]?.event.changes.map((c) => c.type));
    for (const type of [
      STRONGHOLD_TYPE,
      STRONGHOLD_INDEX_TYPE,
      REMINDER_TYPE,
      PARTY_ITEM_TYPE,
      LOOT_ENTRY_TYPE,
      "party-pot",
      STORES_COIN_TYPE,
    ])
      expect([type, changeTypes.has(type)]).toEqual([type, true]);
    const [held, outside] = coinConservation(t.s.db, t.campaignId);
    expect(held).toEqual(outside);

    // A full party inventory → conflict, nothing written.
    const t2 = seedRs();
    const keep = t2.hold("Keep");
    for (let i = 0; i < 60; i++)
      t2.run("party.addItem", { name: `Item ${i}`, qty: 1, notes: "" }, { actor: t2.dm });
    t2.run(
      "party.addItem",
      { name: "Spare", qty: 1, notes: "", holder: stores(keep) },
      { actor: t2.dm },
    );
    const digest = stateDigest(t2.s.db.$client).sha256;
    expect(errorOf(() => t2.run("hold.delete", { strongholdId: keep }, { actor: t2.dm }))).toEqual({
      code: "conflict",
      message: "Party inventory is full (60) — move or remove items first",
    });
    expect(stateDigest(t2.s.db.$client).sha256).toBe(digest);
  });

  test("FR-HOLD-19 delete splits big balances", () => {
    const t = seedRs();
    const keep = t.hold("Greystone Keep", true);
    for (let i = 0; i < 3; i++)
      dm(t, "loot.move", { from: { kind: "world" }, to: stores(keep), gp: 833_334, sp: 5 });
    dm(t, "loot.move", { from: stores(keep), to: { kind: "world" }, cp: 15 });
    // Balance: 2,500,002 gp, 15 sp, −15 cp.
    dm(t, "hold.delete", { strongholdId: keep });
    const rows = t.s.db.select().from(lootEntry).all().slice(-4);
    expect(rows.map((e) => [e.fromKind, e.toKind, e.gp, e.sp, e.cp, e.text])).toEqual([
      ["stores", "party", 999_999, 15, 0, "Stronghold deleted"],
      ["stores", "party", 999_999, 0, 0, "Stronghold deleted"],
      ["stores", "party", 500_004, 0, 0, "Stronghold deleted"],
      ["party", "stores", 0, 0, 15, "Stronghold deleted"],
    ]);
    for (const e of rows)
      expect(Math.max(e.gp, e.sp, e.cp, e.ep, e.pp)).toBeLessThanOrEqual(999_999);
    const [held, outside] = coinConservation(t.s.db, t.campaignId);
    expect(held).toEqual(outside);
  });

  test("FR-HOLD-12 show and hide: one event; 500 Stores entries send only the window's", () => {
    const t = seedRs();
    const keep = t.hold("Greystone Keep");
    const vault = t.facility(keep, { name: "Vault", state: "built" });
    t.run(
      "rem.save",
      { target: { kind: "party" }, text: "r", strongholdId: keep, facilityId: vault },
      { actor: t.dm },
    );
    dm(t, "party.addItem", { name: "Arrows", qty: 40, notes: "", holder: stores(keep) });
    // 500 entries world → Stores (straight rows, as a long campaign), written while hidden.
    const base = t.s.db.select().from(lootEntry).all().at(-1) as typeof lootEntry.$inferSelect;
    for (let i = 0; i < 500; i++)
      t.s.db
        .insert(lootEntry)
        .values({
          ...base,
          id: `bulk-${String(i).padStart(4, "0")}`,
          seq: lootEntrySeqNext,
          kind: "move",
          fromKind: "world",
          toKind: "stores",
          toStrongholdId: keep,
          text: "",
          gp: 1,
          qty: null,
          itemHidden: false,
          storesHidden: true,
        })
        .run();
    dm(t, "loot.move", { from: stores(keep), to: { kind: "party" }, gp: 5 });
    expect(t.load(t.p1V, STRONGHOLD_TYPE)).toEqual([]);
    const n = t.events.length;
    dm(t, "hold.update", { strongholdId: keep, dmOnly: false });
    const ev = t.since(n);
    expect(ev.map((e) => e.event.type)).toEqual(["StrongholdUpdated"]);
    const changes = ev[0]?.event.changes ?? [];
    const count = (type: string) => changes.filter((c) => c.type === type).length;
    expect(count(LOOT_ENTRY_TYPE)).toBe(100);
    // Review ruling 8: the flip's frame per viewer (window rows only, not all 500).
    const flipBytes = (v: ReturnType<RsSeed["viewer"]>) =>
      JSON.stringify({
        type: "event",
        seq: 1,
        cause: { name: "StrongholdUpdated" },
        changes: t.s.records.filterChanges(changes, v).changes,
      }).length;
    console.log(
      `FR-HOLD-12 500-entry flip: DM ${flipBytes(t.dmV)} B, player ${flipBytes(t.p1V)} B (100 entries)`,
    );
    expect(flipBytes(t.dmV)).toBeLessThanOrEqual(60_000);
    expect([count(STRONGHOLD_TYPE), count(STRONGHOLD_INDEX_TYPE), count(REMINDER_TYPE)]).toEqual([
      1, 1, 1,
    ]);
    expect([count(PARTY_ITEM_TYPE), count(STORES_COIN_TYPE)]).toEqual([1, 1]);
    // Every DB row flipped.
    const flags = t.s.db
      .select({ h: lootEntry.storesHidden })
      .from(lootEntry)
      .where(eq(lootEntry.toStrongholdId, keep))
      .all();
    expect(flags.every((f) => !f.h)).toBe(true);
    // Players gain the record, index, Stores row, stores-coin and reminder in that one event.
    const gained = changes
      .map((c) => t.s.records.filterChange(c, t.p1V))
      .filter((w) => w !== null)
      .map((w) => `${w.type}:${w.op}`);
    for (const k of [
      STRONGHOLD_TYPE,
      STRONGHOLD_INDEX_TYPE,
      REMINDER_TYPE,
      PARTY_ITEM_TYPE,
      STORES_COIN_TYPE,
    ])
      expect(gained).toContain(`${k}:upsert`);
    // Hide again: deletes for players, the window's entries go back to `outside`.
    const m = t.events.length;
    dm(t, "hold.update", { strongholdId: keep, dmOnly: true });
    const hidden = (t.since(m)[0]?.event.changes ?? []).map((c) =>
      t.s.records.filterChange(c, t.p1V),
    );
    const ops = hidden.filter((w) => w !== null).map((w) => `${w.type}:${w.op}`);
    for (const k of [
      STRONGHOLD_TYPE,
      STRONGHOLD_INDEX_TYPE,
      REMINDER_TYPE,
      PARTY_ITEM_TYPE,
      STORES_COIN_TYPE,
    ])
      expect(ops).toContain(`${k}:delete`);
    const lastMove = hidden.find((w) => w?.type === LOOT_ENTRY_TYPE && w.op === "upsert");
    expect((lastMove?.data as { from: unknown } | undefined)?.from).toEqual({ kind: "outside" });
    // Deletes name the rows players held; no upsert carries the now-hidden stronghold's id.
    const upserts = hidden.filter((w) => w?.op === "upsert");
    expect(JSON.stringify(upserts)).not.toContain(keep);
  });

  test("FR-HOLD-37 StrongholdUpdated ≤ 48 KB at caps", () => {
    const t = seedRs();
    const id = t.hold(x(HOLD_NAME_MAX, "Cap Keep "), true);
    dm(t, "hold.update", { strongholdId: id, notes: x(HOLD_NOTES_MAX), defenders: 9_999 });
    const facility = (i: number) => ({
      name: x(HOLD_NAME_MAX, `Facility ${i} `),
      state: "building",
      cost: 999_999,
      buildDays: 999,
      upkeep: 99_999,
      incomeDice: Array(6).fill("5d1000kh5").join("+"),
      effect: x(FACILITY_EFFECT_MAX),
      order: x(FACILITY_ORDER_MAX),
    });
    for (let i = 0; i < FACILITIES_MAX; i++) t.facility(id, facility(i));
    const first = hold(t, id).facilities[0]?.id as string;
    for (let i = 0; i < STAFF_MAX; i++)
      dm(t, "hold.saveStaff", {
        strongholdId: id,
        staff: {
          name: x(HOLD_NAME_MAX, `Staff ${i} `),
          role: x(STAFF_ROLE_MAX),
          wage: 99_999,
          notes: x(STAFF_NOTES_MAX),
          facilityId: first,
        },
      });
    const n = t.events.length;
    t.facility(id, { ...facility(0), id: first, order: x(FACILITY_ORDER_MAX, "New ") });
    const ev = t.since(n)[0]?.event;
    if (!ev) throw new Error("no event");
    const frame = (v: ReturnType<RsSeed["viewer"]>) =>
      JSON.stringify({
        type: "event",
        seq: 123_456,
        cause: { name: ev.type, intentId: x(36) },
        changes: t.s.records.filterChanges(ev.changes, v).changes,
      }).length;
    const sizes = { dm: frame(t.dmV), player: frame(t.p1V) };
    console.log(`FR-HOLD-37 StrongholdUpdated at caps: DM ${sizes.dm} B, player ${sizes.player} B`);
    expect(sizes.dm).toBeLessThanOrEqual(48_000);
    expect(sizes.player).toBeLessThanOrEqual(48_000);
  });
});
