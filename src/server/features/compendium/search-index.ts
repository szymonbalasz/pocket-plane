// FR-CMP-34 search index: server-only, in memory, one row per compendium entry and per
// entry-less imported monster definition (FR-CMP-17), with folded name and text words. Built at
// the first search after start (per DB), dropped by a listener on the five compendium / imported-
// definition events and rebuilt at the next search, so a search never answers from rows older
// than the last commit. Derived, never persisted, never sent. Replaces the `instr` scan and the
// entry-less `LEFT JOIN` (≈ 50 ms on the DM's every search). Replaced entries (FR-CMPX-14) are
// derived here too, so import order doesn't matter: flagged `hidden`, out of `groups`.
import { type SourceRank, sourceRank } from "@shared/compendium/match";
import { type CompendiumKind, monsterLine } from "@shared/compendium/schemas";
import { MonsterStatBlock } from "@shared/entities/schemas";
import {
  CompendiumEntryDeleted,
  CompendiumEntrySaved,
  CompendiumImported,
} from "@shared/events/compendium";
import { EntityImported, ImportedEntityUpdated } from "@shared/events/entities";
import { type FoldedName, foldName, textWordsOf } from "@shared/search/match";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { compendiumEntry, compendiumSource, entity } from "../../db/schema";
import type { Listener } from "../../events/bus";

export interface IndexRow {
  id: string;
  kind: CompendiumKind;
  campaignId: string | null;
  shared: boolean;
  /** Imported source key; null = homebrew. */
  source: string | null;
  /** Imported provenance key (e.g. `rule/cover/cover`); null = homebrew or entry-less. */
  sourceKey: string | null;
  rank: SourceRank;
  facets: unknown;
  name: string;
  line: string;
  definitionId: string | null;
  /** Imported definition without an entry (FR-CMP-17): DM only, name tiers only, never grouped. */
  entryless: boolean;
  folded: FoldedName;
  /** Sorted unique folded words of `searchText` (name + line + body); empty when entry-less. */
  textWords: readonly string[];
  /** FR-CMP-35 duplicate group: kind + folded name + source (homebrew: its campaign). */
  groupKey: string;
  /** FR-CMPX-14: another imported entry replaces this one: no search, list, group or lookup. */
  hidden: boolean;
}

export interface SearchIndex {
  rows: readonly IndexRow[];
  byId: ReadonlyMap<string, IndexRow>;
  /** Group key → its rows (entries only). */
  groups: ReadonlyMap<string, readonly IndexRow[]>;
  /** Imported source key → its name ("SRD 5.1"). */
  labels: ReadonlyMap<string, string>;
}

/** FR-CMP-34: the events after which the index is stale. */
export const INDEX_EVENTS: readonly string[] = [
  EntityImported.type,
  ImportedEntityUpdated.type,
  CompendiumImported.type,
  CompendiumEntrySaved.type,
  CompendiumEntryDeleted.type,
];

const indexes = new WeakMap<Db, SearchIndex>();

const groupKeyOf = (
  kind: string,
  folded: string,
  source: string | null,
  campaignId: string | null,
) => JSON.stringify([kind, folded, source ?? `campaign:${campaignId ?? ""}`]);

/**
 * FR-CMPX-14: every ref some entry replaces, except refs on a cycle (malformed data: a self-ref,
 * two books replacing each other), which stay visible rather than vanish together.
 */
function hiddenRefs(edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const reachesItself = (start: string) => {
    const seen = new Set<string>();
    const todo = [...(edges.get(start) ?? [])];
    for (let r = todo.pop(); r !== undefined; r = todo.pop()) {
      if (r === start) return true;
      if (seen.has(r)) continue;
      seen.add(r);
      todo.push(...(edges.get(r) ?? []));
    }
    return false;
  };
  const hidden = new Set<string>();
  for (const refs of edges.values()) {
    for (const r of refs) if (!reachesItself(r)) hidden.add(r);
  }
  return hidden;
}

