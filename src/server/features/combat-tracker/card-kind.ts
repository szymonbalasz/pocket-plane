// Notification kind `damage-card` (protocol §23): created by `cbt.attack` via `notify`, resolved
// by `cbt.applyCard`, reopened by `cbt.undo`; never by `note.resolve` (#136). Resolution
// `{targets […]}` (1–20) is over notifications' 256 B default: the kind declares 8 KB (#157).
// Payload: a crit card with non-ASCII names passes the 1 KB default: 4 KB (#163). End rule:
// dismissed when its encounter ends (FR-CBT-59). Closing (sprint 5): a dismissal sends the
// card's hit-ruling delete (`onClose`, FR-CBT-91).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
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
import { withOffersText } from "@shared/effect-modifiers/combat-parts";
import { jsonBytes, type NotificationRecord, TEXT_MAX } from "@shared/notifications/schemas";
import type { FeatureTrace } from "../../ws/records";
import type { Roll } from "../dice-roll-log";
import { defineNotificationKind } from "../notifications/kind";
import { hitRulingChange, rulingOfCard } from "./rows";

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
  // FR-CBT-91 (sprint 5): a dismissed card (`note.dismiss`, End) takes its hit ruling off the
  // wire; the row stays.
  onClose: (env, row) => {
    const ruling = rulingOfCard(env.tx, row.id);
    return ruling ? [hitRulingChange(ruling, null)] : [];
  },
  // FR-GEM-05 / FR-CBT-131 (sprint 7, OQ-GEM-21 B): gems off → no `maxed` / `diceMaxed`.
  traces: [gemsCardTrace()],
});

/**
 * FR-GEM-05 / FR-CBT-131 (ADR-0058): while gems are off a damage card loses its maxed marks (the
 * dice and totals stay: the maxed values are the final roll). Pure; the same row when unmarked.
 */
export function gemsCardTrace(): FeatureTrace<NotificationRecord> {
  return {
    feature: GEMS_FEATURE,
    strip(r) {
      const p = r.payload as {
        diceMaxed?: true;
        damage?: { maxed?: number[]; extra?: { maxed?: number[] }[] } | null;
      } | null;
      if (!p?.diceMaxed) return r;
      const { diceMaxed: _x, ...rest } = p;
      const { maxed: _m, ...damage } = p.damage ?? {};
      const extra = p.damage?.extra?.map(({ maxed: _e, ...x }) => x);
      return {
        ...r,
        payload: { ...rest, damage: p.damage ? { ...damage, ...(extra ? { extra } : {}) } : null },
      };
    },
  };
}

/**
 * The card's text from its payload (FR-CBT-18, -57, -70, -71): full "Mira: 15 to hit, 6
 * piercing" (+ " (natural 20)" after the to-hit, " (critical)"); to-hit-only "Mira: 15 to hit
 * (Light crossbow)"; damage-only "Mira: 6 piercing (Light crossbow)" (+ " — DC 13 DEX").
 * Offered rule-trigger parts last (FR-MOD-48): "… 12 slashing (+ 6 radiant Divine Fury on a hit)".
 * FR-CBT-81 (sprint 4): extra weapon parts after the base part, "15 slashing + 8 fire"; within
 * FR-NOTE-21's cap: the offers collapse first, then the text is cut to 279 chars + "…".
 */
export function damageCardText(p: DamageCardPayload): string {
  const text = withOffersText(baseCardText(p), p.damage?.triggers, p.damageType, TEXT_MAX);
  return text.length <= TEXT_MAX ? text : `${text.slice(0, TEXT_MAX - 1)}…`;
}

/** "15 slashing + 8 fire": the base part's total, then each extra part's (FR-CBT-81). */
function damageText(p: DamageCardPayload): string {
  const type = p.damageType ? ` ${p.damageType}` : "";
  const extra = (p.damage?.extra ?? []).map((x) => ` + ${x.total} ${x.type}`).join("");
  return `${p.damage?.total ?? 0}${type}${extra}`;
}

function baseCardText(p: DamageCardPayload): string {
  const natural = p.toHit ? naturalMark(p.toHit.natural) : null;
  const toHit = p.toHit
    ? `${p.toHit.total} to hit${natural === null ? "" : ` (natural ${natural})`}`
    : "";
  if (p.toHit && p.damage) {
    return `${p.attackerName}: ${toHit}, ${damageText(p)}${p.crit ? " (critical)" : ""}`;
  }
  if (p.toHit) return `${p.attackerName}: ${toHit} (${p.attackName})`;
  const dc = p.saveDc ? ` — DC ${p.saveDc.dc} ${p.saveDc.ability.toUpperCase()}` : "";
  return `${p.attackerName}: ${damageText(p)} (${p.attackName})${dc}`;
}

/** FR-MOD-37 fit order: mod labels cut to this many chars + "…", then names to `NAME_CUT`. */
const MOD_LABEL_CUT = 12;
const NAME_CUT = 20;

const cut = (s: string, n: number) => {
  const chars = [...s];
  return chars.length <= n ? s : `${chars.slice(0, n).join("")}…`;
};

/**
 * FR-CBT-81, FR-MOD-37 (sprint 4): weapon parts never drop. A card still over the kind's 4 KB
 * after `withCardOffers` dropped offers loses its `unusedRolls` (FR-CBT-92), then gets its `mods[].label`s cut to 12 chars + "…", then
 * `attackerName` / `attackName` to 20 chars + "…" (multi-byte names, MOD §12).
 */
export function fitCardPayload(p: DamageCardPayload): DamageCardPayload {
  const fits = (x: DamageCardPayload) => jsonBytes(x) <= DAMAGE_CARD_PAYLOAD_MAX_BYTES;
  if (fits(p)) return p;
  // FR-CBT-92 (sprint 5): the unused rolls go first.
  if (p.unusedRolls) {
    const { unusedRolls: _, ...rest } = p;
    return fitCardPayload(rest);
  }
  const labels = <T extends { mods?: CardRoll["mods"] } | null>(r: T): T =>
    r?.mods
      ? {
          ...r,
          mods: r.mods.map((m) =>
            m.label === null ? m : { ...m, label: cut(m.label, MOD_LABEL_CUT) },
          ),
        }
      : r;
  const short: DamageCardPayload = { ...p, toHit: labels(p.toHit), damage: labels(p.damage) };
  if (fits(short)) return short;
  return {
    ...short,
    attackerName: cut(short.attackerName, NAME_CUT),
    attackName: cut(short.attackName, NAME_CUT),
  };
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
