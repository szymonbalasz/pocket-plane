// Player view of `damage-card` (FR-CBT-30, FR-CBT-42): pending "Waiting for DM"; resolved one
// part per target, "Hit Goblin: 6 · Hit Goblin 2: 3 (half) · Miss" (applied incl. rule-trigger
// parts, FR-MOD-48). The card's offered parts muted after the damage (R7). Sprint 7: "Critical
// changed by a reroll — roll damage again" while a crit flip waits (FR-CBT-127); maxed dice with a
// "max" Badge (FR-CBT-131) and the card-action slot (FR-CBT-130, gems' Combat gem). Kit parity K3
// (FR-KIT-66): the maxed and outcome lines show their totals as small Result boxes.

import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { resolutionText } from "@shared/combat-tracker/rules";
import {
  CRIT_CHANGED_TEXT,
  critChanged,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  DamageCardResolutionRead,
  type DamageCardTargetOutcome,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { ResultBox } from "@ui/components/kit/result-box";
import {
  CardActions,
  cardPayload,
  MaxedDamage,
} from "@ui/features/combat-tracker/card-actions-row";
import { CardOffersText } from "@ui/features/effect-modifiers/card-offers";
import { defineNotificationView } from "@ui/features/notifications/views";
import { SwordIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

export function outcomeText(n: NotificationRecord): string {
  if (n.state === "pending") {
    // FR-CBT-127 (sprint 7): a reroll flipped the crit; the card waits for a new damage roll.
    const p = DamageCardPayload.safeParse(n.payload);
    return p.success && critChanged(p.data) ? CRIT_CHANGED_TEXT : "Waiting for DM";
  }
  if (n.state === "dismissed") return "Dismissed";
  // Legacy single-target rows (from before the feedback pass) read as one part.
  const r = DamageCardResolutionRead.safeParse(n.resolution);
  return r.success ? resolutionText(r.data.targets) : "Resolved";
}

/**
 * FR-KIT-66: one target's part of the outcome with its applied damage as a small Result box; the
 * text reads exactly `resolutionText` ("Hit Goblin: 6 (half)", "Miss Goblin 2").
 */
function targetPart(t: DamageCardTargetOutcome): ReactNode {
  const text = resolutionText([t]);
  if (!t.hit) return text;
  const head = text.slice(0, text.indexOf(": ") + 2);
  const tail = text.slice(head.length + String(t.applied).length);
  return (
    <>
      {head}
      <ResultBox value={t.applied} outcome="damage" size="sm" className="align-middle" />
      {tail}
    </>
  );
}

/** FR-KIT-66: the outcome line's content: the resolved parts with boxes, else `outcomeText`. */
export function outcomeContent(n: NotificationRecord): ReactNode {
  const r = n.state === "resolved" ? DamageCardResolutionRead.safeParse(n.resolution) : null;
  if (!r?.success) return outcomeText(n);
  return r.data.targets.map((t, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: targets in apply order, fixed once resolved
    <Fragment key={i}>
      {i > 0 ? " · " : ""}
      {targetPart(t)}
    </Fragment>
  ));
}

function PlayerCard({ notification: n }: { notification: NotificationRecord }) {
  const p = cardPayload(n);
  return (
    <span className="flex flex-col">
      <CardOffersText notification={n} />
      {/* FR-CBT-131 (sprint 7): maxed dice with their "max" Badge; none → nothing. */}
      {p && <MaxedDamage p={p} />}
      <span
        data-testid="cbt-card-outcome"
        data-value={n.state}
        className="text-xs text-muted-foreground"
      >
        {outcomeContent(n)}
      </span>
      {/* FR-CBT-130 (sprint 7): the card-action slot (gems' Combat gem); none → nothing. */}
      {n.state === "pending" && <CardActions card={n} client="player" />}
    </span>
  );
}

export const playerDamageCardView = defineNotificationView({
  kind: DAMAGE_CARD_KIND,
  icon: SwordIcon,
  render: PlayerCard,
  endRule: DAMAGE_CARD_END_RULE, // FR-CBT-59, same constant as the server kind
});
