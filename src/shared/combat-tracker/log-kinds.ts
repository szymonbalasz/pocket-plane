// Log-entry kinds `cbt.attack` and `cbt.hp` (FR-CBT-24, FR-DICE-18). Public text = actors, roll
// + modifier, outcome, damage, "physical" tags; AC, the computed hit, overrides and the dice
// breakdown stay in `dmPayload` (FR-CBT-53, FR-DICE-28).
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { rollBreakdownSegments } from "@shared/dice-roll-log/roll-kind";
import { DmModPart, ROLL_MODS_MAX, RollModPart } from "@shared/dice-roll-log/schemas";
import { linePartSegments } from "@shared/effect-modifiers/combat-parts";
import { modSegments } from "@shared/effect-modifiers/line";
import { PartDamageType } from "@shared/effect-modifiers/schemas";
import { EXTRA_DAMAGE_MAX } from "@shared/entities/schemas";
import { z } from "zod";
import {
  CardDie,
  LOG_KIND_ATTACK,
  LOG_KIND_HP,
  TRIGGER_EXPRESSION_MAX,
  TRIGGER_LABEL_MAX,
  TRIGGER_PARTS_MAX,
} from "./schemas";

const Multiplier = z.enum(["normal", "half", "none", "double"]);

/**
 * effect-modifiers (FR-MOD-20, -38, -47): one rule-trigger part an apply landed on this target,
 * player-safe: `label` iff the trigger is `public`, else null "(DM)"; `value` = its damage after
 * its multiplier (inside `damage`); `type` null = the attack's type; `multiplier` its own when
 * not normal (R7). "+ 6 radiant (Divine Fury)".
 */
/** FR-MOD-57 (sprint 4): per-die values of a landed trigger part, `expression`'s dice order. */
export const LINE_PART_DICE_MAX = 20;
const PartExpression = z.string().min(1).max(TRIGGER_EXPRESSION_MAX);
const PartDice = z.array(z.int().min(1)).min(1).max(LINE_PART_DICE_MAX);

export const AttackLinePart = z.strictObject({
  label: z.string().max(TRIGGER_LABEL_MAX).nullable(),
  value: z.int().min(0),
  type: PartDamageType.nullable(),
  multiplier: Multiplier.exclude(["normal"]).optional(),
  /**
   * FR-MOD-57 (sprint 4, rulings B3 / B4): the part's roll, **public character triggers only**
   * (every other part keeps them in `dmPayload.parts`). Absent = none; old rows parse.
   */
  expression: PartExpression.optional(),
  dice: PartDice.optional(),
});
export type AttackLinePart = z.infer<typeof AttackLinePart>;

/**
 * FR-MOD-40: the DM's facts of a line part (same index): name, rolled value, `set` = the DM
 * edited the value (R7: "(DM set; rolled 7)"), forced.
 */
export const AttackLineDmPart = z.strictObject({
  triggerId: z.string().min(1).max(64),
  label: z.string().max(TRIGGER_LABEL_MAX),
  rolled: z.int(),
  set: z.literal(true).optional(),
  forced: z.literal(true).optional(),
  /** FR-MOD-57 (sprint 4): every part's roll, for the DM's line. Absent = none; old rows parse. */
  expression: PartExpression.optional(),
  dice: PartDice.optional(),
});
export type AttackLineDmPart = z.infer<typeof AttackLineDmPart>;

/** FR-MOD-24 (tier 2): an AC part of the target's effective AC (DM only). */
export const AcModPart = z.strictObject({
  effectId: z.string().min(1).max(64),
  label: z.string().max(60),
  value: z.int(),
});
/** FR-MOD-25 (tier 2): the defense preset behind the row's multiplier (DM only). */
export const DefenseFact = z.strictObject({
  level: z.enum(["resistance", "vulnerability", "immunity", "both"]),
  label: z.string().max(60),
});

/**
 * FR-CBT-84 (sprint 4): one extra weapon damage part of the line (public, like the damage):
 * `value` = after its own multiplier, which shows when not normal. "15 slashing + 4 fire (half)".
 */
export const AttackLineDamagePart = z.strictObject({
  type: PartDamageType,
  value: z.int().min(0),
  multiplier: Multiplier.exclude(["normal"]).optional(),
});
export type AttackLineDamagePart = z.infer<typeof AttackLineDamagePart>;

