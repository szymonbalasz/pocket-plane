// BL-160 (FR-CMP-56's guarantee): the inverted text index and integer orders change no result, tier,
// order, cursor or group. `compendium-full` plus book-like rows (a hidden set, duplicate groups with
// a hidden member, homebrew groups) answers a fixed query corpus through `searchEntries` and through
// the path it replaced, kept here verbatim (per-row binary search, string tuples, group maps).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { type EntrySummary, HOMEBREW_LABEL, SearchQuery } from "@shared/compendium/rest";
import {
  type FoldedName,
  foldName,
  nameTier,
  queryWords,
  searchTier,
  textWordsOf,
  wordForms,
} from "@shared/search/match";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, compendiumEntry, compendiumSource } from "../../db/schema";
import { TEST_SECRET } from "../../testing/services";
import { decodeCursor, encodeCursor, groupLine, matchesFilters, searchEntries } from "./search";
import { dropSearchIndex, type IndexRow, type SearchIndex, searchIndex } from "./search-index";
import { bookAbbrOf } from "./sources/five-etools";
import { type EntryViewer, entryVisibleTo } from "./visibility";

// ---------- the old path, verbatim ----------

type WordHit = "start" | "inside" | null;

function oldNameHit(n: FoldedName, w: string): WordHit {
  const forms = wordForms(w);
  if (n.words.some((nw) => forms.some((f) => nw.startsWith(f)))) return "start";
  return forms.some((f) => n.folded.includes(f)) ? "inside" : null;
}

function oldLowerBound(words: readonly string[], w: string): number {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((words[mid] as string) < w) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function oldTextHit(textWords: readonly string[], w: string): boolean {
  if (w.length < 3) return false;
  return wordForms(w).some((f) => textWords[oldLowerBound(textWords, f)]?.startsWith(f) === true);
}

function oldTierOfName(n: FoldedName, words: readonly string[], hits: readonly WordHit[]) {
  const phrase = words.join(" ");
  if (n.folded === phrase) return 0;
  if (n.folded.startsWith(phrase)) return 1;
  if (hits.every((h) => h === "start")) return 2;
  return hits.every((h) => h !== null) ? 3 : null;
}

function oldNameTier(n: FoldedName, words: readonly string[]) {
  if (words.length === 0) return null;
  return oldTierOfName(
    n,
    words,
    words.map((w) => oldNameHit(n, w)),
  );
}

function oldSearchTier(name: FoldedName, textWords: readonly string[], words: readonly string[]) {
  if (words.length === 0) return null;
  const hits = words.map((w) => oldNameHit(name, w));
  if (hits.every((h) => h !== null)) return oldTierOfName(name, words, hits);
  if (!words.every((w, i) => hits[i] !== null || oldTextHit(textWords, w))) return null;
  return hits.some((h) => h !== null) ? 4 : 5;
}

type Key = [number, number, number, string, string];
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const oldRanked = (a: Key, b: Key) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || cmpStr(a[3], b[3]) || cmpStr(a[4], b[4]);
const oldByName = (a: Key, b: Key) => cmpStr(a[3], b[3]) || a[1] - b[1] || cmpStr(a[4], b[4]);

interface OldHit {
  row: IndexRow;
  tier: number;
  key: Key;
}

function oldFirstInOrder<T>(items: readonly T[], n: number, compare: (a: T, b: T) => number): T[] {
  const out: T[] = [];
  for (const x of items) {
    if (out.length === n && compare(x, out[n - 1] as T) >= 0) continue;
    let lo = 0;
    let hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(x, out[mid] as T) < 0) hi = mid;
      else lo = mid + 1;
    }
    out.splice(lo, 0, x);
    if (out.length > n) out.pop();
  }
  return out;
}

const abbrOf = bookAbbrOf(null);

function oldSummary(idx: SearchIndex, row: IndexRow): EntrySummary {
  const sourceLabel =
    row.source === null ? HOMEBREW_LABEL : (idx.labels.get(row.source) ?? row.source);
  const s: EntrySummary = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sourceLabel,
    line: row.line,
  };
  const abbr = row.source === null ? undefined : abbrOf(row.source, sourceLabel);
  if (abbr !== undefined) s.sourceAbbr = abbr;
  if (row.definitionId !== null) s.definitionId = row.definitionId;
  return s;
}

function oldRowTier(row: IndexRow, words: readonly string[]) {
  if (words.length === 0) return 0;
  return row.entryless
    ? oldNameTier(row.folded, words)
    : oldSearchTier(row.folded, textWordsById.get(row.id) ?? [], words);
}

