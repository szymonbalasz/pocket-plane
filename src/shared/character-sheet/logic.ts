// character-sheet derived values (CHAR §8): never stored. Pure; the server builds rolls with
// `characterRolls` (FR-CHAR-05) and combat-tracker reuses it; clients format with the rest.
import { LABEL_MAX, type RollCategory } from "@shared/dice-roll-log/schemas";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type AbilityStats,
  type Attack,
  abilityMod,
  type CharacterStatBlock,
  checkBonus,
  type ExtraDamage,
  proficiencyBonus,
  SKILL_NAMES,
  type Skill,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDc,
} from "@shared/entities/schemas";
import type { SheetRollKind } from "./schemas";
import type { SpellRow } from "./sheet";

/** One roll of a sheet action: what `dice.evaluate` gets, minus actor and mode. */
export interface CharacterRollSpec {
  expression: string;
  category: RollCategory;
  label: string;
  /** Roll mode applies to this roll (the d20 only, FR-CHAR-06). */
  d20: boolean;
  /**
   * FR-CHARX-55: a damage part of an attack row with extra parts (`extra: false` = the base
   * part, which carries the row's mods; `extra: true` = an extra part, no roll subject). Absent
   * on every other roll, so rows without extra parts build the same specs as before.
   */
  part?: { type: ExtraDamage["type"] | null; extra: boolean };
}

type RollStats = Pick<CharacterStatBlock, "initBonus" | "attacks">;
/** Kinds that need no ability: initiative, attack. */
type ActionRollKind = "initiative" | "attack";

/** `1d20+2`, `1d20-1`, `1d20` (FR-CHAR-05). */
export function d20(bonus: number): string {
  if (bonus === 0) return "1d20";
  return bonus > 0 ? `1d20+${bonus}` : `1d20${bonus}`;
}

/** The sheet's first weapon attack (ADR-0012; MVP clients and combat), or null. */
export const sheetAttack = (s: Pick<CharacterStatBlock, "attacks">): Attack | null =>
  s.attacks[0] ?? null;

/** The row a roll names (FR-CHARX-20): `attackId` / `spellId`, a skill or an ability. */
export interface RollRef {
  ability?: Ability;
  skill?: Skill;
  attackId?: string;
  spellId?: string;
}

/** What `characterRolls` needs of the `creature-sheet` (null = no row: defaults, no spells). */
export type RollSheet = { spells: readonly SpellRow[] } | null;

/** FR-CHARX-21: the specs, or why not (the server maps `code` to its reject). */
export type SheetRollResult =
  | { ok: true; specs: CharacterRollSpec[] }
  | { ok: false; code: "not_found" | "conflict"; message: string };

const NO_SCORES = "No ability scores";

const damageLabel = (name: string, damageType: string | null | undefined) =>
  damageType ? `${name} damage (${damageType})` : `${name} damage`;

/**
 * What combat rolls for one sheet row (FR-CHARX-24, OQ-CHARX-12): a weapon attack, or a spell
 * with `roll: attack` and `damage` (to-hit = the spell attack bonus).
 */
export interface SheetAttack {
  name: string;
  /** The stored numbers, without `bonus` (FR-CHARX-54). */
  toHit: number;
  damage: string;
  damageType: string | null;
  /** FR-CHARX-55: magic +N (0 = none; spells 0), on to-hit and the base part's constant. */
  bonus: number;
  /** FR-CHARX-55: typed extra parts in row order ([] = none; spells []). */
  extraDamage: ExtraDamage[];
}

/** The row `cbt.attack` names: an attack row, a spell row, or neither (= the first attack). */
export interface SheetAttackRef {
  attackId?: string;
  spellId?: string;
}

export type SheetAttackResult =
  | { ok: true; attack: SheetAttack }
  | { ok: false; code: "not_found" | "conflict"; message: string };

/**
 * FR-CHARX-24: the attack a ref names, from committed data (overrides honoured). No ref → the
 * first attack (MVP clients and combat). Unknown row → `not_found`; a spell without an attack
 * roll or without damage, or no spellcasting → `conflict` (a spell attack without damage is
 * never combat's: it stays a plain `char.roll`).
 */
