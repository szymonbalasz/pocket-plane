// Domain events of party-board (PARTY §9). All logged; none undoable or transient. Payloads reach
// clients only as filtered record changes (FR-PARTY-07): the visibility fn decides per viewer.
import { ItemEnd, SharedWith } from "@shared/party-board/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);
const ItemValues = z.strictObject({ name: z.string(), qty: z.int(), notes: z.string() });

/** `party.createHandout` (FR-PARTY-03): changes = `handout`, `handout-body` (before null). */
export const HandoutCreated = defineEvent({
  type: "HandoutCreated",
  payload: z.strictObject({ handoutId: Id }),
  logged: true,
  undoable: false,
});

/** `party.updateHandout` (FR-PARTY-04): changes = `handout`; `handout-body` iff the body changed. */
export const HandoutUpdated = defineEvent({
  type: "HandoutUpdated",
  payload: z.strictObject({ handoutId: Id, rev: z.int().min(1) }),
  logged: true,
  undoable: false,
});

/**
 * `party.shareHandout` (FR-PARTY-05; share and unshare): changes = `handout`, `handout-body`.
 * Gainers get upserts, losers deletes, everyone else nothing (record-change rule).
 */
export const HandoutShared = defineEvent({
  type: "HandoutShared",
  payload: z.strictObject({ handoutId: Id, before: SharedWith, after: SharedWith }),
  logged: true,
  undoable: false,
});

/** `party.deleteHandout` (FR-PARTY-08): changes = `handout`, `handout-body` → null. */
export const HandoutDeleted = defineEvent({
  type: "HandoutDeleted",
  payload: z.strictObject({ handoutId: Id }),
  logged: true,
  undoable: false,
});

/** `party.addItem` (FR-PARTY-19): changes = `party-item`, `loot-entry` (kind `item`). */
export const PartyItemAdded = defineEvent({
  type: "PartyItemAdded",
  payload: z.strictObject({
    itemId: Id,
    entryId: Id,
    name: z.string(),
    qty: z.int(),
    notes: z.string(),
  }),
  logged: true,
  undoable: false,
});

/** `party.editItem` (FR-PARTY-20): changes = `party-item`; no log row. */
export const PartyItemEdited = defineEvent({
  type: "PartyItemEdited",
  payload: z.strictObject({ itemId: Id, before: ItemValues, after: ItemValues }),
  logged: true,
  undoable: false,
});

/** `party.removeItem` (FR-PARTY-21): changes = `party-item` (delete at 0), `loot-entry`. */
export const PartyItemRemoved = defineEvent({
  type: "PartyItemRemoved",
  payload: z.strictObject({ itemId: Id, entryId: Id, name: z.string(), qty: z.int() }),
  logged: true,
  undoable: false,
});

/** `party.moveItem` (FR-PARTY-22): changes = `party-item`, each changed `creature-sheet`, `loot-entry`. */
export const ItemMoved = defineEvent({
  type: "ItemMoved",
  payload: z.strictObject({
    entryId: Id,
    from: ItemEnd,
    to: ItemEnd,
    name: z.string(),
    qty: z.int(),
  }),
  logged: true,
  undoable: false,
});

/**
 * `party.presentHandout` (FR-PARTY-32) and `party.shareHandout {present: true}` (FR-PARTY-33):
 * changes = `handout-present`, per target their old row deleted (any handout) and a new row
 * upserted. Each target receives only their own rows (FR-PARTY-31).
 */
export const HandoutPresented = defineEvent({
  type: "HandoutPresented",
  payload: z.strictObject({ handoutId: Id, playerIds: z.array(Id).min(1) }),
  logged: true,
  undoable: false,
});

/** `party.closePresent` (FR-PARTY-34): changes = `handout-present` → null for each closed row. */
export const HandoutPresentClosed = defineEvent({
  type: "HandoutPresentClosed",
  payload: z.strictObject({
    handoutId: Id,
    playerIds: z.array(Id).min(1),
    by: z.enum(["dm", "player"]),
  }),
  logged: true,
  undoable: false,
});
