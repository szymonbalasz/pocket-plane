// FR-SHARE-05 over real sockets on the `log-share` bundle: a share reaches the DM and every player
// live and in a fresh snapshot; a player can't reach the DM's homebrew; a reject sends nothing.
// FR-SHARE-08 CON-44: 100 of the longest shares grow a snapshot by a bounded amount.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { library, loadBundle } from "@fixtures/index";
import { SECRET_ITEM_NAME } from "@fixtures/units/compendium/cmp-homebrew";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { LogEntryShared } from "@shared/events/log-share";
import { SHARE_TEXT_MAX, SHARE_TO_LOG, type SharePayload } from "@shared/log-share/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, compendiumEntry, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { servicesFromBundle, snapshotSizes } from "../../ws/testing/snapshot-size";
import { loadInProcess } from "../fixtures-adapters/loader";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const entry = (c: TestClient, id: string) =>
  c.store.records[GAME_LOG_ENTRY_TYPE]?.[id] as GameLogEntryRecord | undefined;

async function nextShared(c: TestClient) {
  for (;;) {
    const e = await c.next("event", 1000);
    if (e.cause.name === LogEntryShared.type) return e;
  }
}

describe("FR-SHARE-05 share.toLog over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });
  const entryNamed = (name: string) =>
    db.select().from(compendiumEntry).where(eq(compendiumEntry.name, name)).get()?.id as string;

  beforeAll(async () => {
    const loaded = await loadBundle("log-share", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    h = await startTestServer({ db, fake: false });
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-SHARE-05 a player's share reaches the DM and the other player live; a fresh snapshot agrees", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    p1.intent(SHARE_TO_LOG, { from: "compendium", entryId: entryNamed("Moonblade Shard") }, "s1");
    const id = ((await p1.next("ack", 1000)).result as { entryId: string }).entryId;
    for (const c of [dm, p2]) {
      await nextShared(c);
      const e = entry(c, id);
      expect(e?.public).toBe(true);
      expect(e?.actorName).toBe("Mira");
      expect((e as GameLogEntryRecord).payload as SharePayload).toBeDefined();
      expect(((e as GameLogEntryRecord).payload as SharePayload).text).toContain(
        "sliver of a broken moonblade",
      );
    }
    expect(entry(p2, id)).not.toHaveProperty("dmPayload");
    expect(leakScan(h.s, p2)).toEqual([]);

    const fresh = await h.live(p("Player 2"));
    const seen = convergence(h.s, p2, fresh);
    expect(seen.live[GAME_LOG_ENTRY_TYPE]).toEqual(seen.fresh[GAME_LOG_ENTRY_TYPE] ?? {});
    for (const c of [dm, p1, p2, fresh]) c.close();
  });

  test("FR-SHARE-10 a player naming the DM's secret item is refused; no frame carries its text", async () => {
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const before = Object.keys(p2.store.records[GAME_LOG_ENTRY_TYPE] ?? {}).length;
    p1.intent(SHARE_TO_LOG, { from: "compendium", entryId: entryNamed(SECRET_ITEM_NAME) }, "no");
    expect(await p1.next("reject", 1000)).toMatchObject({ intentId: "no", code: "not_found" });
    expect(Object.keys(p2.store.records[GAME_LOG_ENTRY_TYPE] ?? {})).toHaveLength(before);
    expect(p1.raw()).not.toContain("the key to the vault");
    expect(p2.raw()).not.toContain("the key to the vault");
    p1.close();
    p2.close();
  });
});

describe("FR-SHARE-08 CON-44", () => {
  test("FR-SHARE-08 a window full of the longest shares grows a snapshot by ≤ 115 KB per viewer (64,000 of text + 100 rows, each about as big as a roll's)", async () => {
    const b = await servicesFromBundle(
      await loadInProcess(library, "log-share", { testMode: true }),
    );
    try {
      const db = b.s.db;
      const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
      const before = snapshotSizes(b.s);
      const seed = db
        .select()
        .from(compendiumEntry)
        .where(eq(compendiumEntry.name, "Moonblade Shard"))
        .get();
      if (!seed) throw new Error("no seed entry");
      db.insert(compendiumEntry)
        .values({
          ...seed,
          id: "share-huge",
          name: "Huge",
          nameKey: "huge",
          body: { typeLine: "Wondrous item", text: "x".repeat(SHARE_TEXT_MAX) },
        })
        .run();
      const actor = { role: "dm" as const, playerId: null, campaignId: cid };
      for (let i = 0; i < 100; i++) {
        b.s.commands.run(SHARE_TO_LOG, { from: "compendium", entryId: "share-huge" }, { actor });
      }
      const deltas = snapshotSizes(b.s).map((v, i) => v.bytes - (before[i]?.bytes ?? 0));
      console.log(`SHARE CON-44: at most +${Math.max(...deltas)} B per viewer`);
      for (const d of deltas) {
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(115_000);
      }
    } finally {
      b.cleanup();
    }
  }, 120_000);
});
