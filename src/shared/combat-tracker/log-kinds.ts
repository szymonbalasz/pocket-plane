// Log-entry kinds `cbt.attack` and `cbt.hp` (FR-CBT-24, FR-DICE-18). Public text = actors, roll
// + modifier, outcome, damage; AC, the computed hit and overrides stay in `dmPayload`.
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { z } from "zod";
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "./schemas";

const Multiplier = z.enum(["normal", "half", "none", "double"]);

export const AttackLogPayload = z.strictObject({
  targetName: z.string(),
  attackName: z.string(),
  damageType: z.string().nullable(),
  /** `dice` = rolled dice sum, null when the DM edited the total. */
  toHit: z.strictObject({
    dice: z.int().nullable(),
    constant: z.int(),
    total: z.int(),
    natural: z.int().nullable(),
  }),
  hit: z.boolean(),
  /** Damage dealt before HP clamping (`raw`). */
  damage: z.int(),
  multiplier: Multiplier,
  crit: z.boolean(),
});
export type AttackLogPayload = z.infer<typeof AttackLogPayload>;

export const AttackLogDmPayload = z.strictObject({
  targetAc: z.int(),
  hitComputed: z.boolean(),
  toHitRolled: z.int(),
  damageRolled: z.int(),
  damageTotal: z.int(),
  applied: z.int(),
  overkill: z.int(),
  overrides: z.strictObject({ toHit: z.boolean(), hit: z.boolean(), damage: z.boolean() }),
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
});

const MULT_TEXT = { normal: "", half: " (half)", none: " (none)", double: " (double)" } as const;

/** "Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage". */
export const attackLogKind = defineLogKind<AttackLogPayload, z.infer<typeof AttackLogDmPayload>>({
  kind: LOG_KIND_ATTACK,
  payload: AttackLogPayload,
  dmPayload: AttackLogDmPayload,
  formatLine({ actorName, payload: p, dmPayload }) {
    const out: LineSegment[] = [
      { text: actorName, style: "actor" },
      { text: ` attacks ${p.targetName}: ` },
    ];
    const t = p.toHit;
    if (t.dice !== null) {
      out.push({ text: String(t.dice) });
      if (t.constant !== 0)
        out.push({ text: t.constant < 0 ? ` - ${-t.constant}` : ` + ${t.constant}` });
      out.push({ text: " = " });
    }
    out.push({ text: String(t.total), style: "total" });
    if (p.hit) {
      out.push({ text: p.crit ? " — critical hit! " : " — hit! " });
      const type = p.damageType ? ` ${p.damageType}` : "";
      out.push({ text: `${p.damage}${type} damage${MULT_TEXT[p.multiplier]}` });
    } else {
      out.push({ text: " — miss" });
    }
    if (dmPayload) {
      out.push({ text: " " }, { text: `vs AC ${dmPayload.targetAc}`, style: "badge" });
    }
    return out;
  },
});

/** "DM — Mira takes 5 damage" / "DM — Mira heals 5". */
export const hpLogKind = defineLogKind<HpLogPayload, z.infer<typeof HpLogDmPayload>>({
  kind: LOG_KIND_HP,
  payload: HpLogPayload,
  dmPayload: HpLogDmPayload,
  formatLine({ actorName, payload: p }) {
    return [
      { text: actorName, style: "actor" },
      { text: " — " },
      {
        text: p.kind === "damage" ? `${p.targetName} takes ` : `${p.targetName} heals `,
      },
      { text: String(p.amount), style: "total" },
      { text: p.kind === "damage" ? " damage" : " HP" },
    ];
  },
});
