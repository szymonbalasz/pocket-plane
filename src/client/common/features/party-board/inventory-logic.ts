// Pure client rules of the Inventory tab (FR-PARTY-24): row order, Take / Give… options per role
// (FR-PARTY-23 mirrored), form drafts → intent payloads (FR-PARTY-18–22 mirrored with the shared
// zod schemas), and the lost-intent texts. No React. *(S9)* A holder: the party inventory lists
// rows without `strongholdId` only (FR-PARTY-77); a Stores (the Stronghold window's Stores tab,
// FR-HOLD-28, FR-LOOT-34, -36, -37) lists its own rows, Take / Move… goes to the Party or a
// character, Give… brings a sheet item into it, and the DM's rows carry "DM only".
import type { CreatureSheetRecord, ItemRow } from "@shared/character-sheet/sheet";
import { canMoveItem } from "@shared/party-board/items";
import {
  AddItemIntent,
  EditItemIntent,
  ITEM_QTY_MAX,
  type ItemEnd,
  MoveItemIntent,
  onlyLeftMessage,
  type PartyItemRecord,
  RemoveItemIntent,
  type StoresHolder,
} from "@shared/party-board/schemas";
import type { z } from "zod";
import type { Parsed } from "./logic";

/** The item intents (PARTY §9). */
export const ITEM_INTENTS = {
  addItem: "party.addItem",
  editItem: "party.editItem",
  removeItem: "party.removeItem",
  moveItem: "party.moveItem",
} as const;

export const INVENTORY_EMPTY = "Party inventory is empty";
export const LOST_ITEM_ADD = "Connection lost — check the party inventory before adding again";
export const LOST_ITEM_EDIT = "Connection lost — check the party inventory before saving again";
export const LOST_ITEM_REMOVE = "Connection lost — check the party inventory before removing again";
export const LOST_ITEM_MOVE = "Connection lost — check the party inventory before moving again";

/** *(S9)* Whose rows a list shows: the party inventory (`null`) or one Stores. */
export type ItemHolder = StoresHolder | null;

/** *(S9)* The holder's texts (FR-PARTY-24; the Stores tab, HOLD §7 "Stores are empty"). */
export interface HolderCopy {
  empty: string;
  removeFrom: string;
  lostAdd: string;
  lostEdit: string;
  lostRemove: string;
  lostMove: string;
}

const lost = (what: string, verb: string) => `Connection lost — check ${what} before ${verb} again`;

export function holderCopy(holder: ItemHolder): HolderCopy {
  if (holder === null)
    return {
      empty: INVENTORY_EMPTY,
      removeFrom: "Remove from the party",
      lostAdd: LOST_ITEM_ADD,
      lostEdit: LOST_ITEM_EDIT,
      lostRemove: LOST_ITEM_REMOVE,
      lostMove: LOST_ITEM_MOVE,
    };
  return {
    empty: STORES_EMPTY,
    removeFrom: "Remove from the Stores",
    lostAdd: lost("the Stores", "adding"),
    lostEdit: lost("the Stores", "saving"),
    lostRemove: lost("the Stores", "removing"),
    lostMove: lost("the Stores", "moving"),
  };
}

export const STORES_EMPTY = "Stores are empty";

/**
 * *(S9)* FR-PARTY-77: the party inventory lists `party-item` rows without `strongholdId`; a Stores
 * lists its own (FR-LOOT-36). One lazy load brings both.
 */
export function holderRows<T extends Pick<PartyItemRecord, "strongholdId">>(
  rows: readonly T[],
  holder: ItemHolder,
): T[] {
  return rows.filter((r) =>
    holder === null ? r.strongholdId === undefined : r.strongholdId === holder.strongholdId,
  );
}

/** The holder as a move end. */
export const holderEnd = (holder: ItemHolder): ItemEnd => holder ?? { kind: "party" };

/** A character as the tab needs it (full or redacted `entity` record). */
export interface InvCharacter {
  id: string;
  name: string;
  ownerPlayerId: string;
}

export interface InvViewer {
  role: "dm" | "player";
  playerId: string | null;
}

const byName = <T extends { name: string; id: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);

/** FR-PARTY-24: rows sorted by name (then creation order). */
export function sortItems<T extends Pick<PartyItemRecord, "name" | "seq">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.seq - b.seq);
}

/**
 * The characters the viewer moves for: a player's own (by name); the DM's = every character
 * ("Move to any character", FR-PARTY-24).
 */
