// LOOT §13 sprint 9 unit (track RS): the `stores` pairing (FR-LOOT-30), player rights (FR-LOOT-33)
// and the pure ledger redaction (FR-LOOT-32, -36).
import { describe, expect, test } from "bun:test";
import { type Endpoint, type LootEntryRecord, LootMoveIntent, playerMayMove } from "./schemas";
import { lootEntryVisibility, partyItemVisibility, redactLootEntry } from "./visibility";

const party: Endpoint = { kind: "party" };
const world: Endpoint = { kind: "world" };
const keep: Endpoint = { kind: "stores", strongholdId: "h1" };
const mira: Endpoint = { kind: "character", characterId: "mira" };
const thorn: Endpoint = { kind: "character", characterId: "thorn" };
const move = (from: Endpoint, to: Endpoint) =>
  LootMoveIntent.safeParse({ from, to, gp: 1 }).success;

describe("LOOT §13 Stores unit", () => {
  test("FR-LOOT-30 stores pairing", () => {
    expect(move(world, keep)).toBe(true);
    expect(move(keep, world)).toBe(true);
    expect(move(keep, party)).toBe(true);
    expect(move(world, party)).toBe(false);
    expect(move(party, world)).toBe(false);
    expect(move(keep, keep)).toBe(false);
    expect(move(keep, { kind: "stores", strongholdId: "h2" })).toBe(true);
    // `outside` is wire-only: never in an intent.
    expect(LootMoveIntent.safeParse({ from: { kind: "outside" }, to: party, gp: 1 }).success).toBe(
      false,
    );
  });

  test("FR-LOOT-33 player Stores rights (the pure matrix)", () => {
    const owns = (e: Endpoint) => e.kind === "character" && e.characterId === "mira";
    expect(playerMayMove(keep, party, owns)).toBe(true);
    expect(playerMayMove(party, keep, owns)).toBe(true);
    expect(playerMayMove(keep, mira, owns)).toBe(true);
    expect(playerMayMove(mira, keep, owns)).toBe(true);
    expect(playerMayMove(keep, thorn, owns)).toBe(false);
    expect(playerMayMove(thorn, keep, owns)).toBe(false);
    expect(playerMayMove(world, keep, owns)).toBe(false);
    expect(playerMayMove(keep, world, owns)).toBe(false);
  });

  const entry = (over: Partial<LootEntryRecord>): LootEntryRecord => ({
    id: "e1",
    campaignId: "c1",
    seq: 9,
    kind: "move",
    from: keep,
    to: party,
    text: "",
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 5,
    pp: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    ...over,
  });
  const player = { role: "player" as const };

  test("FR-LOOT-32 hidden Stores redaction", () => {
    // Hidden Stores → pot: an `outside` end, never `world` (review ruling 3b).
    const hidden = entry({ storesHidden: true });
    expect(lootEntryVisibility(hidden, player)).toBe("redacted");
    const r = redactLootEntry(hidden);
    expect([r.from, r.to]).toEqual([{ kind: "outside" }, party]);
    expect(r).not.toHaveProperty("seq");
    expect(r).not.toHaveProperty("storesHidden");
    // Nothing party-side left → hidden.
    expect(lootEntryVisibility(entry({ from: world, storesHidden: true, to: keep }), player)).toBe(
      "hidden",
    );
    // A visible Stores keeps its end; every player entry drops `seq` (review ruling 7).
    const shown = redactLootEntry(entry({}));
    expect([shown.from, shown.to]).toEqual([keep, party]);
    expect(shown).not.toHaveProperty("seq");
    expect(lootEntryVisibility(entry({ from: world, to: keep }), player)).toBe("redacted");
    expect(lootEntryVisibility(hidden, { role: "dm" })).toBe("full");
  });

  test("FR-LOOT-36 DM-only Stores item rows and their entries are hidden from players", () => {
    expect(lootEntryVisibility(entry({ kind: "item", itemHidden: true }), player)).toBe("hidden");
    const item = {
      id: "i1",
      campaignId: "c1",
      seq: 1,
      name: "Gem",
      qty: 1,
      notes: "",
      strongholdId: "h1",
      createdAt: "",
      updatedAt: "",
    };
    expect(partyItemVisibility(item, player)).toBe("full");
    expect(partyItemVisibility({ ...item, dmOnly: true }, player)).toBe("hidden");
    expect(partyItemVisibility({ ...item, storesHidden: true }, player)).toBe("hidden");
    expect(partyItemVisibility({ ...item, dmOnly: true }, { role: "dm" })).toBe("full");
  });
});
