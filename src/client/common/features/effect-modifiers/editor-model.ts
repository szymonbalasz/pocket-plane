// Modifier editor drafts (MOD §7 "Modifier editor"): one row per modifier, kinds of built tiers
// only (tier 1: dice, flat on a roll). Pure; the zod `Modifier` decides validity.
import {
  MODIFIERS_MAX,
  Modifier,
  ROLL_KINDS,
  type RollKind,
} from "@shared/effect-modifiers/schemas";
import type { Ability } from "@shared/entities/schemas";

export type DraftVia = "any" | "weapon" | "spell";

export interface ModDraft {
  kind: "dice" | "flat";
  roll: RollKind;
  /** Saves / checks only; empty = every ability. */
  abilities: Ability[];
  /** Attacks / damage only. */
  via: DraftVia;
  /** Dice kind: "1d4", "-1d4" / "−1d4" (minus = subtract). */
  dice: string;
  /** Flat kind: a signed integer. */
  value: string;
}

export { MODIFIERS_MAX, ROLL_KINDS };

export const takesAbilities = (r: RollKind) => r === "save" || r === "check";
export const takesVia = (r: RollKind) => r === "attack" || r === "damage";

export const newDraft = (): ModDraft => ({
  kind: "dice",
  roll: "attack",
  abilities: [],
  via: "any",
  dice: "1d4",
  value: "1",
});

export function draftOf(m: Modifier): ModDraft {
  const base = newDraft();
  if (m.kind === "dice" || m.kind === "flat") {
    const on = m.on.roll === "ac" ? { roll: "attack" as const } : m.on;
    const sel = {
      roll: on.roll,
      abilities: "abilities" in on && on.abilities ? [...on.abilities] : [],
      via: ("via" in on && on.via ? on.via : "any") as DraftVia,
    };
    if (m.kind === "dice")
      return { ...base, ...sel, kind: "dice", dice: `${m.sign < 0 ? "-" : ""}${m.dice}` };
    return { ...base, ...sel, kind: "flat", value: String(m.value) };
  }
  return base;
}

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
  } else {
    const t = d.value.trim().replace(/^−/, "-").replace(/^\+/, "");
    raw = { kind: "flat", on, value: /^-?\d+$/.test(t) ? Number(t) : Number.NaN };
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
