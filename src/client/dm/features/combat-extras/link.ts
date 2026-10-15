// FR-CBTX-45 (N6, N6.1), DM client (pure; bun test): which token-less combatants a token can be
// linked to (token menu "Link to ‹Goblin 6›"), whether it can be unlinked, and the attack popup's
// hint next to "N selected not in combat".

interface LinkCombatant {
  id: string;
  encounterId: string;
  entityId?: string;
  tokenId: string | null;
  name: string;
  active?: boolean;
  removed: boolean;
}
interface LinkToken {
  id: string;
  sceneId: string;
  definitionId: string;
}
interface LinkEncounter {
  id: string;
  sceneId?: string | null;
}

const activeOf = (c: LinkCombatant, enc: LinkEncounter) =>
  c.encounterId === enc.id && c.active !== false;

/**
 * Link candidates for a token: only an unbound token on the started encounter's scene; the
 * encounter's active, non-removed, token-less combatants of the token's definition, in order.
 */
export function linkCandidates<C extends LinkCombatant>(
  token: LinkToken,
  combatants: readonly C[],
  enc: LinkEncounter | null,
): C[] {
  if (!enc || token.sceneId !== enc.sceneId) return [];
  const live = combatants.filter((c) => activeOf(c, enc));
  if (live.some((c) => c.tokenId === token.id)) return [];
  return live.filter((c) => c.tokenId === null && !c.removed && c.entityId === token.definitionId);
}

/** "Unlink from combat": the active combatant bound to this token, if any. */
export function linkedCombatant<C extends LinkCombatant>(
  token: { id: string },
  combatants: readonly C[],
  enc: LinkEncounter | null,
): C | null {
  if (!enc) return null;
  return combatants.find((c) => activeOf(c, enc) && c.tokenId === token.id) ?? null;
}

/**
 * The popup's note (FR-CBTX-45): for selected tokens not in combat that one of the encounter's
 * token-less combatants could take, "Goblin 6 has no token: link it from the token menu" (names
 * joined); null when none matches.
 */
export function linkHint(
  selectedTokenIds: readonly string[],
  tokens: readonly LinkToken[],
  combatants: readonly LinkCombatant[],
  enc: LinkEncounter | null,
): string | null {
  const names: string[] = [];
  for (const id of selectedTokenIds) {
    const t = tokens.find((x) => x.id === id);
    if (!t) continue;
    for (const c of linkCandidates(t, combatants, enc)) {
      if (!names.includes(c.name)) names.push(c.name);
    }
  }
  if (names.length === 0) return null;
  const verb = names.length === 1 ? "has" : "have";
  return `${names.join(", ")} ${verb} no token: link it from the token menu`;
}
