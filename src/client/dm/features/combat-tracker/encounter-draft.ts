// The Encounters editor's draft (FR-CBT-61): the server's encounter + entries as an editable
// draft, and the rule for adopting a new server draft. Adoption keeps the current draft object
// when nothing changed: the editor re-derives the server draft on every render (record arrays
// are fresh per render), so replacing the state each time looped renders (F1: React #185 when
// an import's upsert frames forced sync renders on top). FR-CBT-98 (#252): an entry's side (the
// "Friendly" Switch); one definition's friendly and enemy entries stay apart, as on the server.
import {
  type EncounterEntryRecord,
  type EncounterRecord,
  type HpMode,
  QUANTITY_MAX,
  type Side,
} from "@shared/combat-tracker/schemas";

export interface DraftEntry {
  definitionId: string;
  quantity: number;
  hpMode: HpMode;
  side: Side;
}

export interface Draft {
  name: string;
  partyCharacterIds: string[] | null;
  entries: DraftEntry[];
  /** FR-CBT-62: applied at Start. */
  createTokens: boolean;
  addHidden: boolean;
}

export function draftOf(e: EncounterRecord, entries: readonly EncounterEntryRecord[]): Draft {
  return {
    name: e.name,
    partyCharacterIds: e.partyCharacterIds,
    entries: entries
      .filter((x) => x.encounterId === e.id)
      .sort((a, b) => a.seq - b.seq)
      .map((x) => ({
        definitionId: x.definitionId,
        quantity: x.quantity,
        hpMode: x.hpMode,
        side: x.side,
      })),
    createTokens: e.createTokens,
    addHidden: e.addHidden,
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  if (
    a.name !== b.name ||
    a.createTokens !== b.createTokens ||
    a.addHidden !== b.addHidden ||
    a.entries.length !== b.entries.length
  ) {
    return false;
  }
  const pa = a.partyCharacterIds;
  const pb = b.partyCharacterIds;
  if (pa === null || pb === null ? pa !== pb : pa.join("\n") !== pb.join("\n")) return false;
  return a.entries.every((x, i) => {
    const y = b.entries[i];
    return (
      y !== undefined &&
      x.definitionId === y.definitionId &&
      x.quantity === y.quantity &&
      x.hpMode === y.hpMode &&
      x.side === y.side
    );
  });
}

/** The draft to keep when the server's changes arrive: the current one unless it differs. */
export const adoptServerDraft = (current: Draft, server: Draft): Draft =>
  sameDraft(current, server) ? current : server;

/** An entry's key in the editor: the server merges entries per definition and side. */
export const entryKey = (e: { definitionId: string; side: Side }) => `${e.definitionId}:${e.side}`;

/** FR-CBT-63: a pick adds one to the definition's enemy entry, else a new enemy entry. */
export function addPick(entries: readonly DraftEntry[], definitionId: string): DraftEntry[] {
  const key = entryKey({ definitionId, side: "enemy" });
  return entries.some((e) => entryKey(e) === key)
    ? entries.map((e) =>
        entryKey(e) === key ? { ...e, quantity: Math.min(QUANTITY_MAX, e.quantity + 1) } : e,
      )
    : [...entries, { definitionId, quantity: 1, hpMode: "average", side: "enemy" }];
}

/**
 * FR-CBT-98 / -102 (#252): the "Friendly" Switch. An entry moving onto a side its definition
 * already has there merges into that entry (quantity capped), as the server would on save.
 */
export function setEntrySide(
  entries: readonly DraftEntry[],
  key: string,
  side: Side,
): DraftEntry[] {
  const moved = entries.find((e) => entryKey(e) === key);
  if (!moved || moved.side === side) return [...entries];
  const into = entryKey({ definitionId: moved.definitionId, side });
  if (!entries.some((e) => entryKey(e) === into)) {
    return entries.map((e) => (e === moved ? { ...e, side } : e));
  }
  return entries.flatMap((e) => {
    if (e === moved) return [];
    if (entryKey(e) !== into) return [e];
    return [{ ...e, quantity: Math.min(QUANTITY_MAX, e.quantity + moved.quantity) }];
  });
}
