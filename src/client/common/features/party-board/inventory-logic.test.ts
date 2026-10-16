// PARTY §13 client unit tests (Inventory tab, FR-PARTY-24): row order, Take / Give… options per
// role (FR-PARTY-23 mirrored), payloads and locks (FR-PARTY-18–22 mirrored), lost-intent toasts.
import { describe, expect, test } from "bun:test";
import type { CreatureSheetRecord, ItemRow } from "@shared/character-sheet/sheet";
import { ITEM_QTY_MAX, type PartyItemRecord } from "@shared/party-board/schemas";
import { IntentRejected } from "../../sync/connection";
import { submitEnabled } from "../party-loot/logic";
import {
  addPayload,
  canTakeOrGive,
  characterKey,
  EMPTY_ITEM,
  editDraftOf,
  editPayload,
  endOf,
  givePayload,
  giveSources,
  giveTargets,
  type InvCharacter,
  LOST_ITEM_MOVE,
  PARTY_KEY,
  qtyOf,
  removePayload,
  sortItems,
  takePayload,
  takeTargets,
} from "./inventory-logic";
import { intentFailure } from "./logic";

const mira: InvCharacter = { id: "mira", name: "Mira", ownerPlayerId: "p1" };
const thorn: InvCharacter = { id: "thorn", name: "Thorn", ownerPlayerId: "p2" };
const brin: InvCharacter = { id: "brin", name: "Brin", ownerPlayerId: "p1" };
const chars = [thorn, mira, brin];
const DM = { role: "dm" as const, playerId: null };
const P1 = { role: "player" as const, playerId: "p1" };
const P2 = { role: "player" as const, playerId: "p2" };
const P3 = { role: "player" as const, playerId: "p3" };

