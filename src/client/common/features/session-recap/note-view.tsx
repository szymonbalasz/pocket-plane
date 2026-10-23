// View of kind `session-recap` (FR-RECAP-23), both clients: icon `ScrollText`, the text and an Open
// button (`note-session-recap-open`; client-only, not an action) that opens the Recap on that
// session as a feature open (FR-RECAP-21): how a player offline at the time gets there.
import type { NotificationRecord } from "@shared/notifications/schemas";
import { SESSION_RECAP_KIND, SessionRecapPayload } from "@shared/session-recap/schemas";
import { ScrollTextIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { defineNotificationView } from "../notifications/views";
import { useOpenRecap } from "./open";

function SessionRecap({ notification: n }: { notification: NotificationRecord }) {
  const open = useOpenRecap();
  const p = SessionRecapPayload.safeParse(n.payload);
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{n.text}</span>
      {p.success ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          data-testid="note-session-recap-open"
          onClick={() => open(p.data.fromN, "feature")}
        >
          Open
        </Button>
      ) : null}
    </span>
  );
}

export const sessionRecapView = defineNotificationView({
  kind: SESSION_RECAP_KIND,
  icon: ScrollTextIcon,
  render: SessionRecap,
});
