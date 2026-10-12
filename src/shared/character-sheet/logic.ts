// character-sheet derived values (CHAR §8): never stored. Pure; the server builds rolls with
// `characterRolls` (FR-CHAR-05) and combat-tracker reuses it; clients format with the rest.
import type { RollCategory } from "@shared/dice-roll-log/schemas";
import type { Attack, CharacterStatBlock } from "@shared/entities/schemas";
import type { CharRollKind } from "./schemas";

/** One roll of a sheet action: what `dice.evaluate` gets, minus actor and mode. */
export interface CharacterRollSpec {
  expression: string;
  category: RollCategory;
  label: string;
  /** Roll mode applies to this roll (the d20 only, FR-CHAR-06). */
  d20: boolean;
}

type RollStats = Pick<CharacterStatBlock, "initBonus" | "attacks">;

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
 */
export function characterRolls(stats: RollStats, kind: CharRollKind): CharacterRollSpec[] | null {
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

export const isDown = (hpCurrent: number): boolean => hpCurrent === 0;

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
