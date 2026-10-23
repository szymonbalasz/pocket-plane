// FR-REM-18 (RS1 ↔ RS2): REM's list with the source link icon, which opens the Stronghold window on
// the linked stronghold (`openStronghold`, FR-HOLD-23). Used by the Party Manager's Reminders tab
// and the sheet's Reminders section.
import type { ComponentProps } from "react";
import { RemindersTab } from "../reminders/RemindersTab";
import { useOpenStronghold } from "./memory";

export function RemindersWithLinks(props: Omit<ComponentProps<typeof RemindersTab>, "onOpenLink">) {
  const openStronghold = useOpenStronghold();
  return <RemindersTab {...props} onOpenLink={openStronghold} />;
}