function oldSearch(idx: SearchIndex, v: EntryViewer, query: SearchQuery, pageSize: number) {
  if (query.sameAs !== undefined) return oldSameAs(idx, v, query.sameAs, query.q);
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  if (v.role === "player" && query.kind === "monster") return { results: [], nextCursor: null };
  const words = queryWords(query.q ?? "");
  const compare = words.length === 0 ? oldByName : oldRanked;
  const hits: OldHit[] = [];
  const skipRules = query.kind === undefined && words.length === 0;
  const ruleNamesOnly = query.kind === undefined;
  for (const row of idx.rows) {
    if (row.hidden && (!query.definitionId || row.definitionId !== query.definitionId)) continue;
    if (query.kind !== undefined && row.kind !== query.kind) continue;
    if (skipRules && row.kind === "rule") continue;
    if (row.entryless && v.role !== "dm") continue;
    if (!entryVisibleTo(row, v) || !matchesFilters(row.facets, query)) continue;
    const tier =
      ruleNamesOnly && row.kind === "rule"
        ? oldNameTier(row.folded, words)
        : oldRowTier(row, words);
    if (tier === null) continue;
    const key: Key = [
      tier,
      row.rank,
      Math.min(row.folded.folded.length, 200),
      row.folded.folded.slice(0, 200),
      row.id,
    ];
    hits.push({ row, tier, key });
  }
  const members = new Map<string, OldHit[]>();
  for (const h of hits) {
    if (h.row.entryless) continue;
    const g = members.get(h.row.groupKey);
    if (g) g.push(h);
    else members.set(h.row.groupKey, [h]);
  }
  const items: { best: OldHit; group: OldHit[] | null }[] = [];
  for (const h of hits) {
    const g = h.row.entryless ? undefined : members.get(h.row.groupKey);
    if (!g || g.length === 1) items.push({ best: h, group: null });
    else if (g.every((m) => m === h || compare(h.key, m.key) < 0))
      items.push({ best: h, group: g });
  }
  const rest = after ? items.filter((x) => compare(x.best.key, after) > 0) : items;
  const top = oldFirstInOrder(rest, pageSize + 1, (a, b) => compare(a.best.key, b.best.key));
  const page = top.slice(0, pageSize);
  const last = page.at(-1);
  return {
    results: page.map(({ best, group }) => {
      const s = oldSummary(idx, best.row);
      if (group === null) return s;
      return {
        ...s,
        line: groupLine(group.map((m) => m.row)),
        group: { count: group.length },
      };
    }),
    nextCursor: top.length > pageSize && last ? encodeCursor(last.best.key) : null,
  };
}

function oldSameAs(idx: SearchIndex, v: EntryViewer, id: string, q: string | undefined) {
  const row = idx.byId.get(id);
  if (!row || row.entryless || row.hidden || !entryVisibleTo(row, v)) {
    return { results: [], nextCursor: null };
  }
  const words = queryWords(q ?? "");
  const members = (idx.groups.get(row.groupKey) ?? []).filter(
    (m) => entryVisibleTo(m, v) && oldRowTier(m, words) !== null,
  );
  members.sort((a, b) => cmpStr(a.line, b.line) || cmpStr(a.id, b.id));
  return { results: members.slice(0, 50).map((m) => oldSummary(idx, m)), nextCursor: null };
}

// ---------- the data ----------

const AT = "2026-01-01T00:00:00.000Z";
const BOOK = (i: number) => `5et-par${i % 3}`;

