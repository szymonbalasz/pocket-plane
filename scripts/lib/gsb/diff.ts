// Dataset vs ledger (pure): filters, then the buckets. `locallyEdited` needs the stored entry,
// so it is split off `changed` later (`run.ts`); this module only compares hashes.
import type { Item } from "./dataset";
import type { Ledger } from "./ledger";

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

/** The items `f` keeps (all but `limit`, which applies to the work list). */
export function applyFilters(items: readonly Item[], f: Filters): Item[] {
  return items.filter(
    (it) =>
      (f.name === undefined || fold(it.name).includes(fold(f.name))) &&
      (f.type === undefined || fold(it.type ?? "") === fold(f.type)) &&
      (f.rarity === undefined || has(it.rarities, f.rarity)) &&
      (f.tag === undefined || has(it.tags, f.tag)) &&
      (f.theme === undefined || has(it.treasureTheme, f.theme)) &&
      (f.uids === undefined || f.uids.includes(it.uid)),
  );
}

export interface Diff {
  new: Item[];
  changed: Item[];
  unchanged: Item[];
  /** Ledger uids no longer in the dataset, not marked before (unfiltered runs only). */
  removed: string[];
}

export function diff(all: readonly Item[], ledger: Ledger, filters: Filters): Diff {
  const out: Diff = { new: [], changed: [], unchanged: [], removed: [] };
  for (const it of applyFilters(all, filters)) {
    const row = ledger.items[it.uid];
    if (!row) out.new.push(it);
    else if (row.contentHash !== it.contentHash) out.changed.push(it);
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
