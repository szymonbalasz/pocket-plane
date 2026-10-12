// CBT §13 integration over real sockets: the `mid-combat` bundle, player views, live attack →
// apply → undo, reveal, leak scan, convergence per player, crash-resume (restart).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
  HP_CHANGE_TYPE,
  type HpChangeResult,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const LEAKS = [
  "Elite Goblin Warrior",
  "Goblin Boss",
  "Ambush at the Ford",
  '"position"',
  '"turnCombatantId"',
  "dmPayload",
  "encounter-entry",
  "hp-change",
];

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
const combatants = (c: TestClient) =>
  Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[];
/** No player-held combatant carries HP numbers, ranks or a monster's initiative. */
const noCombatantLeak = (c: TestClient) =>
  combatants(c).flatMap((x) =>
    ["hpCurrent", "hpMax", "position", "initRollId", "seq"]
      .filter((k) => k in x)
      .concat(x.kind === "monster" && "initiative" in x ? ["initiative"] : [])
      .map((k) => `${x.name}.${k}`),
  );
const byName = (c: TestClient, name: string) => combatants(c).find((x) => x.name === name);

describe("mid-combat over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("mid-combat", { dmSecret: TEST_SECRET, testMode: true });
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

  test("FR-CBT-27 snapshots: DM full; players see visible rows by playerPosition, no leaks", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(combatants(dm)).toHaveLength(6);
    for (const c of [p1, p2]) {
      expect(
        combatants(c)
          .sort((a, b) => (a.playerPosition ?? 0) - (b.playerPosition ?? 0))
          .map((x) => x.name),
      ).toEqual(["Mira", "Goblin", "Goblin 2", "Thorn"]);
      const enc = Object.values(c.store.records[ENCOUNTER_TYPE] ?? {});
      expect(enc).toEqual([
        expect.objectContaining({ status: "started", round: 1, playerTurnCombatantId: null }),
      ]);
      for (const leak of LEAKS) expect(c.raw()).not.toContain(leak);
      expect(leakScan(h.s, c)).toEqual([]);
      expect(noCombatantLeak(c)).toEqual([]);
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBT-18 FR-CBT-20 FR-CBT-25 player attack → DM apply → undo, live to all", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = byName(p1, "Mira") as CombatantRecord;
    const started = performance.now();
    const intentId = p1.intent("cbt.attack", { attackerId: mira.id });
    const rolled = await nextEvent(p1, "AttackRolled");
    expect(rolled.cause.intentId).toBe(intentId);
    expect(rolled.changes[0]).toMatchObject({ type: GAME_LOG_ENTRY_TYPE, op: "upsert" });
    await nextEvent(p1, "NotificationCreated");
    const ack = await p1.next("ack");
    const { cardId } = ack.result as AttackResult;
    const created = await nextEvent(dm, "NotificationCreated");
    expect(created.changes[0]).toMatchObject({ id: cardId, data: { state: "pending" } });
    expect(performance.now() - started).toBeLessThan(1000);
    // p2 sees the public roll line but not the card.
    await nextEvent(p2, "AttackRolled");
    await barrier(p2);
    expect(p2.raw()).not.toContain(cardId);

    const goblin = byName(dm, "Goblin") as CombatantRecord;
    dm.intent("cbt.applyCard", {
      cardId,
      targetId: goblin.id,
      toHitTotal: 25,
      hit: true,
      damageTotal: 6,
      multiplier: "normal",
    });
    await nextEvent(dm, "AttackApplied");
    const applied = (await dm.next("ack")).result as HpChangeResult;
    expect(Object.keys(dm.store.records[HP_CHANGE_TYPE] ?? {})).toContain(applied.hpChangeId);
    const pa = await nextEvent(p1, "AttackApplied");
    expect(pa.changes.find((c) => c.type === COMBATANT_TYPE)).toMatchObject({
      data: { band: "bloodied" },
    });
    await nextEvent(p1, "NotificationResolved");
    expect(p1.store.records.notification?.[cardId]).toMatchObject({
      state: "resolved",
      resolution: { targetName: "Goblin", applied: 6 },
    });

    dm.intent("cbt.undo", { expectedHpChangeId: applied.hpChangeId });
    await nextEvent(p1, "CombatEntryUndone");
    await nextEvent(p1, "NotificationReopened");
    expect(p1.store.records.notification?.[cardId]).toMatchObject({ state: "pending" });
    expect(byName(p1, "Goblin")).toMatchObject({ band: "healthy" });
    // Double undo → conflict (expected guard).
    dm.intent("cbt.undo", { expectedHpChangeId: applied.hpChangeId }, "u2");
    expect(await dm.next("reject")).toMatchObject({ intentId: "u2", code: "conflict" });

    for (const c of [p1, p2]) {
      await barrier(c);
      for (const leak of LEAKS) expect(c.raw()).not.toContain(leak);
      expect(leakScan(h.s, c)).toEqual([]);
      expect(noCombatantLeak(c)).toEqual([]);
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBT-09 reveal Wolf ≤ 1 s for players; delete bound token → conflict; convergence", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const wolf = byName(dm, "Wolf") as CombatantRecord;
    const goblin2 = byName(dm, "Goblin 2") as CombatantRecord;
    dm.intent("map.setTokenHidden", { tokenId: wolf.tokenId, hidden: false });
    const ev = await nextEvent(p2, "TokenRevealed");
    expect(ev.changes.some((c) => c.type === COMBATANT_TYPE && c.id === wolf.id)).toBe(true);
    expect(byName(p2, "Wolf")?.playerPosition).toBe(1);
    // Wolf has the turn: the player marker appears.
    const enc = Object.values(p2.store.records[ENCOUNTER_TYPE] ?? {})[0] as EncounterRecord;
    expect(enc.playerTurnCombatantId).toBe(wolf.id);
    dm.intent("map.deleteToken", { tokenId: goblin2.tokenId }, "del");
    expect(await dm.next("reject")).toMatchObject({
      intentId: "del",
      code: "conflict",
      message: "Token is in a running encounter",
    });
    expect(
      db
        .select()
        .from(token)
        .all()
        .some((t) => t.id === goblin2.tokenId),
    ).toBe(true);
    dm.intent("cbt.setRemoved", { combatantId: goblin2.id, removed: true });
    await nextEvent(p1, "CombatantRemoved");
    expect(byName(p1, "Goblin 2")).toBeUndefined();
    for (const [live, cred] of [
      [p1, p("Player 1")],
      [p2, p("Player 2")],
    ] as const) {
      await barrier(live);
      const fresh = await h.live(cred);
      const c = convergence(h.s, live, fresh);
      expect(c.live).toEqual(c.fresh);
      fresh.close();
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBT-28 crash-resume: restart → identical snapshots; next turn still works", async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({
        dm: DM,
        p1: p("Player 1"),
        p2: p("Player 2"),
      })) {
        const client = await h.live(cred);
        const r = client.store.records;
        out[k] = Object.fromEntries(
          [
            ENCOUNTER_TYPE,
            "encounter-entry",
            COMBATANT_TYPE,
            HP_CHANGE_TYPE,
            "notification",
            GAME_LOG_ENTRY_TYPE,
            "entity",
            "token",
          ].map((type) => [type, r[type]]),
        );
        client.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
    const dm = await h.live(DM);
    const enc = Object.values(dm.store.records[ENCOUNTER_TYPE] ?? {})[0] as EncounterRecord;
    dm.intent("cbt.nextTurn", {
      encounterId: enc.id,
      expectedRound: enc.round,
      expectedTurnId: enc.turnCombatantId,
    });
    await nextEvent(dm, "TurnChanged");
    // The pending Elite card (combat-pending) survives and applies to Mira (6 → 0).
    const pending = Object.values(dm.store.records.notification ?? {}).find((n) => {
      const x = n as { state: string; text: string };
      return x.state === "pending" && x.text.startsWith("Elite Goblin Warrior");
    }) as { id: string; kind: string } | undefined;
    expect(pending?.kind).toBe("damage-card");
    const mira = byName(dm, "Mira") as CombatantRecord;
    dm.intent("cbt.applyCard", {
      cardId: pending?.id,
      targetId: mira.id,
      toHitTotal: 24,
      hit: true,
      damageTotal: 9,
      multiplier: "normal",
    });
    const applied = await nextEvent(dm, "AttackApplied");
    expect(applied.changes.find((c) => c.type === "entity")).toMatchObject({
      data: { hpCurrent: 0 },
    });
    dm.close();
  });
});
