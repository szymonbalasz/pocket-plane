// party-board events (PARTY §9) and party-loot's sprint-3 additions (`CoinSplit`, kind `item`):
// registered once, logged, not undoable; strict payloads.
import { describe, expect, test } from "bun:test";
import { domainEvents } from "./index";
import {
  HandoutCreated,
  HandoutDeleted,
  HandoutShared,
  HandoutUpdated,
  ItemMoved,
  PartyItemAdded,
  PartyItemEdited,
  PartyItemRemoved,
} from "./party-board";
import { CoinSplit, LOOT_ENTRY_KINDS, LootEntryKind } from "./party-loot";

const PARTY_EVENTS = [
  "HandoutCreated",
  "HandoutUpdated",
  "HandoutShared",
  "HandoutDeleted",
  "PartyItemAdded",
  "PartyItemEdited",
  "PartyItemRemoved",
  "ItemMoved",
  "CoinSplit",
];

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

describe("PARTY domain events (§9)", () => {
  test("PARTY §9 all 9 events registered once, logged, none undoable", () => {
    const defs = domainEvents.filter((e) => PARTY_EVENTS.includes(e.type));
    expect(defs.map((e) => e.type).sort()).toEqual([...PARTY_EVENTS].sort());
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-PARTY-03/04/05/08 handout events round-trip; strict; sharedWith validated", () => {
    roundTrip(HandoutCreated.payload, { handoutId: "h1" });
    roundTrip(HandoutUpdated.payload, { handoutId: "h1", rev: 2 });
    roundTrip(HandoutDeleted.payload, { handoutId: "h1" });
    roundTrip(HandoutShared.payload, {
      handoutId: "h1",
      before: { mode: "none", playerIds: [] },
      after: { mode: "players", playerIds: ["p1"] },
    });
    expect(HandoutCreated.payload.safeParse({ handoutId: "h1", title: "x" }).success).toBe(false);
    expect(
      HandoutShared.payload.safeParse({
        handoutId: "h1",
        before: { mode: "none", playerIds: [] },
        after: { mode: "players", playerIds: [] },
      }).success,
    ).toBe(false);
  });

  test("FR-PARTY-19/20/21/22 item events round-trip; ends strict", () => {
    roundTrip(PartyItemAdded.payload, {
      itemId: "i1",
      entryId: "e1",
      name: "Torch",
      qty: 10,
      notes: "",
    });
    roundTrip(PartyItemEdited.payload, {
      itemId: "i1",
      before: { name: "Torch", qty: 10, notes: "" },
      after: { name: "Torch", qty: 8, notes: "" },
    });
    roundTrip(PartyItemRemoved.payload, { itemId: "i1", entryId: "e2", name: "Torch", qty: 2 });
    roundTrip(ItemMoved.payload, {
      entryId: "e3",
      from: { kind: "party" },
      to: { kind: "character", characterId: "c1" },
      name: "Torch",
      qty: 2,
    });
    expect(
      ItemMoved.payload.safeParse({
        entryId: "e3",
        from: { kind: "world" },
        to: { kind: "party" },
        name: "Torch",
        qty: 2,
      }).success,
    ).toBe(false);
  });

  test("FR-PARTY-26 CoinSplit round-trips; FR-PARTY-25 loot-entry kind item", () => {
    roundTrip(CoinSplit.payload, {
      entryIds: ["e1", "e2"],
      characterIds: ["c1", "c2"],
      shares: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 2 },
    });
    expect(
      CoinSplit.payload.safeParse({ entryIds: [], characterIds: ["c1"], shares: {} }).success,
    ).toBe(false);
    expect(LOOT_ENTRY_KINDS).toEqual(["loot", "move", "item"]);
    expect(LootEntryKind.safeParse("item").success).toBe(true);
  });
});
