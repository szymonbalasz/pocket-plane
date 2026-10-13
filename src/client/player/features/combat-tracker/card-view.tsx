// Player view of `damage-card` (FR-CBT-30): pending "Waiting for DM"; resolved "Hit ‹target›:
// N damage" ("Hit: N damage" without a target name) / "Miss". The player has no action.
import { DAMAGE_CARD_KIND, DamageCardResolution } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { defineNotificationView } from "@ui/features/notifications/views";
import { SwordIcon } from "lucide-react";

export function outcomeText(n: NotificationRecord): string {
  if (n.state === "pending") return "Waiting for DM";
  if (n.state === "dismissed") return "Dismissed";
  const r = DamageCardResolution.safeParse(n.resolution);
  if (!r.success) return "Resolved";
  if (!r.data.hit) return "Miss";
  return r.data.targetName
    ? `Hit ${r.data.targetName}: ${r.data.applied} damage`
    : `Hit: ${r.data.applied} damage`;
}

function PlayerCard({ notification: n }: { notification: NotificationRecord }) {
  return (
    <span className="flex flex-col">
      <span>{n.text}</span>
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
});