export function ownCharacters(chars: readonly InvCharacter[], v: InvViewer): InvCharacter[] {
  const mine =
    v.role === "dm"
      ? chars
      : chars.filter((c) => v.playerId !== null && c.ownerPlayerId === v.playerId);
  return [...mine].sort(byName);
}

/** FR-PARTY-24: a player with no character gets no Take / Give. */
export const canTakeOrGive = (chars: readonly InvCharacter[], v: InvViewer) =>
  ownCharacters(chars, v).length > 0;

/** Take targets (party → character), FR-PARTY-23: a player's own; the DM's any. */
export const takeTargets = ownCharacters;

/** One Give… source: a sheet `items` row (qty ≥ 1) of one of the viewer's characters. */
export interface GiveSource {
  character: InvCharacter;
  row: ItemRow;
}

/** Give… sources: the viewer's characters' sheet items (character by name, sheet order). */
export function giveSources(
  chars: readonly InvCharacter[],
  sheets: Readonly<Record<string, CreatureSheetRecord | undefined>>,
  v: InvViewer,
): GiveSource[] {
  return ownCharacters(chars, v).flatMap((character) =>
    (sheets[character.id]?.items ?? [])
      .filter((row) => row.qty >= 1)
      .map((row) => ({ character, row })),
  );
}

export const PARTY_KEY = "party";
export const characterKey = (id: string) => `character:${id}`;
/** *(S9)* A Stores as an item target. */
export const storesItemKey = (strongholdId: string) => `stores:${strongholdId}`;

export function endOf(key: string): ItemEnd | null {
  if (key === PARTY_KEY) return { kind: "party" };
  if (key.startsWith("character:")) return { kind: "character", characterId: key.slice(10) };
  if (key.startsWith("stores:")) return { kind: "stores", strongholdId: key.slice(7) };
  return null;
}

export interface TargetOption {
  key: string;
  label: string;
}

/** Give… targets from `sourceCharacterId`: Party, then every other character by name. */
export function giveTargets(
  chars: readonly InvCharacter[],
  v: InvViewer,
  sourceCharacterId: string,
): TargetOption[] {
  const from: ItemEnd = { kind: "character", characterId: sourceCharacterId };
  const own = ownCharacters(chars, v).map((c) => c.id);
  const others = [...chars]
    .filter((c) => c.id !== sourceCharacterId)
    .sort(byName)
    .map((c) => ({ key: characterKey(c.id), label: c.name }));
  return [{ key: PARTY_KEY, label: "Party" }, ...others].filter((o) =>
    canMoveItem(v.role, from, endOf(o.key) as ItemEnd, own),
  );
}

/**
 * *(S9)* Take / Move… targets of a holder's row: the party's → the viewer's characters (any for
 * the DM); a Stores' → Party, then those characters (FR-LOOT-33: Stores → party, own character).
 */
export function holderTakeTargets(
  chars: readonly InvCharacter[],
  v: InvViewer,
  holder: ItemHolder,
): TargetOption[] {
  const own = takeTargets(chars, v).map((c) => ({ key: characterKey(c.id), label: c.name }));
  return holder === null ? own : [{ key: PARTY_KEY, label: "Party" }, ...own];
}

/** *(S9)* Give… targets: into a Stores only that Stores; else FR-PARTY-24's (`giveTargets`). */
export function holderGiveTargets(
  chars: readonly InvCharacter[],
  v: InvViewer,
  sourceCharacterId: string,
  holder: ItemHolder,
  storesLabel: string,
): TargetOption[] {
  if (holder === null) return giveTargets(chars, v, sourceCharacterId);
  return [{ key: storesItemKey(holder.strongholdId), label: storesLabel }];
}

/** A qty Input: whole number 1–9 999 and ≤ `held`, else why not. */
export function qtyOf(draft: string, held: number): Parsed<number> {
  const t = draft.trim();
  if (!/^\d+$/.test(t)) return { ok: false, message: "Quantity: a whole number ≥ 1" };
  const n = Number(t);
  if (n < 1 || n > ITEM_QTY_MAX) return { ok: false, message: `Quantity: 1–${ITEM_QTY_MAX}` };
  if (n > held) return { ok: false, message: onlyLeftMessage(held) };
  return { ok: true, value: n };
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid";

function parsed<T>(schema: z.ZodType, payload: T): Parsed<T> {
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, value: payload } : { ok: false, message: firstIssue(r.error) };
}

/** Take: party row → one of the viewer's characters. */
export function takePayload(
  item: Pick<PartyItemRecord, "id" | "qty">,
  characterId: string,
  qtyDraft: string,
): Parsed<MoveItemIntent> {
  if (!characterId) return { ok: false, message: "Pick a character" };
  return holderTakePayload(item, null, characterKey(characterId), qtyDraft);
}

