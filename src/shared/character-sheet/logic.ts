// character-sheet derived values (CHAR §8): never stored. Pure; the server builds rolls with
// `characterRolls` (FR-CHAR-05) and combat-tracker reuses it; clients format with the rest.
import type { RollCategory } from "@shared/dice-roll-log/schemas";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type AbilityStats,
  type Attack,
  abilityMod,
  type CharacterStatBlock,
  checkBonus,
  proficiencyBonus,
  saveBonus,
} from "@shared/entities/schemas";
import type { AbilityRollKind, SheetRollKind } from "./schemas";

/** One roll of a sheet action: what `dice.evaluate` gets, minus actor and mode. */
export interface CharacterRollSpec {
  expression: string;
  category: RollCategory;
  label: string;
  /** Roll mode applies to this roll (the d20 only, FR-CHAR-06). */
  d20: boolean;
}

type RollStats = Pick<CharacterStatBlock, "initBonus" | "attacks">;
/** Kinds that need no ability: initiative, attack. */
type ActionRollKind = Exclude<SheetRollKind, AbilityRollKind>;

/** `1d20+2`, `1d20-1`, `1d20` (FR-CHAR-05). */
export function d20(bonus: number): string {
  if (bonus === 0) return "1d20";
  return bonus > 0 ? `1d20+${bonus}` : `1d20${bonus}`;
}

/** The sheet's one weapon attack (ADR-0012), or null. */
export const sheetAttack = (s: Pick<CharacterStatBlock, "attacks">): Attack | null =>
  s.attacks[0] ?? null;

/**
 * FR-CHAR-05: initiative = d20 + initBonus (category initiative); attack = d20 + toHit (attack)
 * and the attack's damage (damage). `null` = attack without a weapon attack (caller: `conflict`).
 * FR-CHAR-21: check / save = d20 + `checkBonus` / `saveBonus` (FR-ENT-24), categories
 * `ability-check` / `saving-throw`; `null` = no ability scores (caller: `conflict`). Takes any
 * stat block (combat reuses it for monsters, FR-CBT-44).
 */
export function characterRolls(stats: RollStats, kind: ActionRollKind): CharacterRollSpec[] | null;
export function characterRolls(
  stats: RollStats & AbilityStats,
  kind: SheetRollKind,
  ability: Ability,
): CharacterRollSpec[] | null;
export function characterRolls(
  stats: RollStats & Partial<AbilityStats>,
  kind: SheetRollKind,
  ability?: Ability,
): CharacterRollSpec[] | null {
  if (kind === "check" || kind === "save") {
    if (!ability) return null;
    const s = stats as AbilityStats;
    const bonus = kind === "check" ? checkBonus(s, ability) : saveBonus(s, ability);
    if (bonus === null) return null;
    return [
      {
        expression: d20(bonus),
        category: kind === "check" ? "ability-check" : "saving-throw",
        label: `${ABILITY_NAMES[ability]} ${kind}`,
        d20: true,
      },
    ];
  }
  if (kind === "initiative") {
    return [
      { expression: d20(stats.initBonus), category: "initiative", label: "Initiative", d20: true },
    ];
  }
  const a = sheetAttack(stats);
  if (!a) return null;
  return [
    { expression: d20(a.toHit), category: "attack", label: `${a.name} attack`, d20: true },
    {
      expression: a.damage,
      category: "damage",
      label: a.damageType ? `${a.name} damage (${a.damageType})` : `${a.name} damage`,
      d20: false,
    },
  ];
}

/** Signed bonus for display: `+2`, `−1` (U+2212), `+0`. */
export const signed = (n: number): string => (n < 0 ? `\u2212${Math.abs(n)}` : `+${n}`);

/** "Level 1 Fighter"; class omitted if empty (FR-CHAR-03). */
export function levelLine(level: number, className: string): string {
  const c = className.trim();
  return c ? `Level ${level} ${c}` : `Level ${level}`;
}

/** "Shortsword +4 · 1d6+2 piercing" (FR-CHAR-03). */
export function attackLine(a: Attack): string {
  const dmg = a.damageType ? `${a.damage} ${a.damageType}` : a.damage;
  return `${a.name} ${signed(a.toHit)} \u00b7 ${dmg}`;
}

/** FR-CHAR-18: "30 ft"; absent → "—". */
export const speedText = (speed: number | undefined): string =>
  speed === undefined ? "—" : `${speed} ft`;

/** One cell of the abilities block (FR-CHAR-22); bonuses derived, never stored (FR-CHAR-20). */
export interface AbilityCell {
  ability: Ability;
  /** "STR" … "CHA". */
  abbr: string;
  score: number;
  mod: number;
  check: number;
  save: number;
  proficient: boolean;
}

/** FR-CHAR-19/22: proficiency bonus + six cells in STR … CHA order; null without scores. */
export function abilityBlock(
  stats: AbilityStats,
): { proficiency: number; cells: AbilityCell[] } | null {
  const scores = stats.abilities;
  if (!scores) return null;
  return {
    proficiency: proficiencyBonus(stats),
    cells: ABILITIES.map((a) => ({
      ability: a,
      abbr: a.toUpperCase(),
      score: scores[a],
      mod: abilityMod(scores[a]),
      check: checkBonus(stats, a) as number,
      save: saveBonus(stats, a) as number,
      proficient: stats.saveProficiencies?.includes(a) ?? false,
    })),
  };
}

export const isDown = (hpCurrent: number): boolean => hpCurrent === 0;

/** HP colour token (`hp.*`, visual-direction): down at 0, bloodied at ≤ half, else full. */
export function hpState(hpCurrent: number, hpMax: number): "full" | "bloodied" | "down" {
  if (hpCurrent <= 0) return "down";
  return hpCurrent * 2 <= hpMax ? "bloodied" : "full";
}

/** FR-CHAR-10: `clamp(before + delta, 0, hpMax)`. */
export function clampHp(before: number, delta: number, hpMax: number): number {
  return Math.max(0, Math.min(hpMax, before + delta));
}

/** Portrait fallback (FR-CHAR-03): up to two initials. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? ""];
  return letters
    .map((p) => [...(p ?? "")][0] ?? "")
    .join("")
    .toUpperCase();
}

/** Minimal character view the eligibility rule needs. */
export interface EligibleInput {
  id: string;
  kind: string;
  name: string;
  ownerPlayerId: string | null;
  /** Present on full records only (DM, owner); redacted records lack it (FR-ENT-15). */
  statBlock?: unknown;
}

/**
 * FR-CHAR-02: player = own characters; DM = every character of the campaign. Sorted by name
 * (case-insensitive, code-point order), then id.
 */
export function eligibleCharacters<T extends EligibleInput>(
  entities: readonly T[],
  viewer: { role: "dm" | "player"; playerId: string | null },
): T[] {
  return entities
    .filter(
      (e) =>
        e.kind === "character" &&
        e.statBlock !== undefined &&
        (viewer.role === "dm" || (viewer.playerId !== null && e.ownerPlayerId === viewer.playerId)),
    )
    .sort((a, b) => {
      const ka = a.name.toLowerCase();
      const kb = b.name.toLowerCase();
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** FR-CHAR-02 / FR-CHAR-04: keep the selection if still eligible, else the first, else null. */
export function selectCharacter<T extends { id: string }>(
  eligible: readonly T[],
  selectedId: string | null,
): T | null {
  return eligible.find((e) => e.id === selectedId) ?? eligible[0] ?? null;
}

/** FR-CHAR-11: the HP input as an amount 1–999, else null (both buttons disabled). */
export function parseHpAmount(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 999 ? n : null;
}
