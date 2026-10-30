// The ADR-0075 risk, tested first: "nothing shown as a battle scene" during a session. A running
// fight, a fight started while an overview is shown, pets, free rolls, templates, signals and a
// reconnect, over real sockets. None of it may need a change to combat, dice or fog code.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
  type HpChangesResult,
} from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { OVERVIEW_TYPE, OVW_INTENTS } from "@shared/overview-scenes/schemas";
import { SCN_INTENTS, SCN_SIGNALS } from "@shared/scene-tools/schemas";
import { MAP_INTENTS, MAP_SIGNALS, SCENE_TYPE, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player, scene } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { damageRollIdOf, partRollIdsFor } from "../combat-tracker/testing";
import { activeSceneOf } from "../scenes-map/rows";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
async function intent(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
  }
}
async function ok<R = unknown>(c: TestClient, name: string, payload: unknown): Promise<R> {
  const f = await intent(c, name, payload);
  if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f.result as R;
}
const combatants = (c: TestClient) =>
  Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[];
const byName = (c: TestClient, name: string) =>
  combatants(c).find((x) => x.name === name) as CombatantRecord;
const started = (c: TestClient) =>
  (Object.values(c.store.records[ENCOUNTER_TYPE] ?? {}) as EncounterRecord[]).find(
    (e) => e.status === "started",
  ) as EncounterRecord;
/** Waits for the resync a Show sends (a fresh snapshot, then the live frame). */
const resynced = async (c: TestClient) => {
  await c.next("snapshot", 3000);
  await barrier(c);
};

interface World {
  h: TestServer;
  db: Db;
  dir: string;
  links: Record<string, string>;
  stop(): Promise<void>;
}

async function world(bundle: string): Promise<World> {
  const loaded = await loadBundle(bundle, { dmSecret: TEST_SECRET, testMode: true });
  const db = openFileDb(loaded.config.dbPath);
  const links = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((p) => [p.name, p.token]),
  );
  const h = await startTestServer({ db, fake: false, testMode: true });
  return {
    h,
    db,
    dir: loaded.dir,
    links,
    async stop() {
      await h.stop();
      closeDb(db);
      try {
        rmSync(loaded.dir, { recursive: true, force: true });
      } catch {
        // Windows may hold the WAL briefly; a leftover temp dir is harmless.
      }
    },
  };
}