export function resolveSheetAttack(
  stats: RollStats & AbilityStats,
  sheet: RollSheet,
  ref: SheetAttackRef,
): SheetAttackResult {
  const fail = (code: "not_found" | "conflict", message: string): SheetAttackResult => ({
    ok: false,
    code,
    message,
  });
  if (ref.spellId !== undefined) {
    const s = sheet?.spells.find((x) => x.id === ref.spellId);
    if (!s) return fail("not_found", "Spell was deleted");
    if (s.roll !== "attack") return fail("conflict", `No attack roll for ${s.name}`);
    if (!s.damage) return fail("conflict", `No damage roll for ${s.name}`);
    const bonus = spellAttackBonus(stats);
    if (bonus === null) return fail("conflict", "No spellcasting");
    const attack = { name: s.name, toHit: bonus, damage: s.damage, bonus: 0, extraDamage: [] };
    return { ok: true, attack: { ...attack, damageType: s.damageType ?? null } };
  }
  const a =
    ref.attackId === undefined
      ? sheetAttack(stats)
      : (stats.attacks.find((x) => x.id === ref.attackId) ?? null);
  if (!a) {
    return ref.attackId === undefined
      ? fail("conflict", "No weapon attack")
      : fail("not_found", "Attack was deleted");
  }
  const attack = { name: a.name, toHit: a.toHit, damage: a.damage };
  return {
    ok: true,
    attack: {
      ...attack,
      damageType: a.damageType ?? null,
      bonus: a.bonus ?? 0,
      extraDamage: a.extraDamage ?? [],
    },
  };
}

/** FR-CHARX-55: `NdM[±K]` with `bonus` added to its constant (`2d6+4` + 1 → `2d6+5`). */
export function withDamageBonus(damage: string, bonus: number): string {
  const m = /^(\d+d\d+)([+-]\d+)?$/.exec(damage);
  if (!m || bonus === 0) return damage;
  const k = Number(m[2] ?? 0) + bonus;
  return k === 0 ? (m[1] as string) : `${m[1]}${k > 0 ? "+" : ""}${k}`;
}

/** FR-CHARX-55: the base part as rolled: the row's damage + `bonus`. */
export const baseDamage = (a: Pick<SheetAttack, "damage" | "bonus">): string =>
  withDamageBonus(a.damage, a.bonus);

/**
 * To-hit (d20, category `attack`) then damage (category `damage`) of one attack (FR-CHAR-05).
 * FR-CHARX-55: to-hit `1d20 + toHit + bonus`; the base part's constant + `bonus`; then one
 * damage spec per extra part, in row order, each typed (`part`).
 */
export function attackRollSpecs(
  a: SheetAttack,
): [CharacterRollSpec, CharacterRollSpec, ...CharacterRollSpec[]] {
  const parted = a.extraDamage.length > 0;
  const type = (a.damageType ?? null) as ExtraDamage["type"] | null;
  return [
    {
      expression: d20(a.toHit + a.bonus),
      category: "attack",
      label: fitLabel(`${a.name} attack`),
      d20: true,
    },
    {
      expression: baseDamage(a),
      category: "damage",
      label: fitLabel(damageLabel(a.name, a.damageType)),
      d20: false,
      ...(parted ? { part: { type, extra: false } } : {}),
    },
    ...a.extraDamage.map(
      (x): CharacterRollSpec => ({
        expression: x.damage,
        category: "damage",
        label: fitLabel(damageLabel(a.name, x.type)),
        d20: false,
        part: { type: x.type, extra: true },
      }),
    ),
  ];
}

/**
 * FR-CHAR-05: initiative = d20 + initBonus (category initiative); attack = d20 + toHit (attack)
 * and the attack's damage (damage). `null` = attack without a weapon attack (caller: `conflict`).
 * FR-CHAR-21: check / save = d20 + `checkBonus` / `saveBonus` (FR-ENT-24), categories
 * `ability-check` / `saving-throw`; `null` = no ability scores (caller: `conflict`). Takes any
 * stat block (combat reuses it for monsters, FR-CBT-44).
 *
 * FR-CHARX-21: `characterRolls(stats, sheet, kind, ref)` builds every kind of the CHARX table
 * from committed data (overrides honoured): unknown row → `not_found`; a spell without the roll
 * asked for → `conflict`.
 */
export function characterRolls(stats: RollStats, kind: ActionRollKind): CharacterRollSpec[] | null;
export function characterRolls(
  stats: RollStats & AbilityStats,
  kind: SheetRollKind,
  ability: Ability,
): CharacterRollSpec[] | null;
export function characterRolls(
  stats: RollStats & AbilityStats,
  sheet: RollSheet,
  kind: SheetRollKind,
  ref: RollRef,
): SheetRollResult;
export function characterRolls(
  stats: RollStats & Partial<AbilityStats>,
  a: SheetRollKind | RollSheet,
  b?: Ability | SheetRollKind,
  ref?: RollRef,
): CharacterRollSpec[] | null | SheetRollResult {
  if (typeof a === "string") {
    const kind = a;
    if ((kind === "check" || kind === "save") && !b) return null;
    const r = sheetRolls(stats as RollStats & AbilityStats, null, kind, {
      ability: b as Ability | undefined,
    });
    return r.ok ? r.specs : null;
  }
  return sheetRolls(stats as RollStats & AbilityStats, a, b as SheetRollKind, ref ?? {});
}

