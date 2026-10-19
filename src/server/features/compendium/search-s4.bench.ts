// FR-CMP-34 search timing on `compendium-full` (full bundled SRD + `cmp-search-homebrew`): build the
// index once, then p95 per search (logged; budget 5 ms, fails above 50 ms). Run alone via
// `bun run bench`; freshness and ranking stay in ./search-s4.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { bestOf, GATE_TIMEOUT, p95 } from "@shared/bench-kit";
import { SearchQuery } from "@shared/compendium/rest";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign } from "../../db/schema";
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
