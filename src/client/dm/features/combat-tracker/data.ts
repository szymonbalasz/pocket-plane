// DM read models for combat: definitions by id (AC, HP, CR, attack), the started encounter's
// pending damage cards and its latest undoable combat log entry. Display only; the server decides.
import {
  DAMAGE_CARD_KIND,
  HP_CHANGE_TYPE,
  type HpChangeRecord,
} from "@shared/combat-tracker/schemas";
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

/** Pending damage cards of an encounter, oldest first. */
export function usePendingCards(encounterId: string | null | undefined): NotificationRecord[] {
  const notes = useRecords<NotificationRecord>("notification");
  return useMemo(
    () =>
      notes
        .filter(
          (n) =>
            n.kind === DAMAGE_CARD_KIND &&
            n.state === "pending" &&
            (n.payload as { encounterId?: string } | null)?.encounterId === encounterId,
        )
        .sort((a, b) => a.seq - b.seq),
    [notes, encounterId],
  );
}

/** FR-CBT-25: the latest non-undone combat log entry of the encounter (by `seq`). */
export function useLatestUndoable(encounterId: string | null | undefined): HpChangeRecord | null {
  const rows = useRecords<HpChangeRecord>(HP_CHANGE_TYPE);
  return useMemo(
    () =>
      rows
        .filter((r) => r.encounterId === encounterId && !r.undone)
        .sort((a, b) => b.seq - a.seq)[0] ?? null,
    [rows, encounterId],
  );
}
