// DM read models for combat: definitions by id (AC, HP, CR, attack), the started encounter's
// pending damage cards and its latest undoable combat log entry. Display only; the server decides.
import { HP_CHANGE_TYPE, type HpChangeRecord } from "@shared/combat-tracker/schemas";
import {
  type DefinitionRecord,
  ENTITY_TYPE,
  EntityRecord,
  IMPORTED_ENTITY_TYPE,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { useRecords } from "@ui/sync/store";
import { useMemo } from "react";
import { dmNotificationViews } from "../../notification-views";
import { pendingForEncounter } from "./pending";
import { undoLabel } from "./targets";

export function useDefinitions(): Map<string, DefinitionRecord> {
  const entities = useRecords<unknown>(ENTITY_TYPE);
  const imported = useRecords<unknown>(IMPORTED_ENTITY_TYPE);
  return useMemo(() => {
    const out = new Map<string, DefinitionRecord>();
    for (const r of entities) {
      const p = EntityRecord.safeParse(r);
      if (p.success) out.set(p.data.id, p.data);
    }
    for (const r of imported) {
      const p = ImportedEntityRecord.safeParse(r);
      if (p.success) out.set(p.data.id, p.data);
    }
    return out;
  }, [entities, imported]);
}

/**
 * Pending notifications of an encounter, oldest first (FR-CBT-79): damage cards and any kind
 * whose DM view links it to the encounter (FR-NOTE-29).
 */
export function usePendingCards(encounterId: string | null | undefined): NotificationRecord[] {
  const notes = useRecords<NotificationRecord>("notification");
  return useMemo(
    () => pendingForEncounter(notes, encounterId, dmNotificationViews),
    [notes, encounterId],
  );
}

/** FR-CBT-25 / FR-CBT-35: the encounter's undo unit (one apply) as Tooltip text + expected id. */
export function useUndo(encounterId: string | null | undefined) {
  const rows = useRecords<HpChangeRecord>(HP_CHANGE_TYPE);
  return useMemo(
    () => undoLabel(rows.filter((r) => r.encounterId === encounterId)),
    [rows, encounterId],
  );
}
