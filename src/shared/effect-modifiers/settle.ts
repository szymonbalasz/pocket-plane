// Popup defaults for offered rule-trigger parts (FR-MOD-39; seams S1): pure, from the card's
// settle facts and the DM's store only (no `rule-trigger` rows). Each part's **default target** =
// the first row (list order) marked Hit whose target-side facts pass: `marked` (an active effect
// with that preset whose source is the attacker; the card names a campaign mark by its name, R7)
// and `hurt` (HP below max). Ticked iff a default target exists and the part isn't `untick`.
// FR-MOD-63 (sprint 5): in the damage step the rows are the ruled hits in ruling order, so the
// first Hit row is the ruling's first hit target still listed.
import { isBuiltinPresetKey } from "./schemas";
import { type MarkEffect, targetMarkedBy } from "./trigger-fire";

/** The settle facts of one offered part (`CardTriggerPart`). */
export interface SettlePart {
  triggerId: string;
  ask?: string;
  marked?: string;
  hurt?: true;
  untick?: true;
}

/** One popup target row, list order. */
export interface SettleRow {
  /** The target's combatant id. */
  targetId: string;
  /** A PC's character (its effects may sit on the character). */
  characterId?: string | null;
  hit: boolean;
  hp: { current: number; max: number } | null;
}

/** What the DM's store holds for the target-side facts. */
export interface SettleStore {
  effects: readonly MarkEffect[];
  /** Campaign presets (`characterId` null): a campaign mark is matched by name. */
  campaignPresets: readonly { id: string; name: string }[];
}

export type SettleHint = "ask" | "none" | null;

export interface SettledPart {
  triggerId: string;
  /** The default target (combatant id); null = no Hit row passes. */
  targetId: string | null;
  ticked: boolean;
  /** "ask" = "Check: ‹ask›"; "none" = Hit rows exist but none passes. */
  hint: SettleHint;
  ask: string | null;
}

/** The preset keys an effect may carry for the card's `marked` (built-in key, or ids by name). */
export function markKeys(marked: string, presets: SettleStore["campaignPresets"]): string[] {
  if (isBuiltinPresetKey(marked)) return [marked];
  return presets.filter((p) => p.name === marked).map((p) => p.id);
}

/** Whether a row passes the part's target-side facts (FR-MOD-39). */
export function targetPasses(
  part: SettlePart,
  row: SettleRow,
  attackerId: string,
  store: SettleStore,
): boolean {
  if (part.hurt && !(row.hp && row.hp.current < row.hp.max)) return false;
  if (part.marked !== undefined) {
    const keys = markKeys(part.marked, store.campaignPresets);
    const target = { combatantId: row.targetId, characterId: row.characterId ?? null };
    if (!keys.some((k) => targetMarkedBy(store.effects, target, k, attackerId))) return false;
  }
  return true;
}

/** Every offered part's default target, tick and hint (card order). */
export function settleTriggers(
  card: { attackerId: string; damage: { triggers?: readonly SettlePart[] } | null },
  rows: readonly SettleRow[],
  store: SettleStore,
): SettledPart[] {
  const hits = rows.filter((r) => r.hit);
  return (card.damage?.triggers ?? []).map((part) => {
    const target = hits.find((r) => targetPasses(part, r, card.attackerId, store)) ?? null;
    const hint: SettleHint = part.ask ? "ask" : hits.length > 0 && !target ? "none" : null;
    return {
      triggerId: part.triggerId,
      targetId: target?.targetId ?? null,
      ticked: target !== null && !part.untick,
      hint,
      ask: part.ask ?? null,
    };
  });
}
