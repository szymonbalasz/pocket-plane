// View of kind `handout-shared` (FR-PARTY-06, -09), both clients: scroll icon, the text ("New
// handout: ‹title›", kept after an unshare, OQ-PARTY-15) and an "Open" link that opens
// `party.handout` on it; a body load without the id there shows "No longer shared".
import type { NotificationRecord } from "@shared/notifications/schemas";
import { HANDOUT_SHARED_KIND } from "@shared/party-board/schemas";
import { ScrollIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { defineNotificationView } from "../notifications/views";
import { useOpenHandout } from "./HandoutList";
import { handoutIdOf } from "./logic";

function HandoutShared({ notification: n }: { notification: NotificationRecord }) {
  const open = useOpenHandout();
  const id = handoutIdOf(n.payload);
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{n.text}</span>
      {id && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          data-testid="party-note-open"
          data-record-id={id}
          onClick={() => open(id)}
        >
          Open
        </Button>
      )}
    </span>
  );
}

export const handoutSharedView = defineNotificationView({
  kind: HANDOUT_SHARED_KIND,
  icon: ScrollIcon,
  render: HandoutShared,
});