const item = (id: string, name: string, qty = 1, seq = 1): PartyItemRecord => ({
  id,
  campaignId: "c",
  seq,
  name,
  qty,
  notes: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const row = (id: string, name: string, qty: number, equipped = false): ItemRow => ({
  id,
  name,
  qty,
  equipped,
  notes: "",
});
const sheetWith = (items: ItemRow[]) => ({ items }) as unknown as CreatureSheetRecord;

describe("FR-PARTY-24 Inventory tab", () => {
  test("FR-PARTY-24 rows sorted by name, then creation order", () => {
    const rows = [
      item("t", "Torch", 8, 2),
      item("p", "Potion of healing", 2, 1),
      item("r", "Rope", 1, 3),
    ];
    expect(sortItems(rows).map((r) => r.id)).toEqual(["p", "r", "t"]);
    expect(
      sortItems([item("b", "Torch", 1, 5), item("a", "Torch", 1, 4)]).map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  test("FR-PARTY-24 FR-PARTY-23 Take targets: a player's own characters (picker if > 1); the DM any; no character → hidden", () => {
    expect(takeTargets(chars, P1).map((c) => c.name)).toEqual(["Brin", "Mira"]);
    expect(takeTargets(chars, P2).map((c) => c.name)).toEqual(["Thorn"]);
    expect(takeTargets(chars, DM).map((c) => c.name)).toEqual(["Brin", "Mira", "Thorn"]);
    expect(canTakeOrGive(chars, P3)).toBe(false);
    expect(canTakeOrGive(chars, P2)).toBe(true);
    expect(canTakeOrGive([], DM)).toBe(false);
  });

  test("FR-PARTY-24 FR-PARTY-23 Give… sources: only the viewer's characters' sheet items (qty ≥ 1); targets Party + other characters", () => {
    const sheets = {
      mira: sheetWith([row("bolts", "Bolts", 20), row("empty", "Flask", 0)]),
      thorn: sheetWith([row("arrows", "Arrows", 10, true)]),
    };
    expect(giveSources(chars, sheets, P2).map((s) => [s.character.name, s.row.name])).toEqual([
      ["Thorn", "Arrows"],
    ]);
    expect(giveSources(chars, sheets, P1).map((s) => s.row.id)).toEqual(["bolts"]);
    expect(giveSources(chars, sheets, DM).map((s) => s.row.id)).toEqual(["bolts", "arrows"]);
    expect(giveSources(chars, sheets, P3)).toEqual([]);
    expect(giveTargets(chars, P1, "mira").map((o) => o.label)).toEqual(["Party", "Brin", "Thorn"]);
    expect(giveTargets(chars, DM, "thorn").map((o) => o.key)).toEqual([
      PARTY_KEY,
      characterKey("brin"),
      characterKey("mira"),
    ]);
    expect(endOf(PARTY_KEY)).toEqual({ kind: "party" });
    expect(endOf(characterKey("mira"))).toEqual({ kind: "character", characterId: "mira" });
    expect(endOf("world")).toBeNull();
  });

  test("FR-PARTY-22 qty: whole number 1–9 999 and ≤ held ('Only ‹n› left')", () => {
    expect(qtyOf("2", 2)).toEqual({ ok: true, value: 2 });
    expect(qtyOf("3", 2)).toEqual({ ok: false, message: "Only 2 left" });
    for (const bad of ["0", "-1", "1.5", "", "x", String(ITEM_QTY_MAX + 1)])
      expect(qtyOf(bad, ITEM_QTY_MAX + 5).ok).toBe(false);
  });

  test("FR-PARTY-22 Take and Give… payloads mirror party.moveItem", () => {
    const potion = item("pot", "Potion of healing", 2);
    expect(takePayload(potion, "mira", "1")).toEqual({
      ok: true,
      value: {
        from: { kind: "party" },
        to: { kind: "character", characterId: "mira" },
        qty: 1,
        itemId: "pot",
      },
    });
    expect(takePayload(potion, "", "1").ok).toBe(false);
    expect(takePayload(potion, "mira", "3")).toEqual({ ok: false, message: "Only 2 left" });
    const source = { character: mira, row: row("bolts", "Bolts", 20) };
    expect(givePayload(source, PARTY_KEY, "5")).toEqual({
      ok: true,
      value: {
        from: { kind: "character", characterId: "mira" },
        to: { kind: "party" },
        qty: 5,
        rowId: "bolts",
      },
    });
    expect(givePayload(source, characterKey("thorn"), "5").ok).toBe(true);
    // from = to is the server's `invalid`; mirrored.
    expect(givePayload(source, characterKey("mira"), "5").ok).toBe(false);
    expect(givePayload(undefined, PARTY_KEY, "1")).toEqual({ ok: false, message: "Pick an item" });
  });

  test("FR-PARTY-18 FR-PARTY-20 FR-PARTY-21 DM Add / Edit / Remove payloads; Edit unchanged after cleaning", () => {
    expect(addPayload(EMPTY_ITEM).ok).toBe(false);
    expect(addPayload({ name: "Healer's kit", qty: "1", notes: "" })).toEqual({
      ok: true,
      value: { name: "Healer's kit", qty: 1, notes: "" },
    });
    expect(addPayload({ name: "x".repeat(61), qty: "1", notes: "" }).ok).toBe(false);
    expect(addPayload({ name: "Rope", qty: "1", notes: "n".repeat(121) }).ok).toBe(false);
    expect(addPayload({ name: "Rope", qty: "10000", notes: "" }).ok).toBe(false);
    const torch = { ...item("t", "Torch", 8), notes: "" };
    expect(editPayload(torch, editDraftOf(torch))).toMatchObject({ ok: true, unchanged: true });
    expect(editPayload(torch, { name: " Torch ", qty: "8", notes: "" }).unchanged).toBe(true);
    expect(editPayload(torch, { name: "Torch", qty: "9", notes: "" })).toMatchObject({
      ok: true,
      unchanged: false,
      value: { itemId: "t", name: "Torch", qty: 9, notes: "" },
    });
    expect(removePayload(torch, "8")).toEqual({ ok: true, value: { itemId: "t", qty: 8 } });
    expect(removePayload(torch, "9")).toEqual({ ok: false, message: "Only 8 left" });
  });

  test("FR-PARTY-24 locks as FR-LOOT-16: invalid / not live / in flight; reject → inline, lost → toast", () => {
    expect(submitEnabled({ valid: true, live: true, busy: false })).toBe(true);
    expect(submitEnabled({ valid: false, live: true, busy: false })).toBe(false);
    expect(submitEnabled({ valid: true, live: false, busy: false })).toBe(false);
    expect(submitEnabled({ valid: true, live: true, busy: true })).toBe(false);
    expect(intentFailure(new IntentRejected("conflict", "Only 1 left"), LOST_ITEM_MOVE)).toEqual({
      kind: "inline",
      message: "Only 1 left",
    });
    expect(intentFailure(new IntentRejected("disconnected", "x"), LOST_ITEM_MOVE)).toEqual({
      kind: "toast",
      message: LOST_ITEM_MOVE,
    });
  });
});
