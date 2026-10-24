// Sprint 10 T2 (BL-114, DM #343) over real sockets on `companions`: the DM hides Mira's Owlbear in
// the running ambush. Player 2 (not the owner) gets the pet's `entity` delete and never holds it
// again while hidden: not in a frame, a `sync.load` ack, nor the snapshot after a reconnect or a
// restart. Shown → the redacted row is back. Player 1 (the owner) and the DM keep the full row.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { ENCOUNTER_TYPE, type EncounterRecord } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function nextEvent(c: TestClient, cause: string) {
  for (;;) {
    const e = await c.next("event", 1500);
    if (e.cause.name === cause) return e;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];
const entityOf = (c: TestClient, id: string) =>
  c.store.records[ENTITY_TYPE]?.[id] as Record<string, unknown> | undefined;

describe("BL-114 a hidden pet over WS (entities)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("companions", { dmSecret: TEST_SECRET, testMode: true });
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

  test("FR-ENT-37 BL-114 hidden pet: player 2 gets its delete; no frame, read ack, reconnect or restart snapshot holds it; back on show; owner and DM keep it", async () => {
    const dm = await h.live(DM);
    const enc = all<EncounterRecord>(dm, ENCOUNTER_TYPE).find((e) => e.status === "started");
    const actor = { role: "dm" as const, playerId: null, campaignId: enc?.campaignId as string };
    h.s.commands.run("map.activateScene", { sceneId: enc?.sceneId }, { actor });
    dm.close();
    const live = async () => [
      await h.live(DM),
      await h.live(p("Player 1")),
      await h.live(p("Player 2")),
    ];
    let [d, p1, p2] = (await live()) as [TestClient, TestClient, TestClient];
    const pet = all<Record<string, unknown>>(d, ENTITY_TYPE).find(
      (e) => e.name === "Owlbear" && e.companionOf,
    ) as Record<string, unknown>;
    const petId = pet.id as string;
    const tok = all<TokenRecord>(d, TOKEN_TYPE).find(
      (t) => t.definitionId === petId,
    ) as TokenRecord;
    expect(tok.hidden).toBe(false);
    expect(pet.petPresent).toBe(true);
    expect(entityOf(p2, petId)).toMatchObject({ name: "Owlbear", band: expect.any(String) });
    expect(entityOf(p1, petId)).toMatchObject({ name: "Owlbear", hpCurrent: expect.any(Number) });
    const marks = [p1.raw().length, p2.raw().length];

    d.intent(MAP_INTENTS.setTokenHidden, { tokenId: tok.id, hidden: true });
    await nextEvent(d, "TokenHidden");
    await d.next("ack");
    expect(entityOf(d, petId)).toMatchObject({ name: "Owlbear", petPresent: false });
    const ev2 = await nextEvent(p2, "TokenHidden");
    await barrier(p2);
    expect(ev2.changes).toContainEqual({ type: ENTITY_TYPE, id: petId, op: "delete" });
    expect(entityOf(p2, petId)).toBeUndefined();
    expect(p2.raw().slice(marks[1])).not.toContain("Owlbear");
    // The owner keeps the full row (an upsert of it, never a delete).
    const ev1 = await nextEvent(p1, "TokenHidden");
    await barrier(p1);
    expect(ev1.changes.filter((c) => c.type === ENTITY_TYPE && c.id === petId)).toEqual([
      expect.objectContaining({ op: "upsert" }),
    ]);
    expect(entityOf(p1, petId)).toMatchObject({ name: "Owlbear", hpCurrent: expect.any(Number) });
    expect(p1.raw().slice(marks[0])).not.toContain("petPresent");

    // A read ack (the Stats fight) never names the pet's entity for player 2.
    const intentId = p2.intent("stats.query", { scope: "fight" });
    for (;;) {
      const a = await p2.next("ack", 1500);
      if (a.intentId !== intentId) continue;
      expect(JSON.stringify(a)).not.toContain(petId);
      break;
    }
    expect(entityOf(p2, petId)).toBeUndefined();
    for (const c of [d, p1, p2]) c.close();

    // Reconnect, then a restart: the same snapshots; player 2's never holds the pet.
    const snap = async () => {
      [d, p1, p2] = (await live()) as [TestClient, TestClient, TestClient];
      expect(entityOf(p2, petId)).toBeUndefined();
      expect(p2.raw()).not.toContain(`"${petId}"`);
      expect(entityOf(p1, petId)).toMatchObject({ name: "Owlbear" });
      expect(entityOf(d, petId)).toMatchObject({ name: "Owlbear", petPresent: false });
      const out = [d, p1, p2].map((c) => c.store.records[ENTITY_TYPE]);
      for (const c of [d, p1, p2]) c.close();
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);

    // Shown: player 2 gets the redacted row back, as before the hide.
    [d, p1, p2] = (await live()) as [TestClient, TestClient, TestClient];
    d.intent(MAP_INTENTS.setTokenHidden, { tokenId: tok.id, hidden: false });
    const back = await nextEvent(p2, "TokenRevealed");
    expect(back.changes).toContainEqual(
      expect.objectContaining({ type: ENTITY_TYPE, id: petId, op: "upsert" }),
    );
    await barrier(p2);
    expect(entityOf(p2, petId)).toMatchObject({ name: "Owlbear", band: expect.any(String) });
    expect(Object.keys(entityOf(p2, petId) ?? {})).not.toContain("hpCurrent");
  }, 60_000);
});
