// Dataset vs ledger (pure): filters, then the buckets. `locallyEdited` needs the stored entry,
// so it is split off `changed` later (`run.ts`); this module only compares hashes.
import type { Item } from "./dataset";
import { type Ledger, rowMapperVersion } from "./ledger";
import { MAPPER_VERSION } from "./map";

export interface Filters {
  name?: string;
  type?: string;
  rarity?: string;
  tag?: string;
  theme?: string;
  uids?: string[];
  limit?: number;
}

export const isFiltered = (f: Filters) => Object.values(f).some((v) => v !== undefined);

const fold = (s: string) => s.trim().toLowerCase();
const has = (list: readonly string[], v: string) => list.some((x) => fold(x) === fold(v));

/** The items `f` keeps; `limit` = the first n of them, in dataset order (a rerun picks the same). */
export function applyFilters(items: readonly Item[], f: Filters): Item[] {
  const kept = items.filter(
    (it) =>
      (f.name === undefined || fold(it.name).includes(fold(f.name))) &&
      (f.type === undefined || fold(it.type ?? "") === fold(f.type)) &&
      (f.rarity === undefined || has(it.rarities, f.rarity)) &&
      (f.tag === undefined || has(it.tags, f.tag)) &&
      (f.theme === undefined || has(it.treasureTheme, f.theme)) &&
      (f.uids === undefined || f.uids.includes(it.uid)),
  );
  return f.limit === undefined ? kept : kept.slice(0, f.limit);
}

export interface Diff {
  new: Item[];
  changed: Item[];
  unchanged: Item[];
  /** Ledger uids no longer in the dataset, not marked before (unfiltered runs only). */
  removed: string[];
}

export function diff(
  all: readonly Item[],
  ledger: Ledger,
  filters: Filters,
  mapperVersion = MAPPER_VERSION,
): Diff {
  const out: Diff = { new: [], changed: [], unchanged: [], removed: [] };
  for (const it of applyFilters(all, filters)) {
    const row = ledger.items[it.uid];
    if (!row) out.new.push(it);
    // Upstream content or the mapper (MAPPER_VERSION) changed since this row was written.
    else if (row.contentHash !== it.contentHash || rowMapperVersion(row) !== mapperVersion) {
      out.changed.push(it);
    }
    // Back after a removal with the same content: unchanged (apply clears `removedAt`).
    else out.unchanged.push(it);
  }
  if (!isFiltered(filters)) {
    const present = new Set(all.map((i) => i.uid));
    for (const [uid, row] of Object.entries(ledger.items)) {
      if (!present.has(uid) && row.removedAt === undefined) out.removed.push(uid);
    }
  }
  return out;
}
