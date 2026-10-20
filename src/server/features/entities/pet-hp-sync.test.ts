// Sprint 6 CP1 (FR-ENT-36 / -37) over real sockets on `companions` without CP3's `cp-combat` (the
// pets stay out of the fight; Town active: no pet present).
// `player-1` adjusts the Owlbear's kept HP; `player-2` gets nothing while it isn't present, the
// redacted row with its band once its scene is shown, never a number; `player-2`'s own adjust is
// rejected; snapshots before and after reconnect pass the leak scan.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { library } from "@fixtures/index";
import { PET_ADJUST_HP } from "@shared/entities/pet-hp";
import { ENTITY_TYPE, RedactedPet } from "@shared/entities/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { and, eq, isNotNull } from "drizzle-orm";
import { closeDb, openFileDb } from "../../db/client";
import { entity, player, scene } from "../../db/schema";
import { startTestServer, type TestClient } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { defineBundle, type FixtureLibrary } from "../fixtures-adapters/fixture-types";
import { loadInProcess } from "../fixtures-adapters/loader";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const entityOf = (c: TestClient, id: string) =>
  c.store.records[ENTITY_TYPE]?.[id] as Record<string, unknown> | undefined;
/**
 * Every Owlbear row `c` ever received (snapshots and event changes): for a non-owner each must be
 * exactly the redacted whitelist (strict: no `hpCurrent`, `statBlock`, `turnMode`, …).
 */
const rowsOf = (c: TestClient, id: string): unknown[] =>
  c.frames.flatMap((f) => {
    if (f.type === "snapshot") {
      return ((f.records[ENTITY_TYPE] ?? []) as { id: string }[]).filter((r) => r.id === id);
    }
    if (f.type === "event") {
      return f.changes.flatMap((ch) =>
        ch.type === ENTITY_TYPE && ch.id === id && ch.op === "upsert" ? [ch.data] : [],
      );
    }
    return [];
  });
const redactedOnly = (c: TestClient, id: string) => {
  const rows = rowsOf(c, id);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(RedactedPet.safeParse(r).success).toBe(true);
};

/** `companions` before CP3's `cp-combat` joins the pets to the running fight. */
const PETS_OUT = defineBundle({
  name: "test-companions-pets-out",
  includes: ["late-damage"],
  fixtures: ["cp-srd", "pet-owlbear", "pet-drake"],
});
const lib: FixtureLibrary = { ...library, bundles: [...library.bundles, PETS_OUT] };

describe("FR-ENT-36 pet.adjustHp over WS (companions)", () => {
  let loaded: Awaited<ReturnType<typeof loadInProcess>>;
  let db: ReturnType<typeof openFileDb>;
  let h: Awaited<ReturnType<typeof startTestServer>>;
  let owlbear: string;
  let tokens: Record<string, string>;
  let ambush: string;

  beforeAll(async () => {
    loaded = await loadInProcess(lib, PETS_OUT.name, { dmSecret: TEST_SECRET, testMode: true });
    db = openFileDb(loaded.config.dbPath);
    owlbear = db
      .select()
      .from(entity)
      .where(and(eq(entity.name, "Owlbear"), isNotNull(entity.companionOf)))
      .get()?.id as string;
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get()?.id as string;
    h = await startTestServer({ db, fake: false });
  }, 60_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(loaded.dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  const live = (name: string) =>
    h.live({ role: "player", token: tokens[name] as string }) as Promise<TestClient>;

  test("FR-ENT-36 pet HP: owner adjusts, other player rejected; FR-ENT-37 nothing then a band; leak scan before and after reconnect", async () => {
    const dm = await h.live(DM);
    const p1 = await live("Player 1");
    let p2 = await live("Player 2");
    // The fixture left it at 45 / 59; not present (Town active): player-2 has no row at all.
    expect(entityOf(p1, owlbear)).toMatchObject({ hpCurrent: 45 });
    expect(entityOf(p2, owlbear)).toBeUndefined();
    expect(p2.raw()).not.toContain(owlbear);

    // Owner −5 → ack {45 → 40}; DM and owner get the upsert, player-2 nothing.
    const id = p1.intent(PET_ADJUST_HP, { petId: owlbear, delta: -5 });
    const ack = await p1.next("ack");
    expect(ack).toMatchObject({ intentId: id, result: { before: 45, after: 40 } });
    await barrier(p1);
    await barrier(dm);
    await barrier(p2);
    expect(entityOf(p1, owlbear)).toMatchObject({ hpCurrent: 40 });
    expect(entityOf(dm, owlbear)).toMatchObject({ hpCurrent: 40 });
    expect(p2.raw()).not.toContain(owlbear);
    expect(p2.raw()).not.toContain("Owlbear");

    // player-2 on Mira's pet → forbidden.
    const bad = p2.intent(PET_ADJUST_HP, { petId: owlbear, delta: 5 });
    expect(await p2.next("reject")).toMatchObject({ intentId: bad, code: "forbidden" });

    // Its scene shown → present: player-2 gets the redacted row; a heal changes only the band.
    dm.intent(MAP_INTENTS.activateScene, { sceneId: ambush });
    await dm.next("ack");
    await barrier(p2);
    expect(RedactedPet.parse(entityOf(p2, owlbear))).toMatchObject({ band: "healthy" });
    p1.intent(PET_ADJUST_HP, { petId: owlbear, delta: -15 }); // 25 / 59: bloodied
    await p1.next("ack");
    await barrier(p2);
    expect(entityOf(p2, owlbear)).toMatchObject({ band: "bloodied" });
    redactedOnly(p2, owlbear);
    expect(leakScan(h.s, p2)).toEqual([]);
    expect(leakScan(h.s, p1)).toEqual([]);

    // Reconnect: the snapshot carries the same redacted row.
    p2.close();
    await p2.closed;
    p2 = await live("Player 2");
    expect(RedactedPet.parse(entityOf(p2, owlbear))).toMatchObject({ band: "bloodied" });
    redactedOnly(p2, owlbear);
    expect(leakScan(h.s, p2)).toEqual([]);
  }, 30_000);
});