function bookLikeRows(srdKeys: readonly string[], cid: string) {
  let seed = 1;
  const next = (n: number) => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % n;
  };
  const syllables = "ba ke lor mi nu ost pra quen rho sil tar um vex wyn yar zo".split(" ");
  const word = () =>
    Array.from({ length: 2 + next(3) }, () => syllables[next(syllables.length)]).join("");
  const vocab = Array.from({ length: 300 }, word);
  const common = "the of a and to fire goblin creature hit damage saving throw action".split(" ");
  const text = (n: number) =>
    Array.from({ length: n }, () =>
      next(3) === 0 ? common[next(common.length)] : vocab[next(vocab.length)],
    ).join(" ");
  const base = { body: {}, dataHash: "h", createdAt: AT, updatedAt: AT, replaces: [] as string[] };
  const imported = { ...base, campaignId: null, importedAt: AT };
  const beast = { cr: "1", type: "fiend", size: "small" };
  const rows: (typeof compendiumEntry.$inferInsert)[] = [];
  for (let i = 0; i < 300; i++) {
    const kind = i % 3 === 0 ? "monster" : i % 3 === 1 ? "spell" : "item";
    const name = `${word()} ${word()}`;
    rows.push({
      ...imported,
      id: `par-${i}`,
      kind,
      source: BOOK(i),
      sourceKey: `${kind}/par-${i}`,
      name,
      nameKey: name,
      line: `${kind} line`,
      facets:
        kind === "monster"
          ? beast
          : kind === "spell"
            ? {
                level: next(10),
                school: "evocation",
                classes: [],
                concentration: false,
                ritual: false,
              }
            : { category: "gear", attunement: false },
      searchText: text(40),
      // FR-CMPX-14: about a sixth replace an SRD entry.
      replaces: i % 6 === 0 ? [`srd-5.1:${srdKeys[i % srdKeys.length]}`] : [],
    });
  }
  const dup = (
    id: string,
    kind: "monster" | "feature",
    name: string,
    line: string,
    facets: unknown,
    searchText: string,
    extra: Partial<typeof compendiumEntry.$inferInsert> = {},
  ) =>
    rows.push({
      ...imported,
      id,
      kind,
      source: "5et-par0",
      sourceKey: `${kind}/${id}`,
      name,
      nameKey: name,
      line,
      facets,
      searchText,
      ...extra,
    });
  // A group with a hidden member, which only a `definitionId` query brings back in.
  dup("dup-0", "monster", "Dup Beast", "a", beast, "dup beast hidden member", {
    definitionId: definitionIdOfSomeMonster,
  });
  dup("dup-1", "monster", "Dup Beast", "b", beast, "dup beast goblin");
  dup("dup-2", "monster", "dup-beast", "c", { ...beast, cr: "3" }, "dup beast fire");
  dup("dup-r", "monster", "Dup Replacer", "d", beast, "dup replacer", {
    replaces: ["5et-par0:monster/dup-0"],
  });
  // FR-CMP-35 line: classes, one member only under a fold of its accent.
  dup("f-0", "feature", "Dup Feature", "Fighter", { className: "Fighter" }, "dup feature fire");
  dup("f-1", "feature", "Dup Feature", "Wizard", { className: "Wizard" }, "dup feature the");
  dup("f-2", "feature", "Dúp Feature", "Bard", { className: "Bard" }, "dup feature");
  // A homebrew group: a player sees only the shared members.
  const gear = { category: "gear", attunement: false };
  const brew = (id: string, name: string, shared: boolean, searchText: string) =>
    rows.push({
      ...base,
      id,
      campaignId: cid,
      kind: "item",
      source: null,
      sourceKey: null,
      name,
      nameKey: name.toLowerCase(),
      line: id,
      facets: gear,
      searchText,
      shared,
    });
  brew("hb-0", "Home Brew", true, "home brew goblin");
  brew("hb-1", "Home-Brew", false, "home brew fire");
  brew("hb-2", "Home Brew!", true, "home brew");
  brew("hb-3", "Élan Vital", true, "élan vital l'esprit");
  return rows;
}

let db: Db;
let dir: string;
let cid: string;
let idx: SearchIndex;
let definitionIdOfSomeMonster: string;
const textWordsById = new Map<string, readonly string[]>();

