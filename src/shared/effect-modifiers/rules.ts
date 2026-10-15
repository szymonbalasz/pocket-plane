// Pure effect-modifier rules shared by server and clients (FR-MOD-02, -04, -06, -11): which
// modifiers a roll picks up, a creature's active modifiers, toggle state and preset lists.
import { type BuiltinPreset, builtinPresets } from "./presets";
import type {
  BuiltinPresetKey,
  EffectPresetRecord,
  Modifier,
  RollKind,
  RollSel,
  RollSubject,
} from "./schemas";

/** What a selector is matched against (a `RollSubject` without its creature). */
export type RollShape = Pick<RollSubject, "roll" | "ability" | "via">;

/**
 * FR-MOD-02: same roll kind; `abilities` (save / check) needs the roll's ability in the list (a
 * death save has none, so only selectors without `abilities` match it); `via` (attack / damage)
 * needs the same `via`. A skill check is a `check` of its ability; a concentration save a `con`
 * save; healing is never `damage` (callers pass no subject for it).
 */
export function matches(sel: RollSel | { roll: "ac" }, s: RollShape): boolean {
  if (sel.roll !== s.roll) return false;
  if ("abilities" in sel && sel.abilities) {
    if (s.ability === undefined || !sel.abilities.includes(s.ability)) return false;
  }
  if ("via" in sel && sel.via && sel.via !== s.via) return false;
  return true;
}

/** A creature: a character (PC) or a monster combatant (CBTX target ref). */
export type CreatureRef = { characterId: string } | { combatantId: string };

/** The effect fields the rules read; ended / seq are absent on players' redacted rows. */
export interface ModEffect {
  id: string;
  targetCharacterId: string | null;
  targetCombatantId: string | null;
  modifiers?: readonly Modifier[];
  endedAt?: string | null;
  seq?: number;
}

export interface ActiveMod<E extends ModEffect = ModEffect> {
  effect: E;
  modifier: Modifier;
  /** Index in the effect's list. */
  index: number;
}

/**
 * FR-MOD-04: modifiers of the creature's active effects (`endedAt` null): a PC → effects on the
 * character; a monster → effects on the combatant. Ordered by effect `seq` (input order where
 * absent), then index.
 */
export function activeMods<E extends ModEffect>(
  effects: readonly E[],
  creature: CreatureRef,
): ActiveMod<E>[] {
  const mine = effects
    .map((e, i) => ({ e, i }))
    .filter(({ e }) =>
      "characterId" in creature
        ? e.targetCharacterId === creature.characterId
        : e.targetCombatantId === creature.combatantId,
    )
    .filter(({ e }) => (e.endedAt ?? null) === null)
    .sort((a, b) => (a.e.seq ?? a.i) - (b.e.seq ?? b.i) || a.i - b.i);
  return mine.flatMap(({ e }) =>
    (e.modifiers ?? []).map((modifier, index) => ({ effect: e, modifier, index })),
  );
}

/** FR-MOD-14: the active modifiers a roll picks up. */
export const matchingMods = <E extends ModEffect>(
  effects: readonly E[],
  creature: CreatureRef,
  s: RollShape,
): ActiveMod<E>[] =>
  activeMods(effects, creature).filter(
    (m) => m.modifier.kind !== "defense" && matches(m.modifier.on, s),
  );

/**
 * FR-MOD-14: bonus dice of a `dice` part; doubled dice count on a crit's damage (5e). Flat
 * values never double.
 */
export function partDice(dice: string, s: { roll: RollKind; crit?: boolean }): string {
  if (!(s.crit && s.roll === "damage")) return dice;
  const [n, m] = dice.split("d");
  return `${Number(n) * 2}d${m}`;
}

/**
 * FR-MOD-11: a toggle is on iff its `activeEffectId` names an active effect (one ended by any
 * CBTX rule reads as off). `effects` = the store's (players' hold active ones only).
 */
export function toggleOn(
  preset: Pick<EffectPresetRecord, "activeEffectId">,
  effects: readonly Pick<ModEffect, "id" | "endedAt">[],
): boolean {
  const id = preset.activeEffectId;
  if (id === null) return false;
  return effects.some((e) => e.id === id && (e.endedAt ?? null) === null);
}

/** One entry of the DM's preset list (FR-MOD-06, -28). */
export type PresetChoice =
  | { source: "builtin"; key: BuiltinPresetKey; preset: BuiltinPreset }
  | { source: "customised"; key: BuiltinPresetKey; preset: EffectPresetRecord }
  | { source: "campaign"; key: null; preset: EffectPresetRecord };

/**
 * FR-MOD-06 / -28: built-ins in their order (a campaign row with that key replaces one, marked
 * "Customised"), then campaign presets by `seq`. Character presets are not listed.
 */
export function presetChoices(rows: readonly EffectPresetRecord[]): PresetChoice[] {
  const campaign = rows.filter((r) => r.characterId === null).sort((a, b) => a.seq - b.seq);
  const byKey = new Map(campaign.filter((r) => r.key !== null).map((r) => [r.key, r]));
  const out: PresetChoice[] = builtinPresets().map((b): PresetChoice => {
    const row = byKey.get(b.key);
    return row
      ? { source: "customised", key: b.key, preset: row }
      : { source: "builtin", key: b.key, preset: b };
  });
  for (const r of campaign)
    if (r.key === null) out.push({ source: "campaign", key: null, preset: r });
  return out;
}
