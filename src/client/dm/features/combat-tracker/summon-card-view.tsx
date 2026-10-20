// DM view of `cbt-summon-concentration` (FR-CBT-120, OQ-CBT-81 B): "Thorn lost concentration
// (Conjure Elemental): Fire Elemental 3". Action = Dismiss them (`cbt.dismiss {notificationId}`);
// view button Turn hostile (`cbt-summon-hostile`: `cbt.setCompanion` release + enemy for each
// summon still with its owner); the notification's own Dismiss keeps them. The server resolves
// the card once none is left; End closes a pending one (end rule).
import { CBT_INTENTS, COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import {
  SUMMON_CARD_KIND,
  SummonCardPayload,
  summonCardEndRule,
  summonCardOutcome,
} from "@shared/combat-tracker/summon-card-kind";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { Button } from "@ui/components/ui/button";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { defineNotificationView } from "@ui/features/notifications/views";
import { useSync } from "@ui/sync/store";
import { SparklesIcon, SwordsIcon } from "lucide-react";
import { companionIntent } from "./companion-menu";

/** The card's summons still with its owner (what Turn hostile acts on). */
export function cardSummonsLeft(n: Pick<NotificationRecord, "payload">, store: RecordStore) {
  const p = SummonCardPayload.safeParse(n.payload);
  if (!p.success) return [];
  const rows = store.records[COMBATANT_TYPE] ?? {};
  return p.data.combatantIds
    .map((id) => rows[id] as CombatantView | undefined)
    .filter(
      (c): c is CombatantView =>
        c !== undefined && c.active !== false && c.ownerCharacterId === p.data.ownerCharacterId,
    );
}

function SummonCardBody({ notification: n }: { notification: NotificationRecord }) {
  const store = useSync((s) => s.store);
  const { send, disabled } = useCbtIntent();
  const left = n.state === "pending" ? cardSummonsLeft(n, store) : [];
  const hostile = async () => {
    for (const c of left) {
      if ((await send(CBT_INTENTS.setCompanion, companionIntent.hostile(c))) === undefined) return;
    }
  };
  return (
    <span className="flex flex-col gap-1">
      <span>{n.text}</span>
      {n.state === "resolved" && (
        <span data-testid="cbt-summon-outcome" className="text-xs text-muted-foreground">
          {summonCardOutcome(n.resolution)}
        </span>
      )}
      {n.state === "dismissed" && (
        <span data-testid="cbt-summon-outcome" className="text-xs text-muted-foreground">
          Kept
        </span>
      )}
      {left.length > 0 && (
        <span>
          <Button
            size="sm"
            variant="outline"
            data-testid="cbt-summon-hostile"
            data-record-id={n.id}
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => void hostile()}
          >
            <SwordsIcon className="size-3.5" /> Turn hostile
          </Button>
        </span>
      )}
    </span>
  );
}

export const dmSummonCardView = defineNotificationView({
  kind: SUMMON_CARD_KIND,
  icon: SparklesIcon,
  render: SummonCardBody,
  // FR-NOTE-23: End dismisses a pending card (the End confirm counts it).
  endRule: summonCardEndRule,
  onAction(n, ctx) {
    return ctx.send(CBT_INTENTS.dismiss, { notificationId: n.id });
  },
});