/** *(S9)* Take / Move… from a holder's row to a target key (`holderTakeTargets`). */
export function holderTakePayload(
  item: Pick<PartyItemRecord, "id" | "qty">,
  holder: ItemHolder,
  targetKey: string,
  qtyDraft: string,
): Parsed<MoveItemIntent> {
  const to = endOf(targetKey);
  if (!to) return { ok: false, message: "Pick where it goes" };
  const q = qtyOf(qtyDraft, item.qty);
  if (!q.ok) return q;
  return parsed(MoveItemIntent, {
    from: holderEnd(holder),
    to,
    qty: q.value,
    itemId: item.id,
  });
}

/** Give…: a sheet row → Party or another character. */
export function givePayload(
  source: GiveSource | undefined,
  targetKey: string,
  qtyDraft: string,
): Parsed<MoveItemIntent> {
  if (!source) return { ok: false, message: "Pick an item" };
  const to = endOf(targetKey);
  if (!to) return { ok: false, message: "Pick where it goes" };
  const q = qtyOf(qtyDraft, source.row.qty);
  if (!q.ok) return q;
  return parsed(MoveItemIntent, {
    from: { kind: "character", characterId: source.character.id },
    to,
    qty: q.value,
    rowId: source.row.id,
  });
}

export interface ItemDraft {
  name: string;
  qty: string;
  notes: string;
  /** *(S9)* Stores rows only (OQ-HOLD-12 A, FR-LOOT-36). */
  dmOnly?: boolean;
}
export const EMPTY_ITEM: ItemDraft = { name: "", qty: "1", notes: "" };

function itemFields(d: ItemDraft): Parsed<{ name: string; qty: number; notes: string }> {
  const q = qtyOf(d.qty, ITEM_QTY_MAX);
  if (!q.ok) return q;
  const payload = { name: d.name, qty: q.value, notes: d.notes };
  const r = AddItemIntent.safeParse(payload);
  return r.success ? { ok: true, value: payload } : { ok: false, message: firstIssue(r.error) };
}

/**
 * FR-PARTY-24 DM Add form (FR-PARTY-18 mirrored). *(S9)* Into a Stores: `holder` and `dmOnly`
 * (DM Add to Stores, FR-LOOT-37).
 */
export function addPayload(d: ItemDraft, holder: ItemHolder = null): Parsed<AddItemIntent> {
  const f = itemFields(d);
  if (!f.ok || holder === null) return f;
  return parsed(AddItemIntent, { ...f.value, holder, dmOnly: d.dmOnly === true });
}

export const editDraftOf = (
  i: Pick<PartyItemRecord, "name" | "qty" | "notes" | "strongholdId" | "dmOnly">,
): ItemDraft => ({
  name: i.name,
  qty: String(i.qty),
  notes: i.notes,
  ...(i.strongholdId !== undefined ? { dmOnly: i.dmOnly === true } : {}),
});

/**
 * FR-PARTY-20 Edit: the payload, and `unchanged` when it equals the row after cleaning. *(S9)*
 * A Stores row also sends `dmOnly` (FR-LOOT-37; a party row never does).
 */
export function editPayload(
  item: Pick<PartyItemRecord, "id" | "name" | "qty" | "notes" | "strongholdId" | "dmOnly">,
  d: ItemDraft,
): Parsed<EditItemIntent> & { unchanged: boolean } {
  const f = itemFields(d);
  if (!f.ok) return { ...f, unchanged: false };
  const stores = item.strongholdId !== undefined;
  const dmOnly = d.dmOnly === true;
  const clean = EditItemIntent.parse({ itemId: item.id, ...f.value });
  const unchanged =
    clean.name === item.name &&
    clean.qty === item.qty &&
    clean.notes === item.notes &&
    (!stores || dmOnly === (item.dmOnly === true));
  const value = stores ? { itemId: item.id, ...f.value, dmOnly } : { itemId: item.id, ...f.value };
  return { ok: true, value, unchanged };
}

/** FR-PARTY-21 Remove (qty ≤ held). */
export function removePayload(
  item: Pick<PartyItemRecord, "id" | "qty">,
  qtyDraft: string,
): Parsed<RemoveItemIntent> {
  const q = qtyOf(qtyDraft, item.qty);
  if (!q.ok) return q;
  return parsed(RemoveItemIntent, { itemId: item.id, qty: q.value });
}
