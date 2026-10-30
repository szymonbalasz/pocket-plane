// FR-CMP-34 search timing on `compendium-full` (full bundled SRD + `cmp-search-homebrew`): build the
// index once, then p95 per search (logged; budget 5 ms, fails above 50 ms). Run alone via
// `bun run bench`; freshness and ranking stay in ./search-s4.test.ts. FR-CMPX-22 then re-runs it
// on the same DB plus 6,300 synthetic book rows (invented words).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { bestOf, GATE_TIMEOUT, p95 } from "@shared/bench-kit";
import { SearchQuery } from "@shared/compendium/rest";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, compendiumEntry, compendiumSource } from "../../db/schema";
import { TEST_SECRET } from "../../testing/services";
import { searchEntries } from "./search";
import { dropSearchIndex, searchIndex } from "./search-index";
import type { EntryViewer } from "./visibility";

let db: Db;
let dir: string;
let cid: string;

beforeAll(async () => {
  const loaded = await loadBundle("compendium-full", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
}, 120_000);

afterAll(() => {
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

describe("FR-CMP-34 index", () => {
  test(
    "FR-CMP-34 timing over the full import: p95 per search (fail > 50 ms)",
    async () => {
      dropSearchIndex(db);
      const t0 = performance.now();
      searchIndex(db);
      const build = performance.now() - t0;
      const viewers: EntryViewer[] = [
        { role: "dm", campaignId: cid, playerId: null },
        { role: "player", campaignId: cid, playerId: "p" },
      ];
      const lines: string[] = [];
      let worst = 0;
      for (const v of viewers) {
        for (const q of ["", "a", "gob", "goblin", "fire", "potion heal", "the"]) {
          const query = SearchQuery.parse({ q });
          // Best batch of 30 (bench-kit `bestOf`).
          const ms = await bestOf(
            p95(() => {
              searchEntries(db, v, query);
            }, 30),
            50,
            3,
            1,
          );
          worst = Math.max(worst, ms);
          lines.push(`${v.role} "${q}" p95 ${ms.toFixed(2)} ms`);
        }
      }
      console.log(`FR-CMP-34 index build ${build.toFixed(1)} ms; ${lines.join("; ")}`);
      expect(worst).toBeLessThan(50);
    },
    GATE_TIMEOUT,
  );
});

const AT = "2026-01-01T00:00:00.000Z";
/** FR-CMPX-22 / compendium-expansion §12: ≈ every book imported. */
const SYNTHETIC = { monster: 3_800, spell: 525, item: 1_975 } as const;
const BOOKS = 27;
/** Entries that replace an SRD entry, about as measured on the 2014 build (FR-CMPX-13). */
const REPLACING = 1_100;

/** Deterministic words: common ones (search hits) + a large invented vocabulary. */
function syntheticWords() {
  let seed = 1;
  const next = (n: number) => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % n;
  };
  const syllables = "ba ke lor mi nu ost pra quen rho sil tar um vex wyn yar zo".split(" ");
  const word = () =>
    Array.from({ length: 2 + next(3) }, () => syllables[next(syllables.length)]).join("");
  const vocab = Array.from({ length: 6_000 }, word);
  const common = "the of a and to fire goblin creature hit damage saving throw action".split(" ");
  const text = (n: number) =>
    Array.from({ length: n }, () =>
      next(3) === 0 ? common[next(common.length)] : vocab[next(vocab.length)],
    ).join(" ");
  return { next, word, text };
}

function syntheticRows(srdKeys: readonly string[]) {
  const { next, word, text } = syntheticWords();
  const rows: (typeof compendiumEntry.$inferInsert)[] = [];
  let i = 0;
  for (const [kind, count] of Object.entries(SYNTHETIC) as [keyof typeof SYNTHETIC, number][]) {
    for (let k = 0; k < count; k++, i++) {
      const name = `${word()} ${word()}`;
      const facets =
        kind === "monster"
          ? { cr: "1", type: "fiend", size: "small" }
          : kind === "spell"
            ? {
                level: next(10),
                school: "evocation",
                classes: [],
                concentration: false,
                ritual: false,
              }
            : { category: "gear", attunement: false };
      rows.push({
        id: `syn-${i}`,
        campaignId: null,
        kind,
        source: `5et-syn${i % BOOKS}`,
        sourceKey: `${kind}/syn-${i}`,
        name,
        nameKey: name,
        line: `${kind} line`,
        facets,
        body: {},
        // Stat blocks run long, spells and items shorter (≈ 2.5 KB / 0.8 KB).
        searchText: text(kind === "monster" ? 400 : 120),
        dataHash: "h",
        replaces: i < REPLACING ? [`srd-5.1:${srdKeys[i % srdKeys.length]}`] : [],
        createdAt: AT,
        updatedAt: AT,
        importedAt: AT,
      });
    }
  }
  return rows;
}

describe("FR-CMPX-22 search cost", () => {
  test(
    "FR-CMPX-22 timing over SRD + 6,300 book rows with a hidden set: p95 per search (fail > 50 ms)",
    async () => {
      const srdKeys = db
        .select({ key: compendiumEntry.sourceKey })
        .from(compendiumEntry)
        .where(eq(compendiumEntry.source, "srd-5.1"))
        .all()
        .map((r) => r.key as string);
      const rows = syntheticRows(srdKeys);
      db.transaction((tx) => {
        for (let b = 0; b < BOOKS; b++) {
          tx.insert(compendiumSource)
            .values({
              key: `5et-syn${b}`,
              name: `Synthetic Book ${b}`,
              licence: "User-supplied (5etools)",
              attribution: "Invented.",
              version: "1",
              importedAt: AT,
              counts: {},
            })
            .run();
        }
        for (let i = 0; i < rows.length; i += 500) {
          tx.insert(compendiumEntry)
            .values(rows.slice(i, i + 500))
            .run();
        }
      });
      dropSearchIndex(db);
      const t0 = performance.now();
      const idx = searchIndex(db);
      const build = performance.now() - t0;
      const viewers: EntryViewer[] = [
        { role: "dm", campaignId: cid, playerId: null },
        { role: "player", campaignId: cid, playerId: "p" },
      ];
      const lines: string[] = [];
      let worst = 0;
      for (const v of viewers) {
        for (const q of ["", "a", "gob", "goblin", "fire", "potion heal", "the"]) {
          const query = SearchQuery.parse({ q });
          const ms = await bestOf(
            p95(() => {
              searchEntries(db, v, query);
            }, 30),
            50,
            3,
            1,
          );
          worst = Math.max(worst, ms);
          lines.push(`${v.role} "${q}" p95 ${ms.toFixed(2)} ms`);
        }
      }
      const hidden = idx.rows.filter((r) => r.hidden).length;
      console.log(
        `FR-CMPX-22 ${idx.rows.length} rows, ${hidden} hidden, index build ${build.toFixed(1)} ms; worst p95 ${worst.toFixed(2)} ms (budget 5); ${lines.join("; ")}`,
      );
      expect(hidden).toBeGreaterThan(0);
      expect(worst).toBeLessThan(50);
    },
    GATE_TIMEOUT * 2,
  );
});
