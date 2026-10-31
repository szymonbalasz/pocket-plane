// FR-CMP-77: which compendium entry a sheet row's name is, by exact name, read over the search index
// (FR-CMP-34) with search's rules: visible to this viewer (FR-CMP-14), replaced entries left out
// (FR-CMPX-14). A name the viewer can't read gets no answer at all, like search.
import {
  type NameLookupBody,
  type NameLookupKind,
  type NameMatch,
  nameLookupKey,
} from "@shared/compendium/rest";
import { fold } from "@shared/search/match";
import type { Db } from "../../db/client";
import { searchIndex } from "./search-index";
import { type EntryViewer, entryVisibleTo } from "./visibility";

export function lookupNames(db: Db, v: EntryViewer, names: NameLookupBody["names"]): NameMatch[] {
  // A name with nothing to compare (punctuation only) folds to "" and matches nothing.
  const wanted = names.filter((n) => fold(n.name) !== "");
  if (wanted.length === 0) return [];
  const asked = new Map(wanted.map((n) => [nameLookupKey(n.kind, n.name), n]));
  const found = new Map<string, NameMatch>();
  for (const row of searchIndex(db).rows) {
    if (row.hidden || row.entryless || !entryVisibleTo(row, v)) continue;
    const key = `${row.kind}:${row.folded.folded}`;
    const n = asked.get(key);
    if (!n) continue;
    found.set(key, {
      kind: row.kind as NameLookupKind,
      name: n.name,
      entryId: found.has(key) ? null : row.id,
    });
  }
  return [...found.values()];
}
