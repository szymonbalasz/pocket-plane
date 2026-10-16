// FR-CMP-17: creature lookups (FR-CBT-63 builder, Add dialog) take customs / characters from the
// store and imported monsters from the server (`kind=monster`, debounced 150 ms), merged in
// FR-ENT-18 order and ranked by FR-CBT-63 (≤ 8). CR / XP of the imported suggestions come from
// their definitions, loaded for the shown ones only (`useDefinitions`).
import type { EntrySummary } from "@shared/compendium/rest";
import { entityNameKey, xpForCr } from "@shared/entities/schemas";
import { useMemo } from "react";
import { type LookupRow, lookupMatches } from "../combat-tracker/lookup";
import { useDefinitions } from "./definitions";
import { badgeLabel } from "./logic";
import { type ApiSource, useCompendiumSearch } from "./search";

/** Badge of an SRD definition (as the Creatures window's read-only rows); others per `badgeLabel`. */
export const IMPORTED_BADGE = "SRD";

type Merged = LookupRow & { imported: boolean };

/** Imported monster results as lookup rows (id = the definition), CR / XP unknown yet. */
export function importedLookupRows(results: readonly EntrySummary[]): Merged[] {
  const out: Merged[] = [];
  for (const r of results) {
    if (r.kind !== "monster" || !r.definitionId) continue;
    out.push({
      id: r.definitionId,
      name: r.name,
      cr: null,
      xp: null,
      badge: badgeLabel(r.sourceLabel),
      imported: true,
    });
  }
  return out;
}

/** FR-ENT-18 order: name (case-insensitive), store before imported, then id. */
function entOrder(a: Merged, b: Merged): number {
  const ka = entityNameKey(a.name);
  const kb = entityNameKey(b.name);
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (a.imported !== b.imported) return a.imported ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Store rows + imported rows (deduplicated by id), FR-ENT-18 order, FR-CBT-63 ranked. */
export function mergeLookup(
  store: readonly LookupRow[],
  imported: readonly Merged[],
  q: string,
): Merged[] {
  const seen = new Set(store.map((r) => r.id));
  const rows: Merged[] = [
    ...store.map((r) => ({ ...r, imported: false })),
    ...imported.filter((r) => !seen.has(r.id)),
  ];
  return lookupMatches(rows.sort(entOrder), q);
}

/**
 * The lookup's suggestions for `q` (the input's text): `store` rows (customs, characters) from
 * the synced store, imported monsters from the server. Empty `q` → no request, no rows.
 */
export function useCreatureLookup(
  api: ApiSource,
  store: readonly LookupRow[],
  q: string,
): LookupRow[] {
  const text = q.trim();
  const search = useCompendiumSearch(api, { q: text, kind: "monster" }, { enabled: text !== "" });
  const imported = useMemo(() => importedLookupRows(search.page?.results ?? []), [search.page]);
  const shown = useMemo(() => mergeLookup(store, imported, text), [store, imported, text]);
  const ids = useMemo(() => shown.filter((r) => r.imported).map((r) => r.id), [shown]);
  const defs = useDefinitions(ids).byId;
  return useMemo(
    () =>
      shown.map(({ imported: isImported, ...r }) => {
        if (!isImported) return r;
        const d = defs.get(r.id);
        const cr = d?.kind === "monster" ? d.statBlock.cr : null;
        return { ...r, cr, xp: cr === null ? null : xpForCr(cr) };
      }),
    [shown, defs],
  );
}