describe("FR-OVW-42 a running fight with an overview shown (mid-combat)", () => {
  let w: World;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  let overviewId: string;
  let battleId: string;
  const pc = (name: string) => ({ role: "player" as const, token: w.links[name] as string });

  beforeAll(async () => {
    w = await world("mid-combat");
    dm = await w.h.live(DM);
    p1 = await w.h.live(pc("Player 1"));
    p2 = await w.h.live(pc("Player 2"));
    battleId = started(dm).sceneId as string;
    ({ overviewId } = await ok<{ overviewId: string }>(dm, OVW_INTENTS.create, { name: "Coast" }));
    dm.intent(OVW_INTENTS.show, { overviewId });
    await resynced(p1);
    await resynced(p2);
    await barrier(dm);
  }, 60_000);

  afterAll(async () => {
    for (const c of [dm, p1, p2]) c.close();
    await w.stop();
  });

  test("FR-OVW-42 after Show: no scene or token for players, the fight is still there", () => {
    expect(activeSceneOf(w.db as never, started(dm).campaignId)).toBeNull();
    for (const c of [p1, p2]) {
      expect(Object.keys(c.store.records[SCENE_TYPE] ?? {})).toEqual([]);
      expect(Object.keys(c.store.records[TOKEN_TYPE] ?? {})).toEqual([]);
      expect(Object.values(c.store.records[OVERVIEW_TYPE] ?? {})).toEqual([
        { id: overviewId, campaignId: started(dm).campaignId, active: true },
      ]);
      expect(started(c)).toMatchObject({ status: "started", round: 1 });
      expect(combatants(c).length).toBeGreaterThan(0);
    }
  });

  test("FR-OVW-42 fight runs on: Initiative, attack roll, damage card, next turn", async () => {
    const mira = byName(p1, "Mira");
    const goblin = byName(dm, "Goblin");
    await ok(dm, "cbt.setInitiative", { combatantId: goblin.id, value: 11 });

    const { cardId } = await ok<AttackResult>(p1, "cbt.attack", { attackerId: mira.id });
    await barrier(dm);
    const card = dm.store.records.notification?.[cardId];
    expect(card).toMatchObject({ state: "pending" });
    const applied = await ok<HpChangesResult>(dm, "cbt.applyCard", {
      cardId,
      toHitTotal: 25,
      damageTotal: 3,
      damageRollId: damageRollIdOf(card),
      partRollIds: partRollIdsFor(card),
      targets: [{ targetId: goblin.id, hit: true, multiplier: "normal" }],
    });
    expect(applied.hpChangeIds.length).toBe(1);
    await barrier(p1);
    expect(p1.store.records.notification?.[cardId]).toMatchObject({ state: "resolved" });

    const e = started(dm);
    await ok(dm, "cbt.nextTurn", {
      encounterId: e.id,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
    await barrier(dm);
    expect(started(dm).turnCombatantId).not.toBe(e.turnCombatantId);
    for (const c of [p1, p2]) {
      await barrier(c);
      expect(leakScan(w.h.s, c)).toEqual([]);
    }
  });

  test("FR-OVW-42 a free roll and a roll as a character work", async () => {
    await ok(p1, "dice.roll", { expression: "1d20" });
    const mira = Object.values(p1.store.records[ENTITY_TYPE] ?? {}).find(
      (r) => (r as { name?: string }).name === "Mira",
    ) as { id: string };
    await ok(p1, "dice.roll", { expression: "1d20", actor: { entityId: mira.id } });
    await ok(dm, "dice.roll", { expression: "2d6", public: false });
  });

  test("FR-OVW-42 templates: the battle scene isn't the players'; the DM prepares; signals don't reach a scene not shown", async () => {
    const template = { sceneId: battleId, shape: "sphere", x: 5, y: 5, size: 20, angle: 0 };
    const player = await intent(p1, SCN_INTENTS.placeTemplate, template);
    expect(player).toMatchObject({
      type: "reject",
      code: "invalid",
      message: "Not the scene players see",
    });
    const prep = await ok<{ templateId: string }>(dm, SCN_INTENTS.placeTemplate, template);
    expect(prep.templateId).toBeTruthy();
    await barrier(p1);
    expect(p1.raw()).not.toContain(prep.templateId);
    await ok(dm, SCN_INTENTS.deleteTemplate, { templateId: prep.templateId });
    // Live previews: a player's for the scene that went off stops at the hub, a DM's stays with the DM.
    p1.send({ type: "signal", name: SCN_SIGNALS.template, data: template });
    dm.send({ type: "signal", name: SCN_SIGNALS.template, data: template });
    for (const c of [p1, p2]) await barrier(c);
    expect(p2.raw()).not.toContain(SCN_SIGNALS.template);
  });

  test("FR-OVW-13 ping, laser and pull carry the overview's ID", async () => {
    const data = { sceneId: overviewId, x: 10, y: 20 };
    p1.send({ type: "signal", name: MAP_SIGNALS.ping, data });
    for (const c of [dm, p2]) {
      const f = await c.next("signal", 1000);
      expect(f).toMatchObject({ name: MAP_SIGNALS.ping, data });
    }
    dm.send({ type: "signal", name: MAP_SIGNALS.pull, data });
    for (const c of [p1, p2]) {
      expect(await c.next("signal", 1000)).toMatchObject({ name: MAP_SIGNALS.pull, data });
    }
    p2.send({
      type: "signal",
      name: MAP_SIGNALS.laser,
      data: { sceneId: overviewId, points: [[1, 2]] },
    });
    for (const c of [dm, p1]) {
      expect(await c.next("signal", 1000)).toMatchObject({ name: MAP_SIGNALS.laser });
    }
  });

  test("FR-OVW-42 a player can't move or drag a token of the scene that went off", async () => {
    const tokens = (
      (await intent(dm, "sync.loadScene", { sceneId: battleId })) as {
        result?: {
          records?: Record<string, { id: string; name: string; col: number; row: number }[]>;
        };
      }
    ).result?.records?.[TOKEN_TYPE];
    const own = tokens?.find((t) => t.name === "Mira");
    expect(own).toBeDefined();
    const move = await intent(p1, MAP_INTENTS.moveToken, {
      tokenId: own?.id,
      col: own?.col,
      row: own?.row,
    });
    expect(move).toMatchObject({ type: "reject", code: "not_found" });
    // The DM still works the scene that isn't shown.
    await ok(dm, MAP_INTENTS.moveToken, {
      tokenId: own?.id,
      col: (own?.col as number) + 1,
      row: own?.row,
    });
    await barrier(p1);
    expect(Object.keys(p1.store.records[TOKEN_TYPE] ?? {})).toEqual([]);
  });

  test("FR-OVW-07 sync.loadScene answers an overview, plain and View as, and a battle scene", async () => {
    const plain = await intent(dm, "sync.loadScene", { sceneId: overviewId });
    expect(plain.type).toBe("ack");
    const players = w.db.select({ id: player.id }).from(player).all();
    const viewAs = await intent(dm, "sync.loadScene", {
      sceneId: overviewId,
      viewAs: players[0]?.id,
    });
    expect(viewAs.type).toBe("ack");
    const party = await intent(dm, "sync.loadScene", { sceneId: overviewId, viewAs: "party" });
    expect(party.type).toBe("ack");
    expect((await intent(dm, "sync.loadScene", { sceneId: battleId })).type).toBe("ack");
  });

  test("FR-OVW-42 reconnect: same picture, fight on; convergence and leak scan clean", async () => {
    p1.close();
    p1 = await w.h.live(pc("Player 1"));
    expect(Object.keys(p1.store.records[TOKEN_TYPE] ?? {})).toEqual([]);
    expect(Object.keys(p1.store.records[OVERVIEW_TYPE] ?? {})).toEqual([overviewId]);
    expect(started(p1)).toMatchObject({ status: "started" });
    expect(leakScan(w.h.s, p1)).toEqual([]);
    const fresh = await w.h.live(pc("Player 2"));
    await barrier(p2);
    const c = convergence(w.h.s, p2, fresh);
    expect(c.live).toEqual(c.fresh);
    fresh.close();
    const dmFresh = await w.h.live(DM);
    dm.loadScene(battleId);
    dmFresh.loadScene(battleId);
    await barrier(dmFresh);
    await barrier(dm);
    const d = convergence(w.h.s, dm, dmFresh, [battleId]);
    expect(d.live).toEqual(d.fresh);
    dmFresh.close();
  });

  test("FR-OVW-06 back to the battle scene: the fight is on the map again", async () => {
    dm.intent(MAP_INTENTS.activateScene, { sceneId: battleId });
    await resynced(p1);
    await resynced(p2);
    await barrier(dm);
    for (const c of [p1, p2]) {
      expect(Object.keys(c.store.records[OVERVIEW_TYPE] ?? {})).toEqual([]);
      expect(Object.keys(c.store.records[TOKEN_TYPE] ?? {}).length).toBeGreaterThan(0);
      expect(leakScan(w.h.s, c)).toEqual([]);
    }
    const e = started(dm);
    await ok(dm, "cbt.nextTurn", {
      encounterId: e.id,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
  });
});

describe("FR-OVW-43 start with an overview shown (combat)", () => {
  let w: World;
  afterAll(async () => {
    await w.stop();
  });

  test("FR-OVW-43 start needs a scene: an overview ID → not_found; a battle scene not shown starts, as today", async () => {
    w = await world("combat");
    const dm = await w.h.live(DM);
    const p1 = await w.h.live({ role: "player", token: w.links["Player 1"] as string });
    const { overviewId } = await ok<{ overviewId: string }>(dm, OVW_INTENTS.create, {
      name: "Coast",
    });
    dm.intent(OVW_INTENTS.show, { overviewId });
    await resynced(p1);
    await barrier(dm);
    const enc = w.db.select().from(encounter).all()[0] as typeof encounter.$inferSelect;
    const battle = w.db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush") as typeof scene.$inferSelect;
    expect(
      await intent(dm, "cbt.start", { encounterId: enc.id, sceneId: overviewId }),
    ).toMatchObject({ type: "reject", code: "not_found" });
    await ok(dm, "cbt.start", { encounterId: enc.id, sceneId: battle.id });
    await barrier(p1);
    expect(started(dm)).toMatchObject({ status: "started", sceneId: battle.id });
    await ok(dm, "cbt.rollInitiative", {
      combatantIds: combatants(dm)
        .filter((c) => c.initiative === null)
        .map((c) => c.id),
    });
    const e = started(dm);
    await ok(dm, "cbt.nextTurn", {
      encounterId: e.id,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
    await barrier(p1);
    expect(Object.keys(p1.store.records[TOKEN_TYPE] ?? {})).toEqual([]);
    expect(leakScan(w.h.s, p1)).toEqual([]);
    dm.close();
    p1.close();
  }, 60_000);
});

describe("FR-OVW-44 pets with an overview shown (companions)", () => {
  let w: World;
  afterAll(async () => {
    await w.stop();
  });

  test("FR-OVW-44 a pet in the fight stays present; once the fight is over Show takes it off and the scene brings it back", async () => {
    w = await world("companions");
    const dm = await w.h.live(DM);
    const p2 = await w.h.live({ role: "player", token: w.links["Player 2"] as string });
    const pets = () =>
      (
        Object.values(dm.store.records[ENTITY_TYPE] ?? {}) as {
          name: string;
          companionOf: string | null;
          petPresent?: boolean;
        }[]
      ).filter((e) => e.companionOf);
    expect(pets().length).toBeGreaterThan(0);
    const battleId = started(dm).sceneId as string;
    expect(pets().every((p) => p.petPresent)).toBe(true);
    const { overviewId } = await ok<{ overviewId: string }>(dm, OVW_INTENTS.create, {
      name: "Coast",
    });
    dm.intent(OVW_INTENTS.show, { overviewId });
    await resynced(p2);
    await barrier(dm);
    // In the fight: present through their combatants.
    expect(pets().every((p) => p.petPresent)).toBe(true);
    const seenInFight = Object.values(p2.store.records[ENTITY_TYPE] ?? {}).length;

    await ok(dm, "cbt.end", { encounterId: started(dm).id });
    await barrier(dm);
    await barrier(p2);
    // No fight, no battle scene: nothing keeps a pet present.
    expect(pets().map((p) => p.petPresent)).toEqual(pets().map(() => false));
    expect(Object.values(p2.store.records[ENTITY_TYPE] ?? {}).length).toBeLessThanOrEqual(
      seenInFight,
    );
    expect(leakScan(w.h.s, p2)).toEqual([]);

    dm.intent(MAP_INTENTS.activateScene, { sceneId: battleId });
    await resynced(p2);
    await barrier(dm);
    expect(pets().every((p) => p.petPresent)).toBe(true);

    // Show again, no fight: `deactivated` takes them off in the Show's own event.
    dm.intent(OVW_INTENTS.show, { overviewId });
    await resynced(p2);
    await barrier(dm);
    expect(pets().map((p) => p.petPresent)).toEqual(pets().map(() => false));
    expect(leakScan(w.h.s, p2)).toEqual([]);
    dm.close();
    p2.close();
  }, 60_000);
});
