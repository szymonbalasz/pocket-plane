// DM Start / End wiring shared by Encounters and Initiative: the End confirm's copy with the
// pending-card count (FR-CBT-59) and the windows that follow this tab's own Start / End
// (FR-CBT-60). Logic in `./start-end`.
import type { StartInput } from "@shared/combat-tracker/schemas";
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
  endPendingCount,
  endPendingText,
  startAndFollow,
} from "./start-end";

/** "Combatants leave the initiative list. N pending card(s) will be dismissed: …" (FR-CBT-59). */
export function EndConfirmDescription({
  encounterId,
  testId,
}: {
  encounterId: string;
  testId: "cbt-enc-end-pending" | "cbt-init-end-pending";
}) {
  const notes = useRecords<NotificationRecord>("notification");
  const n = endPendingCount(notes, (kind) => dmNotificationViews.get(kind), encounterId);
  return (
    <DialogDescription>
      {END_FIRST_SENTENCE}{" "}
      <span data-testid={testId} data-value={n}>
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
