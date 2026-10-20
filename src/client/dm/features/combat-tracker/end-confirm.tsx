// DM Start / End wiring shared by Encounters and Initiative: the End confirm's copy with the
// summon-token and charmed lines (FR-CBT-144) and the pending-card count (FR-CBT-59), and the windows that follow this tab's own Start / End
// (FR-CBT-60). Logic in `./start-end`.
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  type StartInput,
} from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { DialogDescription } from "@ui/components/ui/overlays";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { afterLayoutFrame } from "@ui/features/play-shell/content-heights";
import { noteAppearance } from "@ui/features/play-shell/free-area";
import { useWindowDispatch } from "@ui/features/play-shell/ShellContext";
import { useRecords } from "@ui/sync/store";
import { useCallback } from "react";
import { dmNotificationViews } from "../../notification-views";
import {
  END_FIRST_SENTENCE,
  endAndFollow,
  endCharmedText,
  endLeavers,
  endPendingCount,
  endPendingText,
  endSummonsText,
  startAndFollow,
} from "./start-end";

/**
 * "Combatants leave the initiative list." + FR-CBT-144's summon-token / charmed lines + "N pending
 * card(s) will be dismissed: …" (FR-CBT-59). `area` = the test-id prefix (`cbt-enc` / `cbt-init`).
 */
export function EndConfirmDescription({
  encounterId,
  area,
}: {
  encounterId: string;
  area: "cbt-enc" | "cbt-init";
}) {
  const notes = useRecords<NotificationRecord>("notification");
  const rows = useRecords<CombatantRecord>(COMBATANT_TYPE);
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const n = endPendingCount(notes, (kind) => dmNotificationViews.get(kind), encounterId);
  const { summons, charmed } = endLeavers(
    rows,
    encounterId,
    (id) => entities.find((e) => e.id === id)?.name,
  );
  return (
    <DialogDescription>
      {END_FIRST_SENTENCE}
      {summons.length > 0 && (
        <span className="block" data-testid={`${area}-end-summons`} data-value={summons.length}>
          {endSummonsText(summons)}
        </span>
      )}
      {charmed.map((c) => (
        <span key={`${c.owner}:${c.name}`} className="block" data-testid={`${area}-end-charmed`}>
          {endCharmedText(c)}
        </span>
      ))}{" "}
      <span data-testid={`${area}-end-pending`} data-value={n}>
        {endPendingText(n)}
      </span>
    </DialogDescription>
  );
}

/** `cbt.start` / `cbt.end` from this tab, followed by its window changes once acked. */
export function useStartEnd() {
  const { send, disabled } = useCbtIntent();
  const dispatch = useWindowDispatch();
  const start = useCallback(
    (body: StartInput) =>
      startAndFollow(() => send("cbt.start", body), {
        dispatch,
        noteAppearance,
        settle: afterLayoutFrame,
      }),
    [send, dispatch],
  );
  const end = useCallback(
    (encounterId: string) => endAndFollow(() => send("cbt.end", { encounterId }), { dispatch }),
    [send, dispatch],
  );
  return { start, end, disabled };
}