export const AttackLogPayload = z.strictObject({
  targetName: z.string(),
  attackName: z.string(),
  damageType: z.string().nullable(),
  /**
   * `dice` = rolled dice sum, null when the DM edited the total. Null = a damage-only card
   * (FR-CBT-72/73): "Mira → Goblin: 6 piercing damage (Light crossbow)".
   */
  toHit: z
    .strictObject({
      dice: z.int().nullable(),
      constant: z.int(),
      /** effect-modifiers (FR-MOD-19/20): parts after the constant (player-safe labels). */
      mods: z.array(RollModPart).min(1).max(ROLL_MODS_MAX).optional(),
      total: z.int(),
      natural: z.int().nullable(),
    })
    .nullable(),
  hit: z.boolean(),
  /** Damage dealt before HP clamping (`raw`). */
  damage: z.int(),
  multiplier: Multiplier,
  crit: z.boolean(),
  /** FR-CBT-53 (a), #171: physical-dice flags, shown as "physical" to everyone. Old rows: absent. */
  manual: z.strictObject({ toHit: z.boolean(), damage: z.boolean() }).optional(),
  /**
   * effect-modifiers (FR-MOD-20, -38): rule-trigger parts in `damage` (`damage` = weapon raw + Σ
   * parts). Absent = none; old rows parse. Rendered by R7 (card text, outcome lines).
   */
  parts: z.array(AttackLinePart).min(1).max(TRIGGER_PARTS_MAX).optional(),
  /**
   * FR-CBT-84 (sprint 4): the extra weapon parts in `damage` (`damage` = base + Σ extra + Σ
   * trigger parts), attack-row order. Absent = none; old rows parse.
   */
  damageParts: z.array(AttackLineDamagePart).min(1).max(EXTRA_DAMAGE_MAX).optional(),
});
export type AttackLogPayload = z.infer<typeof AttackLogPayload>;

/**
 * Compact per-die results `[value, kept]` (#140), as on the card (same limit, so whatever fits
 * the card fits the line); value null = a physical total of several dice.
 */
const CompactDice = z.array(CardDie).max(51);

/** FR-CBT-53 (b): the card's roll rows, DM-only (FR-DICE-28); a partial card lacks one. */
export const AttackLogRolls = z.strictObject({
  toHit: z
    .strictObject({
      expression: z.string().max(80),
      mode: z.enum(["normal", "advantage", "disadvantage"]),
      dice: CompactDice,
      constant: z.int(),
    })
    .optional(),
  damage: z
    .strictObject({
      expression: z.string().max(80),
      dice: CompactDice,
      constant: z.int(),
      crit: z.boolean(),
    })
    .optional(),
  /**
   * FR-CBT-84 (sprint 4): the extra weapon parts' rolls (card order), DM-only like the base
   * part's dice (rulings B4): `rolled` = dice + constant, `set` = the DM edited the value.
   */
  extra: z
    .array(
      z.strictObject({
        type: PartDamageType,
        expression: z.string().max(80),
        dice: CompactDice,
        constant: z.int(),
        rolled: z.int(),
        set: z.literal(true).optional(),
      }),
    )
    .min(1)
    .max(EXTRA_DAMAGE_MAX)
    .optional(),
});
export type AttackLogRolls = z.infer<typeof AttackLogRolls>;

/** FR-CBT-72: null = the card had no such roll (damage-only: no to-hit; to-hit-only: no damage). */
export const AttackLogDmPayload = z.strictObject({
  targetAc: z.int(),
  hitComputed: z.boolean().nullable(),
  toHitRolled: z.int().nullable(),
  damageRolled: z.int().nullable(),
  damageTotal: z.int(),
  applied: z.int(),
  overkill: z.int(),
  overrides: z.strictObject({ toHit: z.boolean(), hit: z.boolean(), damage: z.boolean() }),
  /** Old rows: absent. */
  rolls: AttackLogRolls.optional(),
  /** combat-extras (FR-CBTX-39): damage taken by temp HP; absent / 0 = none. DM only. */
  absorbed: z.int().min(0).optional(),
  /**
   * effect-modifiers (FR-MOD-20): the DM's names of the to-hit parts (same index as
   * `payload.toHit.mods`) and the damage parts, named, after the damage breakdown.
   */
  mods: z
    .strictObject({
      toHit: z.array(DmModPart).max(ROLL_MODS_MAX).optional(),
      damage: z.array(RollModPart).min(1).max(ROLL_MODS_MAX).optional(),
    })
    .optional(),
  /**
   * Apply hooks (`applyHooks`, R0; MOD lines R1 / R4): the DM's facts of `payload.parts` (same
   * index); tier 2 effective-AC parts (`targetAc` is then the effective AC) and the defense
   * preset. Absent = none.
   */
  parts: z.array(AttackLineDmPart).min(1).max(TRIGGER_PARTS_MAX).optional(),
  acMods: z.array(AcModPart).min(1).max(6).optional(),
  defense: DefenseFact.optional(),
  /**
   * FR-MOD-58 (sprint 4): the defense preset behind each extra part's multiplier, by type (only
   * the parts a defense applies to). Absent = none.
   */
  extraDefense: z
    .array(DefenseFact.extend({ type: PartDamageType }))
    .min(1)
    .max(EXTRA_DAMAGE_MAX)
    .optional(),
});
export type AttackLogDmPayload = z.infer<typeof AttackLogDmPayload>;

