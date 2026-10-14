// Encounter party in the editor (FR-CBT-02 as amended by FR-CHARX-11, OQ-CBT-46): `null` = the
// whole party = every character that isn't a draft; an explicit list may hold drafts. Pure; the
// server resolves the same rule at Start (`partyOf`).

/** The characters a `partyCharacterIds` value means, in `characters` order. */
export function partyMembers<C extends { id: string }>(
  characters: readonly C[],
  ids: readonly string[] | null,
  drafts: ReadonlySet<string>,
): C[] {
  return ids === null
    ? characters.filter((c) => !drafts.has(c.id))
    : characters.filter((c) => ids.includes(c.id));
}

/**
 * One party checkbox flipped. The result collapses to `null` iff it is exactly the whole party
 * (every non-draft, no draft), so a later character joins automatically.
 */
export function toggleParty(
  characters: readonly { id: string }[],
  ids: readonly string[] | null,
  drafts: ReadonlySet<string>,
  id: string,
  on: boolean,
): string[] | null {
  const cur = partyMembers(characters, ids, drafts).map((c) => c.id);
  const next = on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id);
  const whole = characters.filter((c) => !drafts.has(c.id)).map((c) => c.id);
  const isWhole = next.length === whole.length && whole.every((x) => next.includes(x));
  return isWhole ? null : next;
}
