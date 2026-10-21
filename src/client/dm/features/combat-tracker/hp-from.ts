// The Damage / heal dialog's From (FR-CBT-136, OQ-CBT-89 A): "DM" or an active, non-removed
// combatant of the started encounter. Untouched ("auto"), Heal is from the turn combatant and
// Damage from the DM. Display and intent shape only; the server checks the source.

/** The Select's untouched value. */
export const FROM_AUTO = "auto";
/** "DM": no `sourceId`. */
export const FROM_DM = "dm";

export interface FromOption {
  id: string;
  name: string;
}

/** The fight's possible sources, in the initiative order given (active, not removed). */
export function fromOptions(
  combatants: readonly { id: string; name: string; active?: boolean; removed?: boolean }[],
): FromOption[] {
  return combatants
    .filter((c) => c.active !== false && c.removed !== true)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** The `sourceId` an apply sends (undefined = the DM). */
export function sourceIdFor(
  kind: "damage" | "heal",
  value: string,
  turnId: string | null | undefined,
  options: readonly FromOption[],
): string | undefined {
  if (value === FROM_DM) return undefined;
  if (value === FROM_AUTO) {
    if (kind !== "heal" || !turnId) return undefined;
    return options.some((o) => o.id === turnId) ? turnId : undefined;
  }
  return options.some((o) => o.id === value) ? value : undefined;
}

/** The untouched Select's text: "Heal: Sela · Damage: DM". */
export function autoLabel(turnId: string | null | undefined, options: readonly FromOption[]) {
  const turn = options.find((o) => o.id === turnId)?.name ?? "DM";
  return `Heal: ${turn} · Damage: DM`;
}