export const HpLogPayload = z.strictObject({
  targetName: z.string(),
  kind: z.enum(["damage", "heal"]),
  amount: z.int(),
});
export type HpLogPayload = z.infer<typeof HpLogPayload>;

export const HpLogDmPayload = z.strictObject({
  applied: z.int(),
  hpBefore: z.int(),
  hpAfter: z.int(),
  /** combat-extras (FR-CBTX-39): damage taken by temp HP; absent / 0 = none. */
  absorbed: z.int().min(0).optional(),
});

/** FR-CBTX-39: the DM line's "(3 absorbed by temp HP)"; players' line unchanged. */
const absorbedSegments = (dm: { absorbed?: number } | null | undefined): LineSegment[] =>
  dm?.absorbed ? [{ text: ` (${dm.absorbed} absorbed by temp HP)`, style: "muted" }] : [];

const MULT_TEXT = { normal: "", half: " (half)", none: " (none)", double: " (double)" } as const;

const PHYSICAL: LineSegment[] = [{ text: " " }, { text: "physical", style: "badge" }];

/** FR-CBT-57/58: the natural 1 / 20 a to-hit carries, else null. */
export function naturalMark(natural: number | null): 1 | 20 | null {
  return natural === 1 || natural === 20 ? natural : null;
}

/**
 * FR-CBT-58 (R4, #178): a ruling against a natural roll (hit on a natural 1, miss on a natural
 * 20) is public; built from `payload` alone (a natural roll ignores AC, so no AC fact leaks).
 */
export function publicRuling(natural: number | null, hit: boolean): boolean {
  return (natural === 1 && hit) || (natural === 20 && !hit);
}

/**
 * "6 slashing damage (half)", then the DM's "(DM set; rolled 4)" / dice breakdown; rule-trigger
 * parts after it (FR-MOD-48, R7): "14 slashing damage + 6 radiant (Divine Fury)" (`damage` =
 * weapon + parts, so the weapon's share is `damage` − Σ parts). FR-CBT-84 (sprint 4): extra
 * weapon parts after the base part, each with its own multiplier, then "damage": "15 slashing +
 * 4 fire (half) damage + 6 radiant (Divine Fury)"; the DM's line adds each part's "DM set" and
 * dice after it (players get no extra-part dice, rulings B4).
 */
