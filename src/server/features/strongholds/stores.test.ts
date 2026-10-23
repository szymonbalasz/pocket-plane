// LOOT §13 sprint 9 integration (in-memory, track RS0): the Stores holder in the coin and item
// ledgers (FR-LOOT-30–39): `stores-coin` per viewer, hidden Stores redaction, DM-only Stores items,
// player rights, Move to party, per-holder caps and merge, delete, conservation after every command.
import { describe, expect, test } from "bun:test";
import { PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import {
  LOOT_ENTRY_TYPE,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  STORES_COIN_TYPE,
  type StoresCoinRecord,
} from "@shared/party-loot/schemas";
import { byCreated } from "@shared/reminders/schemas";
import { eq } from "drizzle-orm";
import { partyItem } from "../../db/schema";
import type { Actor } from "../../events/types";
import { holderItems } from "../party-board/rows";
import { codeOf, coinConservation, errorOf, itemTotals, type RsSeed, seedRs } from "./testing";

const stores = (strongholdId: string) => ({ kind: "stores" as const, strongholdId });
const party = { kind: "party" as const };
const world = { kind: "world" as const };

/** Greystone (shown: Rope ×2, Arrows ×40, DM-only Gem; 120 gp) and the Tower (hidden: item, 10 gp, 5 gp → pot). */
function rsWorld() {
  const t = seedRs();
  const dmRun = (name: string, input: unknown) => t.run(name, input, { actor: t.dm });
  const keep = t.hold("Greystone Keep", true);
  const tower = t.hold("HOLD-SECRET-TOWER");
  const add = (name: string, qty: number, holder: string, dmOnly?: boolean) =>
    (
      dmRun("party.addItem", {
        name,
        qty,
        notes: "",
        holder: stores(holder),
        ...(dmOnly ? { dmOnly } : {}),
      }) as {
        itemId: string;
      }
    ).itemId;
  const rope = add("Rope", 2, keep);
  const arrows = add("Arrows", 40, keep);
  const gem = add("HOLD-SECRET-GEM", 1, keep, true);
  const towerItem = add("HOLD-SECRET-ITEM", 1, tower);
  dmRun("loot.move", { from: world, to: stores(keep), gp: 120 });
  dmRun("loot.move", { from: world, to: stores(tower), gp: 10 });
  dmRun("loot.move", { from: stores(tower), to: party, gp: 5 });
  return { ...t, dmRun, keep, tower, rope, arrows, gem, towerItem };
}
type World = ReturnType<typeof rsWorld>;

const snap = (w: World, v: ReturnType<RsSeed["viewer"]>, type: string) =>
  (w.snapshot(v)[type] ?? []) as unknown[];
function conserved(w: World) {
  const [held, outside] = coinConservation(w.s.db, w.campaignId);
  expect(held).toEqual(outside);
}
const as = (w: World, actor: Actor, name: string, input: unknown) =>
  codeOf(() => w.run(name, input, { actor }));

describe("LOOT §13 Stores ledger", () => {
  test("FR-LOOT-31 stores-coin per viewer", () => {
    const w = rsWorld();
    const dmRows = snap(w, w.dmV, STORES_COIN_TYPE) as StoresCoinRecord[];
    const byId = Object.fromEntries(dmRows.map((r) => [r.id, r]));
    expect([byId[w.keep]?.gp, byId[w.keep]?.hidden]).toEqual([120, undefined]);
    expect([byId[w.tower]?.gp, byId[w.tower]?.hidden]).toEqual([5, true]);
    for (const v of [w.p1V, w.p2V]) expect(snap(w, v, STORES_COIN_TYPE)).toEqual([byId[w.keep]]);
    // A flip shows / hides the row in the update's event.
    w.dmRun("hold.update", { strongholdId: w.tower, dmOnly: false });
    expect(
      (snap(w, w.p1V, STORES_COIN_TYPE) as StoresCoinRecord[]).map((r) => r.id).sort(),
    ).toEqual([w.keep, w.tower].sort());
    conserved(w);
  });

  test("FR-LOOT-32 hidden Stores redaction", () => {
    const w = rsWorld();
    const entries = snap(w, w.p1V, LOOT_ENTRY_TYPE) as LootEntryRecord[];
    const tower = JSON.stringify([
      entries,
      snap(w, w.p1V, PARTY_ITEM_TYPE),
      w.load(w.p1V, PARTY_ITEM_TYPE),
      snap(w, w.p1V, STORES_COIN_TYPE),
    ]);
    expect(tower).not.toContain(w.tower);
    expect(tower).not.toContain("HOLD-SECRET-ITEM");
    // Tower → pot reads `outside → party`, never `world → party`; `world → Tower` is hidden.
    const toPot = entries.filter((e) => e.to.kind === "party" && e.gp === 5);
    expect(toPot.map((e) => e.from)).toEqual([{ kind: "outside" }]);
    expect(
      entries.some((e) => e.from.kind === "world" && e.to.kind === "party" && e.kind === "move"),
    ).toBe(false);
    expect(
      entries.every((e) => !("seq" in e) && !("storesHidden" in e) && !("itemHidden" in e)),
    ).toBe(true);
    // Players' order by createdAt equals the DM's `seq` order (strictly increasing stamps).
    const dmEntries = snap(w, w.dmV, LOOT_ENTRY_TYPE) as LootEntryRecord[];
    const visible = new Set(entries.map((e) => e.id));
    expect([...entries].sort(byCreated).map((e) => e.id)).toEqual(
      [...dmEntries]
        .sort((a, b) => a.seq - b.seq)
        .map((e) => e.id)
        .filter((id) => visible.has(id)),
    );
    // The DM gets the copy and the real end.
    expect(dmEntries.find((e) => e.id === toPot[0]?.id)).toMatchObject({
      from: stores(w.tower),
      storesHidden: true,
    });
  });

  test("FR-LOOT-36 DM-only Stores item", () => {
    const w = rsWorld();
    const p1Items = w.load(w.p1V, PARTY_ITEM_TYPE) as PartyItemRecord[];
    expect(p1Items.map((i) => i.name).sort()).toEqual(["Arrows", "Rope"]);
    const p1Entries = JSON.stringify(snap(w, w.p1V, LOOT_ENTRY_TYPE));
    expect(p1Entries).not.toContain("HOLD-SECRET-GEM");
    expect(p1Entries).not.toContain(w.gem);
    // A player's Take → not_found; the DM sees it.
    expect(
      as(w, w.p1Actor, "party.moveItem", {
        from: stores(w.keep),
        to: { kind: "character", characterId: w.miraId },
        qty: 1,
        itemId: w.gem,
      }),
    ).toBe("not_found");
    expect(
      (w.load(w.dmV, PARTY_ITEM_TYPE) as PartyItemRecord[]).find((i) => i.id === w.gem)?.dmOnly,
    ).toBe(true);
    // The DM moves it to the party: visible from then on (row and entry).
    const n = w.events.length;
    w.dmRun("party.moveItem", { from: stores(w.keep), to: party, qty: 1, itemId: w.gem });
    const ev = w.since(n)[0]?.event;
    const gained = (ev?.changes ?? [])
      .map((c) => w.s.records.filterChange(c, w.p1V))
      .filter((x) => x !== null);
    expect(gained.map((g) => `${g.type}:${g.op}`)).toEqual(
      expect.arrayContaining([`${PARTY_ITEM_TYPE}:upsert`, `${LOOT_ENTRY_TYPE}:upsert`]),
    );
    expect((w.load(w.p1V, PARTY_ITEM_TYPE) as PartyItemRecord[]).map((i) => i.name)).toContain(
      "HOLD-SECRET-GEM",
    );
    // `dmOnly` only on Stores rows; editing it keeps / sets the flag.
    const partyGem = (w.load(w.dmV, PARTY_ITEM_TYPE) as PartyItemRecord[]).find(
      (i) => i.name === "HOLD-SECRET-GEM",
    ) as PartyItemRecord;
    expect(
      codeOf(() =>
        w.dmRun("party.editItem", {
          itemId: partyGem.id,
          name: partyGem.name,
          qty: 1,
          notes: "",
          dmOnly: true,
        }),
      ),
    ).toBe("invalid");
    w.dmRun("party.editItem", { itemId: w.rope, name: "Rope", qty: 2, notes: "", dmOnly: true });
    expect((w.load(w.p1V, PARTY_ITEM_TYPE) as PartyItemRecord[]).map((i) => i.name)).not.toContain(
      "Rope",
    );
    w.dmRun("party.editItem", { itemId: w.rope, name: "Rope", qty: 3, notes: "" });
    expect(w.s.db.select().from(partyItem).where(eq(partyItem.id, w.rope)).get()?.dmOnly).toBe(
      true,
    );
    conserved(w);
  });

  test("FR-LOOT-33 player Stores rights", () => {
    const w = rsWorld();
    const mira = { kind: "character" as const, characterId: w.miraId };
    const thorn = { kind: "character" as const, characterId: w.thornId };
    const coin = (from: unknown, to: unknown) => as(w, w.p1Actor, "loot.move", { from, to, gp: 1 });
    expect(coin(stores(w.keep), party)).toBe("ok");
    expect(coin(party, stores(w.keep))).toBe("ok");
    expect(coin(stores(w.keep), mira)).toBe("ok");
    expect(coin(mira, stores(w.keep))).toBe("ok");
    expect(coin(stores(w.keep), thorn)).toBe("forbidden");
    expect(coin(thorn, stores(w.keep))).toBe("forbidden");
    expect(coin(stores(w.tower), party)).toBe("not_found");
    expect(coin(stores("nope"), party)).toBe("not_found");
    expect(coin(world, stores(w.keep))).toBe("forbidden");
    // Items alike.
    const item = (from: unknown, to: unknown, more: Record<string, unknown>) =>
      as(w, w.p1Actor, "party.moveItem", { from, to, qty: 1, ...more });
    expect(item(stores(w.keep), mira, { itemId: w.arrows })).toBe("ok");
    expect(item(stores(w.keep), party, { itemId: w.arrows })).toBe("ok");
    expect(item(stores(w.keep), thorn, { itemId: w.arrows })).toBe("forbidden");
    expect(item(stores(w.tower), party, { itemId: w.towerItem })).toBe("not_found");
    // The item must be in the named holder.
    expect(item(stores(w.keep), party, { itemId: w.towerItem })).toBe("not_found");
    conserved(w);
  });

  test("FR-LOOT-34 Move to party from Stores", () => {
    const w = rsWorld();
    const n = w.events.length;
    w.run("loot.move", { from: stores(w.keep), to: party, gp: 50 }, { actor: w.p1Actor });
    const ev = w.since(n)[0]?.event;
    expect(ev?.type).toBe("CoinMoved");
    expect(ev?.changes.map((c) => c.type)).toEqual([
      LOOT_ENTRY_TYPE,
      PARTY_POT_TYPE,
      STORES_COIN_TYPE,
    ]);
    const coin = ev?.changes.find((c) => c.type === STORES_COIN_TYPE);
    const gp = (r: unknown) => (r as StoresCoinRecord | undefined)?.gp;
    expect([gp(coin?.before), gp(coin?.after)]).toEqual([120, 70]);
    // Take Arrows ×20 to Mira (the item path).
    w.run(
      "party.moveItem",
      {
        from: stores(w.keep),
        to: { kind: "character", characterId: w.miraId },
        qty: 20,
        itemId: w.arrows,
      },
      { actor: w.p1Actor },
    );
    expect(w.s.db.select().from(partyItem).where(eq(partyItem.id, w.arrows)).get()?.qty).toBe(20);
    const last = w.events.at(-1)?.event;
    expect(last?.type).toBe("ItemMoved");
    expect(last?.changes.map((c) => c.type)).toEqual(
      expect.arrayContaining([
        PARTY_ITEM_TYPE,
        "creature-sheet",
        LOOT_ENTRY_TYPE,
        STORES_COIN_TYPE,
      ]),
    );
    conserved(w);
  });

  test("FR-LOOT-36 per-holder caps and merge", () => {
    const w = rsWorld();
    // Same key merges within a holder only; a Stores row never merges with a party row.
    w.dmRun("party.addItem", { name: "rope", qty: 3, notes: "", holder: stores(w.keep) });
    w.dmRun("party.addItem", { name: "Rope", qty: 1, notes: "" });
    expect(holderItems(w.s.db, w.campaignId, w.keep).find((i) => i.id === w.rope)?.qty).toBe(5);
    expect(holderItems(w.s.db, w.campaignId, null).filter((i) => i.name === "Rope")).toHaveLength(
      1,
    );
    // A DM-only row is its own key.
    w.dmRun("party.addItem", {
      name: "Arrows",
      qty: 1,
      notes: "",
      holder: stores(w.keep),
      dmOnly: true,
    });
    expect(
      holderItems(w.s.db, w.campaignId, w.keep).filter((i) => i.name === "Arrows"),
    ).toHaveLength(2);
    // Caps per holder: 60 in a Stores while the party has room.
    const have = holderItems(w.s.db, w.campaignId, w.keep).length;
    for (let i = have; i < 60; i++)
      w.dmRun("party.addItem", { name: `Crate ${i}`, qty: 1, notes: "", holder: stores(w.keep) });
    expect(
      errorOf(() =>
        w.dmRun("party.addItem", { name: "One more", qty: 1, notes: "", holder: stores(w.keep) }),
      ),
    ).toEqual({
      code: "conflict",
      message: "Stores are full (60)",
    });
    w.dmRun("party.addItem", { name: "Party crate", qty: 1, notes: "" });
    // A gone Stores; `dmOnly` without a Stores holder.
    expect(
      codeOf(() =>
        w.dmRun("party.addItem", { name: "X", qty: 1, notes: "", holder: stores("nope") }),
      ),
    ).toBe("not_found");
    expect(
      codeOf(() => w.dmRun("party.addItem", { name: "X", qty: 1, notes: "", dmOnly: true })),
    ).toBe("invalid");
    // No `loot-received` for Stores adds (not in the party's hands); the party add notifies.
    const n = w.events.length;
    w.dmRun("party.addItem", { name: "Barrel", qty: 1, notes: "", holder: stores(w.tower) });
    expect(w.since(n).map((e) => e.event.type)).toEqual(["PartyItemAdded"]);
    // Remove from a Stores writes `stores → world` (hidden for a DM-only row).
    w.dmRun("party.removeItem", { itemId: w.gem, qty: 1 });
    const removed = w.events.at(-1)?.event.changes.find((c) => c.type === LOOT_ENTRY_TYPE)
      ?.after as LootEntryRecord;
    expect([removed.from, removed.to, removed.itemHidden]).toEqual([stores(w.keep), world, true]);
    conserved(w);
  });

  test("FR-LOOT-38 delete moves Stores", () => {
    const w = rsWorld();
    const itemsBefore = itemTotals(w.s.db, w.campaignId);
    w.dmRun("loot.move", { from: stores(w.keep), to: world, sp: 7 });
    w.dmRun("hold.delete", { strongholdId: w.keep });
    // Items conserved across holders; everything now in the party.
    expect(itemTotals(w.s.db, w.campaignId)).toEqual(itemsBefore);
    expect(holderItems(w.s.db, w.campaignId, null).map((i) => i.name)).toEqual(
      expect.arrayContaining(["Rope", "Arrows", "HOLD-SECRET-GEM"]),
    );
    const dmEntries = snap(w, w.dmV, LOOT_ENTRY_TYPE) as LootEntryRecord[];
    // Item rows name the item (FR-PARTY-25); the coin moves read "Stronghold deleted"; a negative
    // coin (−7 sp) is paid by the pot (Party pot → Stores).
    expect(
      dmEntries.slice(-5).map((e) => [e.kind, e.from.kind, e.to.kind, e.text, e.gp, e.sp]),
    ).toEqual([
      ["item", "stores", "party", "Rope", 0, 0],
      ["item", "stores", "party", "Arrows", 0, 0],
      ["item", "stores", "party", "HOLD-SECRET-GEM", 0, 0],
      ["move", "stores", "party", "Stronghold deleted", 120, 0],
      ["move", "party", "stores", "Stronghold deleted", 0, 7],
    ]);
    // The old entries keep their Stores end (rendered "Stores (removed)").
    expect(dmEntries.some((e) => e.from.kind === "world" && e.to.kind === "stores")).toBe(true);
    conserved(w);
  });

  test("FR-LOOT-39 conservation", () => {
    const w = rsWorld();
    conserved(w);
    const mira = { kind: "character" as const, characterId: w.miraId };
    const steps: [Actor, string, unknown][] = [
      [w.dm, "loot.move", { from: stores(w.keep), to: stores(w.tower), gp: 30 }],
      [w.p1Actor, "loot.move", { from: stores(w.keep), to: mira, gp: 12, sp: 3 }],
      [w.p1Actor, "loot.move", { from: mira, to: stores(w.keep), cp: 9 }],
      [w.dm, "loot.add", { text: "Loot", gp: 40 }],
      [w.dm, "loot.move", { from: stores(w.tower), to: world, gp: 2 }],
      [w.dm, "hold.update", { strongholdId: w.tower, dmOnly: false }],
      [w.dm, "loot.move", { from: party, to: stores(w.tower), pp: 1 }],
      [w.dm, "hold.delete", { strongholdId: w.tower }],
      [w.dm, "hold.delete", { strongholdId: w.keep }],
    ];
    const items = itemTotals(w.s.db, w.campaignId);
    for (const [actor, name, input] of steps) {
      w.run(name, input, { actor });
      conserved(w);
    }
    expect(itemTotals(w.s.db, w.campaignId)).toEqual(items);
  });
});
