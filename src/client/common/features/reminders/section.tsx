// The sheet's Reminders tab (FR-CHARX-100–104; `sheet-sections.ts` line, `order: 80`, before
// Macros): this character's reminders, then the party's; rolls as this character; "Open in Party
// Manager". Full sheets only (the DM's, the owner's own); the count Badge shows once `reminder` is
// loaded. Not locked by the sheet lock (OQ-CHARX-46 A: reminders aren't sheet data).
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { Button } from "../../components/ui/button";
import type { SheetSection } from "../character-sheet/sections";
import { useOpenPartyTab } from "../party-board/open-tab";
import { RemindersWithLinks } from "../strongholds/links";
import { reminderCount } from "./logic";

/** The Party Manager tab id (FR-PARTY-71). */
export const REMINDERS_TAB = "reminders";

function RemindersSection({ creatureId }: { creatureId: string }) {
  const openPartyTab = useOpenPartyTab();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* RS2: the source link opens the Stronghold window (FR-REM-18). */}
      <RemindersWithLinks characterId={creatureId} />
      <Button
        type="button"
        data-testid="rem-sheet-open-party"
        size="sm"
        variant="ghost"
        className="h-7 self-start px-1 text-xs underline"
        onClick={() => openPartyTab(REMINDERS_TAB)}
      >
        Open in Party Manager
      </Button>
    </div>
  );
}

/** FR-CHARX-100: the DM always; a player on characters they own (full sheets). */
export function remindersAvailable(store: RecordStore, creatureId: string): boolean {
  const you = store.you;
  if (you?.role === "dm") return true;
  const c = store.records[ENTITY_TYPE]?.[creatureId] as
    | { kind?: string; ownerPlayerId?: string | null }
    | undefined;
  return c?.kind === "character" && !!you?.playerId && c.ownerPlayerId === you.playerId;
}

export const remRemindersSection: SheetSection = {
  id: "rem.reminders",
  slot: "tab",
  order: 80,
  title: "Reminders",
  kinds: ["character"],
  available: remindersAvailable,
  count: reminderCount,
  component: RemindersSection,
};
