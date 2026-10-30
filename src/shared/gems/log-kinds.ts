// Log-entry kinds `gem.award` (FR-GEM-09) and `gem.spend` (FR-GEM-12–16), both tagged with the
// `gems` feature (FR-DICE-69): while gems are off no viewer receives them. The entry's actor is the
// character; lines are public (OQ-GEM-02 A, OQ-GEM-10 A).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { MAX_DICE_PICKS } from "@shared/combat-tracker/schemas";
import { labelAfterActor } from "@shared/dice-roll-log/actor-label";
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { LABEL_MAX } from "@shared/dice-roll-log/schemas";
import { z } from "zod";
import {
  ActionUse,
  GEM_COUNT_MAX,
  GEM_DELTA_MAX,
  GEM_NAME,
  GemKind,
  LOG_KIND_GEM_AWARD,
  LOG_KIND_GEM_SPEND,
} from "./schemas";

export const GemAwardPayload = z.strictObject({
  characterId: z.string(),
  gem: GemKind,
  count: z.int().min(1).max(GEM_DELTA_MAX),
  held: z.int().min(0).max(GEM_COUNT_MAX),
});
export type GemAwardPayload = z.infer<typeof GemAwardPayload>;

/**
 * GEM §8: what a spend went on: `entry` = a rerolled log line (FR-GEM-19: its label and old total
 * `from`; `to` = the new total when the line states it); `card` = a damage card a Combat gem
 * maxed (FR-GEM-30: the attack's name, the damage rolled before and after).
 */
export const GemSpendTarget = z.strictObject({
  kind: z.enum(["entry", "card"]),
  id: z.string(),
  label: z.string().max(LABEL_MAX),
  from: z.int(),
  to: z.int().optional(),
});
export type GemSpendTarget = z.infer<typeof GemSpendTarget>;

/**
 * FR-GEM-30: one die a Combat gem maxed: "d8 3 → 8"; `part` names its damage type when the card
 * has more than one part ("fire d6 2 → 6").
 */
export const GemSpendDie = z.strictObject({
  part: z.string().min(1).max(20).optional(),
  faces: z.int().min(2).max(1000),
  from: z.int(),
  to: z.int(),
});
export type GemSpendDie = z.infer<typeof GemSpendDie>;
const SpendDice = z.array(GemSpendDie).min(1).max(MAX_DICE_PICKS);

/**
 * FR-GEM-13 (rulings-a #1): `target` (and a Combat gem's `dice`) take the target's audience. A public target → here; a
 * DM-only target (a hidden roll) → `null` here and the detail in `dmPayload`, so the public line
 * is just "Mira spends an Inspiration gem".
 */
export const GemSpendPayload = z.strictObject({
  characterId: z.string(),
  gem: GemKind,
  count: z.int().min(1).max(3),
  use: ActionUse.optional(),
  target: GemSpendTarget.nullable().optional(),
  dice: SpendDice.optional(),
});
export type GemSpendPayload = z.infer<typeof GemSpendPayload>;

/** FR-GEM-13: a DM-only target's detail (the DM's line reads it). */
export const GemSpendDmPayload = z.strictObject({
  target: GemSpendTarget,
  dice: SpendDice.optional(),
});
export type GemSpendDmPayload = z.infer<typeof GemSpendDmPayload>;

/** "an Inspiration gem" / "a Fortune gem" / "2 Action gems". */
export function gemsPhrase(gem: GemKind, count: number): string {
  const name = GEM_NAME[gem];
  if (count !== 1) return `${count} ${name} gems`;
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name} gem`;
}

const ACTION_TEXT: Record<ActionUse, string> = {
  bonus: "a bonus action",
  reaction: "a reaction",
  action: "a full action",
};

/** FR-GEM-14–16, OQ-GEM-06 A: what a plain spend is for (null: none, e.g. a later target spend). */
export function spendPurpose(p: Pick<GemSpendPayload, "gem" | "use">): string | null {
  switch (p.gem) {
    case "fortune":
      return "searching for treasure";
    case "divine":
      return "asks the gods a question";
    case "action":
      return p.use ? ACTION_TEXT[p.use] : null;
    case "inspiration":
      return "to recall";
    default:
      return null;
  }
}

/** FR-GEM-09: "DM awards Mira an Inspiration gem (2 held)". */
export const gemAwardKind = defineLogKind<GemAwardPayload>({
  kind: LOG_KIND_GEM_AWARD,
  feature: GEMS_FEATURE,
  payload: GemAwardPayload,
  formatLine({ actorName, payload: p }) {
    return [
      { text: "DM awards " },
      { text: actorName, style: "actor" },
      { text: ` ${gemsPhrase(p.gem, p.count)} (${p.held} held)` },
    ];
  },
});

/**
 * FR-GEM-19: "rerolls Perception (4)". FR-GEM-30: "Light crossbow: d8 3 → 8 (rolled 7 → 12)":
 * "rolled" because the DM may still apply a typed value (OQ-CBT-87 A).
 */
export function targetText(t: GemSpendTarget, dice?: readonly GemSpendDie[]): string {
  if (t.kind === "entry") return `rerolls ${t.label} (${t.from})`;
  const each = (dice ?? [])
    .map((d) => `${d.part ? `${d.part} ` : ""}d${d.faces} ${d.from} → ${d.to}`)
    .join(", ");
  return `${t.label}: ${each} (rolled ${t.from} → ${t.to ?? t.from})`;
}

/**
 * FR-GEM-14–16: "Brakka spends 2 Action gems — a full action"; FR-GEM-19: "Mira spends an
 * Inspiration gem — rerolls Perception (4)"; FR-GEM-13: a DM-only target → no detail for players.
 */
export const gemSpendKind = defineLogKind<GemSpendPayload, GemSpendDmPayload>({
  kind: LOG_KIND_GEM_SPEND,
  feature: GEMS_FEATURE,
  payload: GemSpendPayload,
  dmPayload: GemSpendDmPayload,
  formatLine({ actorName, payload: p, dmPayload }) {
    const detail = dmPayload?.target ? dmPayload : p;
    const target = detail.target;
    const purpose = target
      ? targetText({ ...target, label: labelAfterActor(target.label, actorName) }, detail.dice)
      : target === null
        ? null
        : spendPurpose(p);
    const out: LineSegment[] = [
      { text: actorName, style: "actor" },
      { text: ` spends ${gemsPhrase(p.gem, p.count)}` },
    ];
    if (purpose) out.push({ text: ` — ${purpose}` });
    return out;
  },
});
