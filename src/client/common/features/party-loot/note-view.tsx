// View of kind `loot-received` (FR-LOOT-14), both clients: coins icon; the generic text plus
// " (edited)" while the entry is in the store and edited, and an "Open" link to the Party window's
// Loot tab (FR-LOOT-22).
import type { NotificationRecord } from "@shared/notifications/schemas";
import { LOOT_ENTRY_TYPE, LOOT_RECEIVED_KIND } from "@shared/party-loot/schemas";
import { CoinsIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { defineNotificationView } from "../notifications/views";
import { useOpenPartyTab } from "../party-board/open-tab";
import { editedSuffix } from "./logic";

function LootReceived({ notification: n }: { notification: NotificationRecord }) {
  const entries = useSync((s) => s.store.records[LOOT_ENTRY_TYPE]);
  const openPartyTab = useOpenPartyTab();
  return (
    <span className="flex flex-col items-start gap-1">
      <span>
        {n.text}
        {editedSuffix(n.payload, entries)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5"
        data-testid="loot-note-open"
        onClick={() => openPartyTab("loot")}
      >
        Open
      </Button>
    </span>
  );
}

export const lootReceivedView = defineNotificationView({
  kind: LOOT_RECEIVED_KIND,
  icon: CoinsIcon,
  render: LootReceived,
});