function damageSegments(
  p: AttackLogPayload,
  dm: AttackLogDmPayload | null | undefined,
  suffix: string,
): LineSegment[] {
  const type = p.damageType ? ` ${p.damageType}` : "";
  const extra = p.damageParts ?? [];
  const sum = (xs: readonly { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);
  const weapon = p.damage - sum(p.parts ?? []) - sum(extra);
  const baseDm: LineSegment[] = [];
  if (dm?.overrides.damage) {
    const rolled = dm.damageRolled === null ? "" : `; rolled ${dm.damageRolled}`;
    baseDm.push({ text: ` (DM set${rolled})`, style: "muted" });
  }
  if (dm?.rolls?.damage) baseDm.push(...rollBreakdownSegments(dm.rolls.damage));
  if (dm?.mods?.damage) baseDm.push(...modSegments(dm.mods.damage));
  const out: LineSegment[] = [];
  if (extra.length === 0) {
    out.push({ text: `${weapon}${type} damage${MULT_TEXT[p.multiplier]}${suffix}` }, ...baseDm);
  } else {
    out.push({ text: `${weapon}${type}${MULT_TEXT[p.multiplier]}` }, ...baseDm);
    extra.forEach((x, i) => {
      out.push({ text: ` + ${x.value} ${x.type}${MULT_TEXT[x.multiplier ?? "normal"]}` });
      const r = dm?.rolls?.extra?.[i];
      if (r?.set) out.push({ text: ` (DM set; rolled ${r.rolled})`, style: "muted" });
      if (r) out.push(...rollBreakdownSegments(r));
    });
    out.push({ text: ` damage${suffix}` });
  }
  out.push(...linePartSegments(p.parts, dm?.parts, p.damageType));
  return out;
}

/**
 * FR-CBT-85 (BL-10, #245): the players' hit / miss words credit the DM on every line, ruled or
 * not (a ruling against a non-natural roll stays DM-only, #178 G8); the DM's line keeps its own.
 */
function outcomeText(hit: boolean, crit: boolean, ruled: boolean, dmView: boolean): string {
  if (ruled) return hit ? " — DM ruled hit " : " — DM ruled miss";
  if (dmView) return hit ? (crit ? " — critical hit! " : " — hit! ") : " — miss";
  return hit ? (crit ? " — DM: critical hit! " : " — DM: hit. ") : " — DM: miss";
}

/**
 * "Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage" (FR-CBT-24); "physical" after a
 * manual roll (FR-CBT-53 a), **one per line** (FR-CBT-73, item 12): both rolls manual → one at
 * the end; " (natural 1)" / " (natural 20)" after the to-hit, and "— DM ruled hit" / "— DM ruled
 * miss" for everyone when the hit contradicts the natural roll (FR-CBT-58). A damage-only card
 * (FR-CBT-73): "Mira → Goblin: 6 piercing damage (Light crossbow)"; a to-hit-only card applied as
 * a miss reads as any miss. DM only (FR-CBT-53 b, c; FR-DICE-28: built from `dmPayload` alone):
 * "(DM set; rolled 13)" after an edited total, kept / dropped d20s and the damage dice in a muted
 * run, "vs AC 15", and "— DM ruled hit" / "— DM ruled miss" when the DM overrode the hit of any
 * other roll.
 */
export const attackLogKind = defineLogKind<AttackLogPayload, z.infer<typeof AttackLogDmPayload>>({
  kind: LOG_KIND_ATTACK,
  payload: AttackLogPayload,
  dmPayload: AttackLogDmPayload,
  formatLine({ actorName, payload: p, dmPayload: dm }) {
    const out: LineSegment[] = [{ text: actorName, style: "actor" }];
    const t = p.toHit;
    // An edited total (dice null) is not the physical roll; a damage edit stays DM-only.
    const hitBadge = !!p.manual?.toHit && t !== null && t.dice !== null;
    const damageBadge = p.hit && !!p.manual?.damage;
    if (t === null) {
      out.push({ text: ` → ${p.targetName}: ` });
      if (!p.hit) return [...out, { text: `miss (${p.attackName})` }];
      out.push(...damageSegments(p, dm, ` (${p.attackName})`));
      if (damageBadge) out.push(...PHYSICAL);
      out.push(...absorbedSegments(dm));
      return out;
    }
    out.push({ text: ` attacks ${p.targetName}: ` });
    if (t.dice !== null) {
      out.push({ text: String(t.dice) });
      if (t.constant !== 0)
        out.push({ text: t.constant < 0 ? ` - ${-t.constant}` : ` + ${t.constant}` });
      // FR-MOD-20: "12 + 4 − 2 Bane = 14"; the DM's line names every part.
      out.push(...modSegments(t.mods, dm?.mods?.toHit));
      out.push({ text: " = " });
    }
    out.push({ text: String(t.total), style: "total" });
    // Both manual → the damage's badge (at the end) is the line's only one.
    if (hitBadge && !damageBadge) out.push(...PHYSICAL);
    const natural = naturalMark(t.natural);
    if (natural !== null) out.push({ text: ` (natural ${natural})` });
    if (dm) {
      if (dm.overrides.toHit) {
        out.push({ text: ` (DM set; rolled ${dm.toHitRolled})`, style: "muted" });
      }
      // Kept and dropped d20s: the public "d20 + modifier" already shows a single die.
      const r = dm.rolls?.toHit;
      if (r && r.mode !== "normal") out.push(...rollBreakdownSegments(r));
      out.push({ text: ` vs AC ${dm.targetAc}` });
    }
    const ruled = dm?.overrides.hit === true || publicRuling(t.natural, p.hit);
    out.push({ text: outcomeText(p.hit, p.crit, ruled, !!dm) });
    if (p.hit) {
      out.push(...damageSegments(p, dm, ""));
      if (damageBadge) out.push(...PHYSICAL);
      out.push(...absorbedSegments(dm));
    }
    return out;
  },
});

/** "DM — Mira takes 5 damage" / "DM — Mira heals 5". */
export const hpLogKind = defineLogKind<HpLogPayload, z.infer<typeof HpLogDmPayload>>({
  kind: LOG_KIND_HP,
  payload: HpLogPayload,
  dmPayload: HpLogDmPayload,
  formatLine({ actorName, payload: p, dmPayload: dm }) {
    return [
      { text: actorName, style: "actor" },
      { text: " — " },
      {
        text: p.kind === "damage" ? `${p.targetName} takes ` : `${p.targetName} heals `,
      },
      { text: String(p.amount), style: "total" },
      { text: p.kind === "damage" ? " damage" : " HP" },
      ...absorbedSegments(dm),
    ];
  },
});
