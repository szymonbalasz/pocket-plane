// Notification kind `damage-card` (protocol §23): created by `cbt.attack` via `notify`, resolved
// by `cbt.applyCard`, reopened by `cbt.undo`; never by `note.resolve` (#136). Resolution
// `{targets […]}` (1–20) is over notifications' 256 B default: the kind declares 8 KB (#157).
// Payload: a crit card with non-ASCII names passes the 1 KB default: 4 KB (#163). End rule:
// dismissed when its encounter ends (FR-CBT-59).
import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { naturalMark } from "@shared/combat-tracker/log-kinds";
import {
  type CardRoll,
  type CardToHit,
  DAMAGE_CARD_KIND,
  DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  DamageCardPayload,
  DamageCardTargetsResolution,
} from "@shared/combat-tracker/schemas";
import type { Roll } from "../dice-roll-log";
import { defineNotificationKind } from "../notifications/kind";

/** Per-kind payload cap (FR-NOTE-03, #163): ASCII worst ≈ 950 B; 3-byte names ≈ 1.3 KB. */
export const DAMAGE_CARD_PAYLOAD_MAX_BYTES = 4096;

export const damageCardKind = defineNotificationKind({
  kind: DAMAGE_CARD_KIND,
  ownerSpec: "combat-tracker",
  payload: DamageCardPayload,
  payloadMaxBytes: DAMAGE_CARD_PAYLOAD_MAX_BYTES,
  resolution: DamageCardTargetsResolution,
  resolutionMaxBytes: DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  genericResolve: false,
  // FR-CBT-59: pending cards are dismissed when their encounter ends.
  endRule: DAMAGE_CARD_END_RULE,
});

/**
 * The card's text from its payload (FR-CBT-18, -57, -70, -71): full "Mira: 15 to hit, 6
 * piercing" (+ " (natural 20)" after the to-hit, " (critical)"); to-hit-only "Mira: 15 to hit
 * (Light crossbow)"; damage-only "Mira: 6 piercing (Light crossbow)" (+ " — DC 13 DEX").
 */
export function damageCardText(p: DamageCardPayload): string {
  const type = p.damageType ? ` ${p.damageType}` : "";
  const natural = p.toHit ? naturalMark(p.toHit.natural) : null;
  const toHit = p.toHit
    ? `${p.toHit.total} to hit${natural === null ? "" : ` (natural ${natural})`}`
    : "";
  if (p.toHit && p.damage) {
    return `${p.attackerName}: ${toHit}, ${p.damage.total}${type}${p.crit ? " (critical)" : ""}`;
  }
  if (p.toHit) return `${p.attackerName}: ${toHit} (${p.attackName})`;
  const dc = p.saveDc ? ` — DC ${p.saveDc.dc} ${p.saveDc.ability.toUpperCase()}` : "";
  return `${p.attackerName}: ${p.damage?.total ?? 0}${type} (${p.attackName})${dc}`;
}

/** A roll as the card stores it: per-die `[value, kept]` (#140). */
export function cardRollOf(r: Roll): CardRoll {
  return {
    rollId: r.id,
    dice: r.dice.map((d) => [d.value, d.kept] as [number | null, boolean]),
    constant: r.constant,
    total: r.total,
    manual: r.manual,
  };
}

export const cardToHitOf = (r: Roll): CardToHit => ({ ...cardRollOf(r), natural: r.natural });
