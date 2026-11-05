// FR-NOTES-22 search timing at both caps (ADR-0078 "Limits and load": ≤ 1,000 live notes ×
// 32 KiB, target ≤ 50 ms): the `notes` bundle grown to 1,000 live notes of 32 KiB in the main
// campaign, and the same again in `campaign-second`. Cold = the first search after a restart
// (every note's words read and cached; reported, fails only past 15 s); warm = p95 per search
// after that (fails above 50 ms).
// Isolation: the main campaign's warm search with the second campaign empty, then at the caps.
// Run alone via `bun run bench`; results and ranking stay in ./search.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { best, bestOf, GATE_TIMEOUT, logResults, p95 } from "@shared/bench-kit";
import { NOTE_BODY_MAX_BYTES, NOTE_LIVE_MAX } from "@shared/linked-notes/schemas";
import { fold } from "@shared/search/match";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note } from "../../db/schema";
import type { Services } from "../../services";
import { createTestServices } from "../../testing/services";
import { dropNoteSearchIndex, runNoteSearch } from "./search";

const AT = "2026-03-01T00:00:00.000Z";
/** Cold is reported, and only fails far off (a restart's first search, at both caps). */
const COLD_BUDGET = 15_000;
const QUERIES = [
  "the",
  "dragon",
  "gold coins",
  "zz",
  "notfoundanywhere",
  "captain of the guard",
  "lo",
  "Note 0042",
];

/** Deterministic note-like text: common words, a few names, an invented vocabulary. */
function textMaker() {
  let seed = 7;
  const next = (n: number) => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % n;
  };
  const syl = "ba ke lor mi nu ost pra quen rho sil tar um vex wyn yar zo".split(" ");
  const word = () => Array.from({ length: 2 + next(3) }, () => syl[next(syl.length)]).join("");
  const vocab = Array.from({ length: 8_000 }, word);
  const common =
    "the of a and to in is was he she they gold coins dragon captain guard tavern map key door".split(
      " ",
    );
  /** About `bytes` of text (ASCII), in lines. */
  const text = (bytes: number) => {
    const out: string[] = [];
    let n = 0;
    while (n < bytes - 16) {
      const w = next(2) === 0 ? common[next(common.length)] : vocab[next(vocab.length)];
      const sep = next(14) === 0 ? ".\n" : " ";
      out.push(w as string, sep);
      n += (w as string).length + sep.length;
    }
    return out.join("");
  };
  return text;
}

function fill(db: Db, cid: string, prefix: string, count: number, text: (b: number) => string) {
  db.transaction((tx) => {
    for (let i = 0; i < count; i++) {
      const title = `Note ${String(i).padStart(4, "0")} ${prefix}`;
      const body = text(NOTE_BODY_MAX_BYTES);
      tx.insert(note)
        .values({
          id: `${prefix}-${i}`,
          campaignId: cid,
          title,
          titleFold: fold(title),
          createdByRole: "dm",
          createdAt: AT,
          updatedAt: AT,
          updatedByRole: "dm",
          body,
          bodyFold: fold(body),
        })
        .run();
    }
  });
}

let db: Db;
let dir: string;
let s: Services;
let main: string;
let second: string;

beforeAll(async () => {
  const loaded = await loadBundle("notes", { dmSecret: "bench-secret-123", testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  const camps = Object.fromEntries(
    db
      .select()
      .from(campaign)
      .all()
      .map((c) => [c.name, c.id]),
  );
  main = camps["Fixture Campaign"] as string;
  second = camps["Second Campaign"] as string;
  const live = db
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.campaignId, main), isNull(note.deletedAt)))
    .all().length;
  fill(db, main, "main", NOTE_LIVE_MAX - live, textMaker());
  s = createTestServices({ db });
}, 120_000);

afterAll(() => {
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

async function warm(cid: string): Promise<Record<string, number>> {
  runNoteSearch(s, cid, "warm");
  const out: Record<string, number> = {};
  for (const q of QUERIES) {
    out[`"${q}" p95 ms`] = await bestOf(
      p95(() => {
        runNoteSearch(s, cid, q);
      }, 20),
      50,
      3,
      1,
    );
  }
  return out;
}

describe("FR-NOTES-22 search at the caps", () => {
  test(
    "FR-NOTES-22 1,000 live notes × 32 KiB: cold and warm per search (fail > 50 ms warm)",
    async () => {
      const r = runNoteSearch(s, main, "the");
      expect(r.scanned).toBe(NOTE_LIVE_MAX);
      expect(r.response.results).toHaveLength(50);
      const cold = await best(
        () => {
          dropNoteSearchIndex(s);
          runNoteSearch(s, main, "dragon");
        },
        COLD_BUDGET,
        3,
        0,
      );
      const second0 = await warm(main);
      // The second campaign at the caps too: the main campaign's searches don't move.
      fill(db, second, "second", NOTE_LIVE_MAX - 1, textMaker());
      dropNoteSearchIndex(s);
      const coldAfter = await best(
        () => {
          dropNoteSearchIndex(s);
          runNoteSearch(s, main, "dragon");
        },
        COLD_BUDGET,
        3,
        0,
      );
      const second1000 = await warm(main);
      logResults("FR-NOTES-22 note search, 1,000 × 32 KiB (second campaign empty)", {
        "cold first search ms": cold,
        ...second0,
      });
      logResults("FR-NOTES-22 note search, 1,000 × 32 KiB (second campaign also at the caps)", {
        "cold first search ms": coldAfter,
        ...second1000,
      });
      for (const v of [...Object.values(second0), ...Object.values(second1000)])
        expect(v).toBeLessThan(50);
      expect(Math.max(cold, coldAfter)).toBeLessThan(COLD_BUDGET);
    },
    GATE_TIMEOUT * 3,
  );
});
