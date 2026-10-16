// Player view of `damage-card` (FR-CBT-30, FR-CBT-42): pending "Waiting for DM"; resolved one
// part per target, "Hit Goblin: 6 · Hit Goblin 2: 3 (half) · Miss" (applied incl. rule-trigger
// parts, FR-MOD-48). The card's offered parts muted after the damage (R7). No action.

import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { resolutionText } from "@shared/combat-tracker/rules";
import { DAMAGE_CARD_KIND, DamageCardResolutionRead } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { CardOffersText } from "@ui/features/effect-modifiers/card-offers";
import { defineNotificationView } from "@ui/features/notifications/views";
import { SwordIcon } from "lucide-react";

export function outcomeText(n: NotificationRecord): string {
  if (n.state === "pending") return "Waiting for DM";
  if (n.state === "dismissed") return "Dismissed";
  // Legacy single-target rows (from before the feedback pass) read as one part.
  const r = DamageCardResolutionRead.safeParse(n.resolution);
  return r.success ? resolutionText(r.data.targets) : "Resolved";
}

function PlayerCard({ notification: n }: { notification: NotificationRecord }) {
  return (
    <span className="flex flex-col">
      <CardOffersText notification={n} />
      <span
        data-testid="cbt-card-outcome"
        data-value={n.state}
        className="text-xs text-muted-foreground"
      >
        {outcomeText(n)}
      </span>
    </span>
  );
}

export const playerDamageCardView = defineNotificationView({
  kind: DAMAGE_CARD_KIND,
  icon: SwordIcon,
  render: PlayerCard,
  endRule: DAMAGE_CARD_END_RULE, // FR-CBT-59, same constant as the server kind
});
