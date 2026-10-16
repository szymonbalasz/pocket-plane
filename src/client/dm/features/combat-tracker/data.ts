// DM read models for combat: definitions by id (AC, HP, CR, attack), the started encounter's
// pending damage cards and its latest undoable combat log entry. Display only; the server decides.
import {
  COMBATANT_TYPE,
  ENCOUNTER_ENTRY_TYPE,
  HP_CHANGE_TYPE,
  type HpChangeRecord,
} from "@shared/combat-tracker/schemas";
import type { DefinitionRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { useDefinitions as useDefinitionRecords } from "@ui/features/compendium/definitions";
import { useRecords } from "@ui/sync/store";
import { useMemo } from "react";
import { dmNotificationViews } from "../../notification-views";
import { pendingForEncounter } from "./pending";
import { undoLabel } from "./targets";

const NONE: readonly string[] = [];

/**
 * Definitions combat shows: every campaign row, plus the imported ones combat references (the
 * combatants' and encounter entries' definitions) and `extra` (e.g. a draft's or a dialog's
 * picks), loaded on demand (FR-CMP-16; until loaded they're absent).
 */
export function useDefinitions(extra: readonly string[] = NONE): Map<string, DefinitionRecord> {
  const combatants = useRecords<{ entityId?: string | null }>(COMBATANT_TYPE);
  const entries = useRecords<{ definitionId: string }>(ENCOUNTER_ENTRY_TYPE);
  const ids = useMemo(() => {
    const out = new Set<string>(extra);
    for (const c of combatants) if (c.entityId) out.add(c.entityId);
    for (const e of entries) out.add(e.definitionId);
    return [...out];
  }, [combatants, entries, extra]);
  return useDefinitionRecords(ids).byId;
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