export function buildSearchIndex(db: Db): SearchIndex {
  const rows: IndexRow[] = [];
  const linked = new Set<string>();
  const edges = new Map<string, readonly string[]>();
  for (const r of db
    .select({
      id: compendiumEntry.id,
      campaignId: compendiumEntry.campaignId,
      kind: compendiumEntry.kind,
      name: compendiumEntry.name,
      line: compendiumEntry.line,
      facets: compendiumEntry.facets,
      source: compendiumEntry.source,
      sourceKey: compendiumEntry.sourceKey,
      definitionId: compendiumEntry.definitionId,
      shared: compendiumEntry.shared,
      searchText: compendiumEntry.searchText,
      replaces: compendiumEntry.replaces,
    })
    .from(compendiumEntry)
    .all()) {
    if (r.definitionId !== null) linked.add(r.definitionId);
    if (r.replaces.length > 0) edges.set(`${r.source}:${r.sourceKey}`, r.replaces);
    const folded = foldName(r.name);
    rows.push({
      id: r.id,
      kind: r.kind,
      campaignId: r.campaignId,
      shared: r.shared,
      source: r.source,
      sourceKey: r.sourceKey,
      rank: sourceRank(r.source),
      facets: r.facets,
      name: r.name,
      line: r.line,
      definitionId: r.kind === "monster" ? r.definitionId : null,
      entryless: false,
      folded,
      textWords: textWordsOf(r.searchText),
      groupKey: groupKeyOf(r.kind, folded.folded, r.source, r.campaignId),
      hidden: false,
    });
  }
  for (const d of db
    .select({
      id: entity.id,
      name: entity.name,
      statBlock: entity.statBlock,
      source: entity.source,
    })
    .from(entity)
    .where(and(isNull(entity.campaignId), eq(entity.kind, "monster")))
    .all()) {
    if (linked.has(d.id)) continue;
    const sb = MonsterStatBlock.safeParse(d.statBlock);
    if (!sb.success) continue;
    const source = d.source ?? "";
    const folded = foldName(d.name);
    rows.push({
      id: d.id,
      kind: "monster",
      campaignId: null,
      shared: false,
      source,
      sourceKey: null,
      rank: sourceRank(source),
      // Only CR filters apply; a `type` filter never matches (entryless rows carry CR only).
      facets: { cr: sb.data.cr },
      name: d.name,
      // FR-CMP-58 (BL-48): the core's type when it has one (FR-ENT-26), "CR 1/4 · Small" without.
      line: monsterLine(sb.data),
      definitionId: d.id,
      entryless: true,
      folded,
      textWords: [],
      groupKey: `definition:${d.id}`,
      hidden: false,
    });
  }
  const hidden = hiddenRefs(edges);
  const groups = new Map<string, IndexRow[]>();
  for (const r of rows) {
    if (r.sourceKey !== null && hidden.has(`${r.source}:${r.sourceKey}`)) {
      r.hidden = true;
      continue;
    }
    if (r.entryless) continue;
    const g = groups.get(r.groupKey);
    if (g) g.push(r);
    else groups.set(r.groupKey, [r]);
  }
  const labels = new Map(
    db
      .select({ key: compendiumSource.key, name: compendiumSource.name })
      .from(compendiumSource)
      .all()
      .map((s) => [s.key, s.name]),
  );
  return { rows, byId: new Map(rows.map((r) => [r.id, r])), groups, labels };
}

/** The DB's index, built now if dropped or never built. */
export function searchIndex(db: Db): SearchIndex {
  let idx = indexes.get(db);
  if (!idx) {
    idx = buildSearchIndex(db);
    indexes.set(db, idx);
  }
  return idx;
}

export function dropSearchIndex(db: Db): void {
  indexes.delete(db);
}

/** FR-CMP-34 listener: drops the index after any of `INDEX_EVENTS` (no state change, no frame). */
export function searchIndexListener(db: Db): Listener {
  return (e) => {
    if (INDEX_EVENTS.includes(e.event.type)) dropSearchIndex(db);
  };
}
