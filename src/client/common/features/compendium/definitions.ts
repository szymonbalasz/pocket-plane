// FR-CMP-16 `useDefinitions(ids)`: the one reader of creature definitions. Campaign `entity` rows
// come from the store (snapshot); imported ones (`imported-entity`, lazy by ids, FR-CMP-15) are
// loaded on demand: the DM sends the ids not in the store in `sync.load` (≤ 50 per call, again
// after each snapshot). A player never loads (the type is DM-only); the store is all they have.
// Only this file may read `imported-entity` from the store (boundary test, FR-CMP-16).
import {
  type DefinitionRecord,
  ENTITY_TYPE,
  EntityRecord,
  IMPORTED_ENTITY_TYPE,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import type { LazyStatus } from "@shared/protocol/lazy";
import { useMemo } from "react";
import { useLazyRecords, useRecords, useSync } from "../../sync/store";

export interface Definitions {
  /** Campaign definitions (every full `entity` row) + the loaded imported ones among `ids`. */
  byId: Map<string, DefinitionRecord>;
  /** Imported part: `ready` once every requested imported id is loaded (players: always). */
  state: LazyStatus;
  /** Loads the failed ids again (after `error`). */
  retry(): void;
}

const NO_IDS: readonly string[] = [];

/**
 * Ids to load as imported definitions: the DM's requested ids that aren't campaign rows. A
 * player loads none (FR-CMP-15: audience `dm`). Sorted and unique (a stable request key).
 */
export function importedIdsToLoad(
  role: "dm" | "player" | undefined,
  ids: readonly string[],
  campaignIds: ReadonlySet<string>,
): string[] {
  if (role !== "dm") return [];
  return [...new Set(ids)].filter((id) => id !== "" && !campaignIds.has(id)).sort();
}

/** Full campaign definitions by id (redacted / invalid rows are not definitions). */
export function campaignDefinitions(rows: readonly unknown[]): Map<string, DefinitionRecord> {
  const out = new Map<string, DefinitionRecord>();
  for (const r of rows) {
    const p = EntityRecord.safeParse(r);
    if (p.success) out.set(p.data.id, p.data);
  }
  return out;
}

export function useDefinitions(ids: readonly string[] = NO_IDS): Definitions {
  const role = useSync((s) => s.store.you?.role);
  const entities = useRecords<unknown>(ENTITY_TYPE);
  const campaign = useMemo(() => campaignDefinitions(entities), [entities]);
  const key = importedIdsToLoad(role, ids, new Set(campaign.keys())).join("\n");
  const want = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);
  const imported = useLazyRecords<unknown>(IMPORTED_ENTITY_TYPE, want);
  const byId = useMemo(() => {
    const out = new Map<string, DefinitionRecord>(campaign);
    for (const r of imported.rows) {
      const p = ImportedEntityRecord.safeParse(r);
      if (p.success) out.set(p.data.id, p.data);
    }
    return out;
  }, [campaign, imported.rows]);
  return { byId, state: imported.state, retry: imported.retry };
}
