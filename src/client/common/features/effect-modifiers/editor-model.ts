// Modifier editor drafts (MOD §7 "Modifier editor"): one row per modifier, kinds of built tiers
// only (tier 1: dice, flat on a roll; tier 2: mode, defense, flat on AC as `ac`). Pure; the zod
// `Modifier` decides validity.
import {
  MODIFIER_DAMAGE_TYPES,
  MODIFIERS_MAX,
  Modifier,
  ROLL_KINDS,
  type RollKind,
} from "@shared/effect-modifiers/schemas";
import type { Ability, DAMAGE_TYPES } from "@shared/entities/schemas";

export type DraftVia = "any" | "weapon" | "spell";
export type DraftDamageType = (typeof DAMAGE_TYPES)[number];

/** Editor kinds: the modifier kinds, `flat` on AC shown as its own kind (MOD §8.1). */
export const DRAFT_KINDS = ["dice", "flat", "mode", "defense", "ac"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
/** Kinds without a roll selector. */
export const takesRoll = (k: DraftKind) => k !== "defense" && k !== "ac";

export interface ModDraft {
  kind: DraftKind;
  roll: RollKind;
  /** Saves / checks only; empty = every ability. */
  abilities: Ability[];
  /** Attacks / damage only. */
  via: DraftVia;
  /** Dice kind: "1d4", "-1d4" / "−1d4" (minus = subtract). */
  dice: string;
  /** Flat / AC kind: a signed integer. */
  value: string;
  /** Mode kind. */
  mode: "advantage" | "disadvantage";
  /** Defense kind: level and 1–13 damage types. */
  level: "resistance" | "vulnerability" | "immunity";
  types: DraftDamageType[];
}

export { MODIFIER_DAMAGE_TYPES, MODIFIERS_MAX, ROLL_KINDS };

export const takesAbilities = (r: RollKind) => r === "save" || r === "check";
export const takesVia = (r: RollKind) => r === "attack" || r === "damage";

export const newDraft = (): ModDraft => ({
  kind: "dice",
  roll: "attack",
  abilities: [],
  via: "any",
  dice: "1d4",
  value: "1",
  mode: "advantage",
  level: "resistance",
  types: [],
});

export function draftOf(m: Modifier): ModDraft {
  const base = newDraft();
  if (m.kind === "defense")
    return { ...base, kind: "defense", level: m.level, types: [...m.types] };
  if (m.kind === "flat" && m.on.roll === "ac")
    return { ...base, kind: "ac", value: String(m.value) };
  const on = m.on as Exclude<typeof m.on, { roll: "ac" }>;
  const sel = {
    roll: on.roll,
    abilities: "abilities" in on && on.abilities ? [...on.abilities] : [],
    via: ("via" in on && on.via ? on.via : "any") as DraftVia,
  };
  if (m.kind === "dice")
    return { ...base, ...sel, kind: "dice", dice: `${m.sign < 0 ? "-" : ""}${m.dice}` };
  if (m.kind === "mode") return { ...base, ...sel, kind: "mode", mode: m.mode };
  return { ...base, ...sel, kind: "flat", value: String(m.value) };
}

const intOf = (v: string) => {
  const t = v.trim().replace(/^−/, "-").replace(/^\+/, "");
  return /^-?\d+$/.test(t) ? Number(t) : Number.NaN;
};

/** The modifier a draft stands for, or null while it is invalid. */
export function modifierOf(d: ModDraft): Modifier | null {
  const on = {
    roll: d.roll,
    ...(takesAbilities(d.roll) && d.abilities.length > 0 ? { abilities: d.abilities } : {}),
    ...(takesVia(d.roll) && d.via !== "any" ? { via: d.via } : {}),
  };
  let raw: unknown;
  if (d.kind === "dice") {
    const s = d.dice.trim().replace(/^[−-]\s*/, "");
    const neg = /^[−-]/.test(d.dice.trim());
    raw = { kind: "dice", on, dice: s.toLowerCase(), sign: neg ? -1 : 1 };
  } else if (d.kind === "mode") {
    raw = { kind: "mode", on, mode: d.mode };
  } else if (d.kind === "defense") {
    // Types in the canonical order, whatever order they were ticked in.
    const types = MODIFIER_DAMAGE_TYPES.filter((t) => d.types.includes(t));
    raw = { kind: "defense", types, level: d.level };
  } else if (d.kind === "ac") {
    raw = { kind: "flat", on: { roll: "ac" }, value: intOf(d.value) };
  } else {
    raw = { kind: "flat", on, value: intOf(d.value) };
  }
  const r = Modifier.safeParse(raw);
  return r.success ? r.data : null;
}

/** Every draft valid → the list; else null. `min` = 1 for presets, 0 for an effect. */
export function modifiersOf(drafts: readonly ModDraft[], min: 0 | 1): Modifier[] | null {
  if (drafts.length < min || drafts.length > MODIFIERS_MAX) return null;
  const out = drafts.map(modifierOf);
  return out.every((m): m is Modifier => m !== null) ? out : null;
}
