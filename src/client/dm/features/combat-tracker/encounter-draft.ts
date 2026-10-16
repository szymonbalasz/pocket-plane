// The Encounters editor's draft (FR-CBT-61): the server's encounter + entries as an editable
// draft, and the rule for adopting a new server draft. Adoption keeps the current draft object
// when nothing changed: the editor re-derives the server draft on every render (record arrays
// are fresh per render), so replacing the state each time looped renders (F1: React #185 when
// an import's upsert frames forced sync renders on top).
import type { EncounterEntryRecord, EncounterRecord, HpMode } from "@shared/combat-tracker/schemas";

export interface Draft {
  name: string;
  partyCharacterIds: string[] | null;
  entries: { definitionId: string; quantity: number; hpMode: HpMode }[];
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
      .map((x) => ({ definitionId: x.definitionId, quantity: x.quantity, hpMode: x.hpMode })),
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
      x.hpMode === y.hpMode
    );
  });
}

/** The draft to keep when the server's changes arrive: the current one unless it differs. */
export const adoptServerDraft = (current: Draft, server: Draft): Draft =>
  sameDraft(current, server) ? current : server;
