// Log-entry kinds `cbt.attack` and `cbt.hp` (FR-CBT-24, FR-DICE-18). Public text = actors, roll
// + modifier, outcome, damage, "physical" tags; AC, the computed hit, overrides and the dice
// breakdown stay in `dmPayload` (FR-CBT-53, FR-DICE-28).
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { rollBreakdownSegments } from "@shared/dice-roll-log/roll-kind";
import { z } from "zod";
import { CardDie, LOG_KIND_ATTACK, LOG_KIND_HP } from "./schemas";

const Multiplier = z.enum(["normal", "half", "none", "double"]);

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

/** "6 slashing damage (half)", then the DM's "(DM set; rolled 4)" / dice breakdown. */
function damageSegments(
  p: AttackLogPayload,
  dm: AttackLogDmPayload | null | undefined,
  suffix: string,
): LineSegment[] {
  const type = p.damageType ? ` ${p.damageType}` : "";
  const out: LineSegment[] = [
    { text: `${p.damage}${type} damage${MULT_TEXT[p.multiplier]}${suffix}` },
  ];
  if (dm?.overrides.damage) {
    const rolled = dm.damageRolled === null ? "" : `; rolled ${dm.damageRolled}`;
    out.push({ text: ` (DM set${rolled})`, style: "muted" });
  }
  if (dm?.rolls?.damage) out.push(...rollBreakdownSegments(dm.rolls.damage));
  return out;
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
    if (p.hit) {
      out.push({ text: ruled ? " — DM ruled hit " : p.crit ? " — critical hit! " : " — hit! " });
      out.push(...damageSegments(p, dm, ""));
      if (damageBadge) out.push(...PHYSICAL);
      out.push(...absorbedSegments(dm));
    } else {
      out.push({ text: ruled ? " — DM ruled miss" : " — miss" });
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