function sheetRolls(
  stats: RollStats & AbilityStats,
  sheet: RollSheet,
  kind: SheetRollKind,
  ref: RollRef,
): SheetRollResult {
  const ok = (specs: CharacterRollSpec[]): SheetRollResult => ({ ok: true, specs });
  const fail = (code: "not_found" | "conflict", message: string): SheetRollResult => ({
    ok: false,
    code,
    message,
  });
  const spec = (
    expression: string,
    category: RollCategory,
    label: string,
    isD20: boolean,
  ): CharacterRollSpec => ({ expression, category, label: fitLabel(label), d20: isD20 });

  switch (kind) {
    case "initiative":
      return ok([spec(d20(stats.initBonus), "initiative", "Initiative", true)]);
    case "check":
    case "save": {
      if (!ref.ability) return fail("conflict", "Pick an ability");
      const bonus =
        kind === "check" ? checkBonus(stats, ref.ability) : saveBonus(stats, ref.ability);
      if (bonus === null) return fail("conflict", NO_SCORES);
      const category = kind === "check" ? "ability-check" : "saving-throw";
      return ok([spec(d20(bonus), category, `${ABILITY_NAMES[ref.ability]} ${kind}`, true)]);
    }
    case "skill": {
      if (!ref.skill) return fail("conflict", "Pick a skill");
      const bonus = skillBonus(stats, ref.skill);
      if (bonus === null) return fail("conflict", NO_SCORES);
      return ok([spec(d20(bonus), "skill-check", `${SKILL_NAMES[ref.skill]} check`, true)]);
    }
    case "attack":
    case "damage":
    case "toHit": {
      const r = resolveSheetAttack(stats, sheet, { attackId: ref.attackId });
      if (!r.ok) return r;
      const [hit, ...dmg] = attackRollSpecs(r.attack);
      // FR-CHARX-42: toHit = the d20 alone; attack keeps to-hit + damage (FR-CHAR-05);
      // FR-CHARX-55: damage = every part.
      return ok(kind === "damage" ? dmg : kind === "toHit" ? [hit] : [hit, ...dmg]);
    }
    case "spellAttack":
    case "spellDamage":
    case "spellToHit": {
      const s = sheet?.spells.find((x) => x.id === ref.spellId);
      if (!s) return fail("not_found", "Spell was deleted");
      const category: RollCategory = s.effect === "healing" ? "healing" : "damage";
      const effectLabel =
        s.effect === "healing" ? `${s.name} healing` : damageLabel(s.name, s.damageType);
      if (kind === "spellAttack" || kind === "spellToHit") {
        if (s.roll !== "attack") return fail("conflict", `No attack roll for ${s.name}`);
        const bonus = spellAttackBonus(stats);
        if (bonus === null) return fail("conflict", "No spellcasting");
        const hit = spec(d20(bonus), "attack", `${s.name} attack`, true);
        if (kind === "spellToHit") return ok([hit]);
        return ok(s.damage ? [hit, spec(s.damage, category, effectLabel, false)] : [hit]);
      }
      if (!s.damage) return fail("conflict", `No damage roll for ${s.name}`);
      const dc = s.roll === "save" && s.saveAbility ? spellSaveDc(stats) : null;
      const label =
        dc !== null && s.saveAbility
          ? `${effectLabel}, DC ${dc} ${s.saveAbility.toUpperCase()}`
          : effectLabel;
      return ok([spec(s.damage, category, label, false)]);
    }
  }
}

/**
 * A derived roll label cut to the dice log's `LABEL_MAX` with "…": a legal 40-char attack name
 * plus "damage (bludgeoning)" is 61 chars. Never splits a surrogate pair.
 */
export function fitLabel(s: string): string {
  if (s.length <= LABEL_MAX) return s;
  let cut = LABEL_MAX - 1;
  const last = s.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${s.slice(0, cut).trimEnd()}…`;
}

/** Signed bonus for display: `+2`, `−1` (U+2212), `+0`. */
export const signed = (n: number): string => (n < 0 ? `\u2212${Math.abs(n)}` : `+${n}`);

/** "Level 1 Fighter"; class omitted if empty (FR-CHAR-03). */
export function levelLine(level: number, className: string): string {
  const c = className.trim();
  return c ? `Level ${level} ${c}` : `Level ${level}`;
}

/**
 * FR-CHARX-56: "+8 · 2d6+5 slashing + 2d6 fire": `bonus` folded into the shown numbers,
 * extra parts joined " + ".
 */
export function attackNumbers(a: Attack): string {
  const bonus = a.bonus ?? 0;
  const base = withDamageBonus(a.damage, bonus);
  const parts = [
    a.damageType ? `${base} ${a.damageType}` : base,
    ...(a.extraDamage ?? []).map((x) => `${x.damage} ${x.type}`),
  ];
  return `${signed(a.toHit + bonus)} · ${parts.join(" + ")}`;
}

/** "Shortsword +4 · 1d6+2 piercing" (FR-CHAR-03; FR-CHARX-56: bonus and parts included). */
export function attackLine(a: Attack): string {
  return `${a.name} ${attackNumbers(a)}`;
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
