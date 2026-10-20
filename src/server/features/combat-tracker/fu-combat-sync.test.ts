// Sprint 7 FU-combat over real sockets on `fu-s7` (session-sim-10 + `cp-ally` + `fu-hurt-goblins`):
// the sim-10 replay. Turn hostile Fire Elemental 3, release Fire Elemental 2, remove Mira's Fire
// Elemental, End (every summon's token goes, FR-CBT-145; the charmed Goblin 2 keeps its token
// without an owner; the pets' tokens keep their owner, FR-MAP-88), Start "Escort to the Ford"
// with both pets (kept HP, FR-CBT-141; the drake's owner still there), Add the downed Goblin's
// token (0 / 7, Down). Players get the deletes,
// pass the leak scan, and a restart gives identical snapshots.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, entity, hpChange, player, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
async function ack(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) {
      if (f.type === "reject") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
      return f.result;
    }
  }
}
const active = (c: TestClient) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).filter(
    (x) => x.active,
  );
const named = (c: TestClient, name: string) => active(c).find((x) => x.name === name);
const tokenOf = (c: TestClient, id: string) =>
  c.store.records[TOKEN_TYPE]?.[id] as TokenRecord | undefined;

describe("FU-combat on fu-s7 over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ids: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("fu-s7", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    ids = Object.fromEntries(players.map((r) => [r.name, r.id]));
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

  test("FR-CBT-145 End removes hostile summon tokens; FR-MAP-88 companion marker after End → Start; FR-CBT-141 kept HP at Start (fu-s7)", async () => {
    const ambush = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const dmActor = {
      role: "dm" as const,
      playerId: null,
      campaignId: ambush?.campaignId as string,
    };
    h.s.commands.run("map.activateScene", { sceneId: ambush?.sceneId }, { actor: dmActor });
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const p1Id = ids["Player 1"] as string;

    // fu-hurt-goblins + cp-ally as loaded.
    expect(named(dm, "Goblin")).toMatchObject({ hpCurrent: 0, hpMax: 7 });
    const g2 = named(dm, "Goblin 2") as CombatantRecord;
    expect(g2).toMatchObject({ hpCurrent: 4, hpMax: 7, turnMode: "after-owner", pet: false });
    const drake = named(dm, "Drake Companion") as CombatantRecord;
    const owlbear = named(dm, "Owlbear") as CombatantRecord;
    const petTokens = [drake.tokenId, owlbear.tokenId] as string[];
    const ownerOfPets = () => petTokens.map((t) => tokenOf(dm, t)?.ownerPlayerId);
    expect(ownerOfPets()).toEqual([p1Id, p1Id]);

    const fe = named(dm, "Fire Elemental") as CombatantRecord;
    const fe2 = named(dm, "Fire Elemental 2") as CombatantRecord;
    const fe3 = named(dm, "Fire Elemental 3") as CombatantRecord;
    const summonTokens = [fe.tokenId, fe2.tokenId, fe3.tokenId] as string[];
    await ack(dm, "cbt.setCompanion", { combatantId: fe3.id, owner: null, side: "enemy" });
    await ack(dm, "cbt.setCompanion", { combatantId: fe2.id, owner: null });
    await ack(dm, "cbt.setRemoved", { combatantId: fe.id, removed: true });
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(ownerOfPets()).toEqual([p1Id, p1Id]);
    // Players held the visible summons' tokens before End.
    const held = (c: TestClient) => summonTokens.filter((t) => tokenOf(c, t) !== undefined);
    const heldBefore = { p1: held(p1), p2: held(p2) };
    expect(heldBefore.p1.length).toBeGreaterThan(0);

    await ack(dm, "cbt.end", { encounterId: ambush?.id });
    for (const c of [dm, p1, p2]) await barrier(c);
    for (const t of summonTokens) {
      expect(db.select().from(token).where(eq(token.id, t)).get()).toBeUndefined();
      expect(tokenOf(dm, t)).toBeUndefined();
    }
    expect(held(p1)).toEqual([]);
    expect(held(p2)).toEqual([]);
    // #310 (2): the charmed Goblin 2 keeps its token, without an owner.
    expect(tokenOf(dm, g2.tokenId as string)).toMatchObject({ ownerPlayerId: null });
    // FR-MAP-88: after End the pets' tokens keep their owner (DM, owner's store and the DB).
    expect(ownerOfPets()).toEqual([p1Id, p1Id]);
    expect(petTokens.map((t) => tokenOf(p1, t)?.ownerPlayerId)).toEqual([p1Id, p1Id]);

    // Start "Escort to the Ford" with both pets.
    const escort = db
      .select()
      .from(encounter)
      .where(eq(encounter.name, "Escort to the Ford"))
      .get();
    const pets = db
      .select()
      .from(entity)
      .all()
      .filter((e) => e.companionOf !== null && e.kind === "monster")
      .map((e) => e.id);
    const hpRows = db.select().from(hpChange).all().length;
    await ack(dm, "cbt.start", {
      encounterId: escort?.id,
      sceneId: ambush?.sceneId,
      petIds: pets,
    });
    for (const c of [dm, p1, p2]) await barrier(c);
    // OQ-CBT-92 A on sim-10's map: three goblin slots, four goblin tokens. Goblin 2 keeps 4 / 7;
    // the never-fought Goblin Lurker and Goblin 4 bind fresh **before** the Goblin kept at 0,
    // which stays unbound (FR-CBT-141's binding order).
    expect(named(dm, "Goblin 2")).toMatchObject({ hpCurrent: 4, hpMax: 7, ownerCharacterId: null });
    const goblins = active(dm).filter((c) => c.entityId === g2.entityId);
    expect(goblins.map((c) => [c.name, c.hpCurrent]).sort()).toEqual([
      ["Goblin 2", 4],
      ["Goblin 4", 7],
      ["Goblin Lurker", 7],
    ]);
    expect(named(dm, "Goblin")).toBeUndefined();
    // Add (combat-extras) binding the downed Goblin's token: it joins at 0 / 7, Down.
    const goblinToken = db.select().from(token).where(eq(token.name, "Goblin")).get()?.id;
    await ack(dm, "cbtx.addCombatants", {
      encounterId: escort?.id,
      items: [{ tokenId: goblinToken }],
    });
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(named(dm, "Goblin")).toMatchObject({ hpCurrent: 0, hpMax: 7 });
    const seen = (c: TestClient, name: string) =>
      (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as Record<string, unknown>[]).find(
        (x) => x.encounterId === escort?.id && x.name === name,
      );
    // Fog-hidden for players (FR-FOG-14): neither player holds the row, so no HP leaks either.
    expect(named(dm, "Goblin")?.hidden).toBe(true);
    for (const c of [p1, p2]) expect(seen(c, "Goblin")).toBeUndefined();
    expect(db.select().from(hpChange).all().length).toBe(hpRows);
    expect(ownerOfPets()).toEqual([p1Id, p1Id]);
    expect(named(dm, "Drake Companion")).toMatchObject({ pet: true, ownerPlayerId: p1Id });
    // No leak for either player.
    for (const c of [p1, p2]) expect(leakScan(h.s, c)).toEqual([]);

    // Restart → identical snapshots per viewer.
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        const r = client.store.records;
        out[k] = Object.fromEntries(
          [ENCOUNTER_TYPE, COMBATANT_TYPE, ENTITY_TYPE, TOKEN_TYPE].map((t) => [t, r[t]]),
        );
        client.close();
      }
      return out;
    };
    for (const c of [dm, p1, p2]) c.close();
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
    const after = (before.dm as Record<string, Record<string, EncounterRecord>>)[ENCOUNTER_TYPE];
    expect(after?.[escort?.id as string]?.status).toBe("started");
  }, 90_000);
});
