// CMP §13 fixtures (#455): bundle `item-present` from empty: `entry-present-1` opens the shared
// Moonlit Lantern on every Fixture Campaign player's screen (one `entry-present` row each, none in
// the second campaign), deterministic ids.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { compendiumEntry, entryPresent, player } from "@server/db/schema";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { CMP_IMAGES } from "./cmp-images";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

async function read() {
  const r = await loadBundle("item-present", { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  const lantern = db
    .select({ id: compendiumEntry.id, campaignId: compendiumEntry.campaignId })
    .from(compendiumEntry)
    .where(eq(compendiumEntry.name, CMP_IMAGES.lantern))
    .get();
  const out = {
    manifest: r.manifest,
    lantern,
    players: db.select().from(player).orderBy(asc(player.createdAt), asc(player.id)).all(),
    rows: db.select().from(entryPresent).orderBy(asc(entryPresent.playerId)).all(),
  };
  closeDb(db);
  return out;
}

describe("item-present fixtures (CMP §13, #455)", () => {
  test("FR-CMP-79 entry-present-1: Moonlit Lantern open for every Fixture Campaign player; deterministic", async () => {
    const a = await read();
    expect(a.manifest.fixtures).toEqual(
      expect.arrayContaining(["party-items-1", CMP_IMAGES.key, "entry-present-1"]),
    );
    const mine = a.players.filter((p) => p.campaignId === a.lantern?.campaignId);
    expect(mine.map((p) => p.name).sort()).toEqual(["Player 1", "Player 2"]);
    expect(a.rows.map((r) => [r.playerId, r.entryId])).toEqual(
      mine.map((p) => [p.id, a.lantern?.id as string]).sort(),
    );
    expect(a.manifest.records["entry-present-1"]?.["entry-present"]).toHaveLength(2);
    const b = await read();
    expect(b.rows.map((r) => r.id)).toEqual(a.rows.map((r) => r.id));
  }, 120_000);
});