beforeAll(async () => {
  const loaded = await loadBundle("compendium-full", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const srd = db
    .select({ key: compendiumEntry.sourceKey, def: compendiumEntry.definitionId })
    .from(compendiumEntry)
    .where(eq(compendiumEntry.source, "srd-5.1"))
    .all();
  definitionIdOfSomeMonster = srd.find((r) => r.def !== null)?.def as string;
  const rows = bookLikeRows(
    srd.map((r) => r.key as string),
    cid,
  );
  db.transaction((tx) => {
    for (let b = 0; b < 3; b++) {
      tx.insert(compendiumSource)
        .values({
          key: `5et-par${b}`,
          name: `Parity Book ${b}`,
          licence: "User-supplied (5etools)",
          attribution: "Invented.",
          version: "1",
          importedAt: AT,
          counts: {},
        })
        .run();
    }
    tx.insert(compendiumEntry).values(rows).run();
  });
  dropSearchIndex(db);
  idx = searchIndex(db);
  for (const r of db
    .select({ id: compendiumEntry.id, text: compendiumEntry.searchText })
    .from(compendiumEntry)
    .all()) {
    textWordsById.set(r.id, textWordsOf(r.text));
  }
}, 120_000);

afterAll(() => {
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

// ---------- the corpus ----------

const QUERIES = [
  "",
  "   ",
  "---",
  "a",
  "of",
  "gob",
  "goblin",
  "goblins",
  "GOBLIN!",
  "fire",
  "fires",
  "fire fire",
  "potion heal",
  "heal potion",
  "potions healing",
  "the",
  "the of and",
  "hunter's mark",
  "hunters mark",
  "cure wound",
  "ability score",
  "ability score improvement",
  "dragon red",
  "red dragon",
  "wolf dire",
  "ball",
  "xyzzy",
  "goblin xyzzy",
  "rho",
  "rhosil",
  "bak",
  "lor",
  "goblin fire",
  "fire goblin damage",
  "saving throw action",
  "élan",
  "esprit",
  "a b c d e f g h i j",
  "armor class",
  "cover",
  "half cover",
  "s",
  "ss",
  "bass",
  "dup",
  "dup beast",
  "dup feature",
  "home brew",
  "homebrew",
  "brew",
];
const FILTERS: Record<string, string>[] = [
  { kind: "monster" },
  { kind: "spell" },
  { kind: "item" },
  { kind: "condition" },
  { kind: "feature" },
  { kind: "rule" },
  { kind: "monster", crMin: "1" },
  { kind: "monster", crMax: "1/2" },
  { kind: "monster", crMin: "1", crMax: "5", type: "Humanoid" },
  { kind: "monster", type: "fiend" },
  { kind: "spell", level: "3" },
  { kind: "spell", school: "evocation" },
  { kind: "spell", className: "Wizard" },
  { kind: "spell", level: "0", className: "Cleric" },
  { kind: "item", category: "gear" },
  { kind: "item", rarity: "rare" },
  { kind: "feature", className: "Fighter" },
  { kind: "feature", subclass: "Champion" },
  { kind: "rule", chapter: "Combat" },
  { kind: "rule", section: "Cover" },
];
const FILTERED_QUERIES = ["", "a", "goblin", "fire", "potion heal", "the", "cover", "dup"];
const VIEWERS: Record<string, () => EntryViewer> = {
  dm: () => ({ role: "dm", campaignId: cid, playerId: null }),
  player: () => ({ role: "player", campaignId: cid, playerId: "p" }),
  "other campaign's DM": () => ({ role: "dm", campaignId: "no-such", playerId: null }),
  "other campaign's player": () => ({ role: "player", campaignId: "no-such", playerId: "p" }),
};

const each = (fn: (v: EntryViewer, who: string) => void) => {
  for (const [who, viewer] of Object.entries(VIEWERS)) fn(viewer(), who);
};

/** Walks the pages of a search through both paths, every page compared, byte for byte. */
function expectSame(v: EntryViewer, label: string, raw: Record<string, string>, pageSize = 50) {
  let cursor: string | undefined;
  let pages = 0;
  const seen: EntrySummary[] = [];
  do {
    const query = SearchQuery.parse(cursor === undefined ? raw : { ...raw, cursor });
    const now = searchEntries(db, v, query, pageSize);
    const old = oldSearch(idx, v, query, pageSize);
    expect({ label, pages, page: JSON.stringify(now) }).toEqual({
      label,
      pages,
      page: JSON.stringify(old),
    });
    seen.push(...now.results);
    cursor = now.nextCursor ?? undefined;
    pages++;
  } while (cursor !== undefined);
  return seen;
}

describe("BL-160 search parity with the old path", () => {
  test("BL-160 every query, viewer and page (+ a small page size): identical, incl. tiers 4 / 5, groups, entry-less rows", () => {
    const seen: EntrySummary[] = [];
    each((v, who) => {
      for (const q of QUERIES) {
        seen.push(...expectSame(v, `${who} q=${q}`, { q }));
        expectSame(v, `${who} q=${q} page 7`, { q }, 7);
      }
    });
    // The corpus keeps its reach: groups, an entry-less definition, homebrew, a book row.
    expect(seen.some((s) => s.group !== undefined)).toBe(true);
    const entryless = new Set(idx.rows.filter((r) => r.entryless).map((r) => r.id));
    expect(entryless.size).toBeGreaterThan(0);
    expect(seen.some((s) => entryless.has(s.id))).toBe(true);
    expect(seen.some((s) => s.sourceLabel === HOMEBREW_LABEL)).toBe(true);
    expect(seen.some((s) => s.id.startsWith("par-"))).toBe(true);
    expect(idx.rows.some((r) => r.hidden)).toBe(true);
  }, 120_000);

  test("BL-160 every kind and filter × queries: identical", () => {
    each((v, who) => {
      for (const f of FILTERS) {
        for (const q of FILTERED_QUERIES) {
          expectSame(v, `${who} q=${q} ${JSON.stringify(f)}`, { q, ...f });
        }
      }
    });
  }, 120_000);

  test("BL-160 cursors of no row (a deleted entry's, hand-made): identical", () => {
    const keys: [number, number, number, string, string][] = [
      [0, 0, 0, "", "a"],
      [2, 1, 10, "goblin", "zzz"],
      [3, 2, 12, "m", "m"],
      [5, 3, 200, "zzz", "zzz"],
      [4, 2, 5, "lorba", "par"],
      [1, 0, 7, "a", "0"],
    ];
    each((v, who) => {
      for (const q of ["", "goblin", "fire"]) {
        for (const k of keys) {
          const cursor = encodeCursor(k);
          expectSame(v, `${who} q=${q} ${cursor}`, { q, cursor });
        }
      }
    });
    const bad = SearchQuery.parse({ q: "a", cursor: "not-a-cursor" });
    expect(() => searchEntries(db, VIEWERS.dm?.() as EntryViewer, bad)).toThrow();
  });

  test("BL-160 sameAs: groups, plain rows, hidden, entry-less, unknown ids × q: identical", () => {
    const ids = [
      ...idx.rows.filter((r) => (idx.groups.get(r.groupKey)?.length ?? 0) >= 2).map((r) => r.id),
      ...idx.rows.filter((_, i) => i % 200 === 0).map((r) => r.id),
      ...idx.rows
        .filter((r) => r.hidden)
        .slice(0, 5)
        .map((r) => r.id),
      ...idx.rows.filter((r) => r.entryless).map((r) => r.id),
      "no-such-id",
    ];
    each((v, who) => {
      for (const id of ids) {
        for (const q of ["", "improvement", "goblin", "the", "xyzzy", "a", "dup beast"]) {
          expectSame(v, `${who} sameAs=${id} q=${q}`, { sameAs: id, q });
        }
      }
    });
    const group = expectSame(VIEWERS.dm?.() as EntryViewer, "group", { sameAs: "f-0" });
    expect(group.map((s) => s.id)).toEqual(["f-2", "f-0", "f-1"]);
  });

  test("BL-160 FR-CMPX-14 a hidden entry asked for by its definition: identical", () => {
    const hidden = idx.rows.filter((r) => r.hidden && r.definitionId !== null);
    expect(hidden.map((r) => r.id)).toContain("dup-0");
    each((v, who) => {
      for (const r of hidden.slice(0, 8)) {
        for (const q of ["", r.name, "the", "dup"]) {
          const raw = { kind: "monster", definitionId: r.definitionId as string, q };
          expectSame(v, `${who} definition of ${r.id} q=${q}`, raw);
        }
      }
    });
    // The group takes its hidden member in: a count the plain search doesn't have.
    const dm = VIEWERS.dm?.() as EntryViewer;
    const raw = { kind: "monster", q: "dup beast" };
    const plain = expectSame(dm, "plain", raw);
    const asked = expectSame(dm, "asked", { ...raw, definitionId: definitionIdOfSomeMonster });
    expect(plain.find((s) => s.name === "Dup Beast")?.group?.count).toBe(2);
    expect(asked.find((s) => s.name === "Dup Beast")?.group?.count).toBe(3);
  });

  test("BL-160 FR-CMP-54 one matcher: `nameTier` and `searchTier` = the old ones over every row × query", () => {
    for (const row of idx.rows) {
      const text = textWordsById.get(row.id) ?? [];
      for (const q of QUERIES) {
        const words = queryWords(q);
        expect({ id: row.id, q, tier: nameTier(row.name, words) }).toEqual({
          id: row.id,
          q,
          tier: oldNameTier(foldName(row.name), words),
        } as never);
        expect({ id: row.id, q, tier: searchTier(row.folded, text, words) }).toEqual({
          id: row.id,
          q,
          tier: oldSearchTier(row.folded, text, words),
        } as never);
      }
    }
  }, 120_000);
});
