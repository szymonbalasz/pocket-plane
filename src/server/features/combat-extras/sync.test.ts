// CBTX §13 integration over real sockets on the `combat-extras` bundle: visibility per record /
// event / notification for the DM, the owning player and other players (FR-CBTX-31/32), live
// effects, concentration card + roll, reveal and add-hidden, hidden PC death save, leak scan,
// crash-resume (restart → identical snapshots with a pending concentration card).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  parseFullCard,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
/** CBTX §13 leak strings (+ CBT's): never in a player frame. */
const LEAKS = [
  "Hex",
  "Wolf 2",
  "sourceCombatantId",
  "anchorCombatantId",
  "concentrationId",
  "Elite Goblin Warrior",
  "dmPayload",
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
const recs = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];
const byName = (c: TestClient, name: string) =>
  recs<CombatantRecord>(c, COMBATANT_TYPE).find((x) => x.name === name);
const effects = (c: TestClient) => recs<EffectRecord>(c, EFFECT_TYPE);
const names = (c: TestClient) =>
  effects(c)
    .map((e) => e.label ?? e.condition)
    .sort();
/** A player frame's `tempHp` on a combatant, or another player's counters. */
function playLeaks(c: TestClient, me: string): string[] {
  const out: string[] = [];
  for (const x of recs<Record<string, unknown>>(c, COMBATANT_TYPE)) {
    if ("tempHp" in x) out.push(`combatant ${x.name}.tempHp`);
  }
  for (const e of recs<Record<string, unknown>>(c, ENTITY_TYPE)) {
    if (e.ownerPlayerId === me) continue;
    for (const k of ["tempHp", "deathSuccesses", "deathFailures", "hpCurrent"]) {
      if (k in e) out.push(`entity ${e.name}.${k}`);
    }
  }
  return out;
}

describe("combat-extras over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let players: Record<string, { id: string; token: string }>;
  const p = (name: string) => ({ role: "player" as const, token: players[name]?.token as string });

  beforeAll(async () => {
    const loaded = await loadBundle("combat-extras", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    players = Object.fromEntries(
      db
        .select({ name: player.name, id: player.id, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, { id: r.id, token: r.token }]),
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

  const scan = async (c: TestClient, me: string) => {
    await barrier(c);
    for (const leak of LEAKS)
      expect({ leak, found: c.raw().includes(leak) }).toEqual({ leak, found: false });
    expect(leakScan(h.s, c)).toEqual([]);
    expect(playLeaks(c, me)).toEqual([]);
  };

  test("FR-CBTX-31 FR-CBTX-32 snapshots: DM every active effect; players the redaction of what they may see", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(names(dm)).toEqual(["Bless", "Bless", "Bless", "Hex", "Marked", "poisoned", "prone"]);
    for (const c of [p1, p2]) {
      // No Hex (secret), no poisoned (hidden Elite).
      expect(names(c)).toEqual(["Bless", "Bless", "Bless", "Marked", "prone"]);
      for (const e of effects(c)) {
        expect(Object.keys(e).sort()).toEqual(
          [
            "condition",
            "encounterId",
            "endsRound",
            "id",
            "kind",
            "label",
            "level",
            "targetCharacterId",
            "targetCombatantId",
            // FR-MOD-21: PC effects only.
            ...(e.targetCharacterId ? ["modifiers", "presetKey"] : []),
          ].sort(),
        );
      }
    }
    // FR-CBTX-32: own PC full (temp HP, counters); the other PC whitelisted with deathState.
    const thornFor = (c: TestClient) =>
      recs<Record<string, unknown>>(c, ENTITY_TYPE).find((e) => e.name === "Thorn");
    expect(thornFor(p2)).toMatchObject({ tempHp: 5, deathSuccesses: 0, deathFailures: 0 });
    expect(thornFor(p1)).toMatchObject({ deathState: null });
    expect(byName(dm, "Goblin")?.tempHp).toBe(3);
    await scan(p1, players["Player 1"]?.id as string);
    await scan(p2, players["Player 2"]?.id as string);
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBTX-04 FR-CBTX-17 FR-CBTX-18 live: Frightened to all; Mira hit → card to player-1 only; roll → resolved for DM + player-1, public line for player-2", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    const goblin2 = byName(dm, "Goblin 2") as CombatantRecord;
    dm.intent("cbtx.addEffect", {
      targets: [{ combatantId: goblin.id }, { combatantId: goblin2.id }],
      kind: "condition",
      condition: "frightened",
    });
    for (const c of [p1, p2]) {
      const ev = await nextEvent(c, "EffectsAdded");
      expect(ev.changes.filter((x) => x.type === EFFECT_TYPE && x.op === "upsert")).toHaveLength(2);
    }
    // Goblin attacks Mira for 3 (manual): card to player-1 (owner), not to player-2.
    const mira = byName(dm, "Mira") as CombatantRecord;
    dm.intent("cbt.attack", {
      attackerId: goblin.id,
      manual: [{ diceTotal: 15 }, { diceTotal: 1 }],
    });
    await nextEvent(dm, "AttackRolled");
    const { cardId } = (await dm.next("ack")).result as AttackResult;
    const card = dm.store.records.notification?.[cardId] as NotificationRecord;
    const pay = parseFullCard(card.payload);
    dm.intent("cbt.applyCard", {
      cardId,
      toHitTotal: pay.toHit.total,
      damageTotal: pay.damage.total,
      targets: [{ targetId: mira.id, hit: true, multiplier: "normal" }],
    });
    await nextEvent(p1, "AttackApplied");
    const created = await nextEvent(p1, "NotificationCreated");
    const conc = created.changes[0]?.data as NotificationRecord;
    expect(conc).toMatchObject({
      kind: "cbtx-concentration",
      text: "Mira: concentration save DC 10 (Bless)",
      actionLabel: "Roll save",
      state: "pending",
    });
    await barrier(p2);
    expect(p2.raw()).not.toContain(conc.id);
    // Player-2 can't roll it; player-1 can, manual 8 + 4 = 12 → kept.
    p2.intent("cbtx.rollConcentration", { notificationId: conc.id }, "x2");
    expect(await p2.next("reject")).toMatchObject({ intentId: "x2", code: "not_found" });
    p1.intent("cbtx.rollConcentration", { notificationId: conc.id, manual: { diceTotal: 8 } });
    await nextEvent(p1, "ConcentrationRolled");
    await nextEvent(p1, "NotificationResolved");
    expect(p1.store.records.notification?.[conc.id]).toMatchObject({
      state: "resolved",
      resolution: { total: 12, dc: 10, success: true },
    });
    await nextEvent(dm, "NotificationResolved");
    const line = await nextEvent(p2, "ConcentrationRolled");
    expect(line.changes.find((x) => x.type === GAME_LOG_ENTRY_TYPE)).toMatchObject({
      op: "upsert",
    });
    await scan(p1, players["Player 1"]?.id as string);
    await scan(p2, players["Player 2"]?.id as string);
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBTX-13 reveal Elite → its effect upserts to players; Wolf 2 added hidden → nothing reaches players; convergence", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const elite = byName(dm, "Elite Goblin Warrior") as CombatantRecord;
    const poisoned = effects(dm).find((e) => e.condition === "poisoned") as EffectRecord;
    const wolf2 = db
      .select()
      .from(token)
      .all()
      .find((x) => x.name === "Wolf 2");
    dm.intent("cbtx.addCombatants", {
      encounterId: elite.encounterId,
      items: [{ tokenId: wolf2?.id }],
    });
    await nextEvent(dm, "CombatantsAdded");
    // FR-CBTX-44: initiative rolled on the way in (DM-only entry).
    expect(byName(dm, "Wolf 2")).toMatchObject({ hidden: true, initiative: expect.any(Number) });
    dm.intent("map.setTokenHidden", { tokenId: elite.tokenId, hidden: false });
    const ev = await nextEvent(p1, "TokenRevealed");
    expect(ev.changes.find((x) => x.type === EFFECT_TYPE && x.id === poisoned.id)).toMatchObject({
      op: "upsert",
    });
    expect(effects(p1).some((e) => e.id === poisoned.id)).toBe(true);
    await barrier(p1);
    expect(p1.raw()).not.toContain("Wolf 2");
    const fresh = await h.live(p("Player 1"));
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    // Hide it again for the next tests (leak strings name the Elite).
    dm.intent("map.setTokenHidden", { tokenId: elite.tokenId, hidden: true });
    await nextEvent(p1, "TokenHidden");
    expect(effects(p1).some((e) => e.id === poisoned.id)).toBe(false);
    for (const x of [dm, p1, fresh]) x.close();
  });

  test("FR-CBTX-23 FR-CBTX-32 hidden PC death save: entry DM-only; owner sees counters; others deathState only", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const thorn = byName(dm, "Thorn") as CombatantRecord;
    dm.intent("map.setTokenHidden", { tokenId: thorn.tokenId, hidden: true });
    await nextEvent(dm, "TokenHidden");
    dm.intent("cbt.applyHp", { combatantId: thorn.id, kind: "damage", amount: 99 });
    const down = await nextEvent(p1, "HpApplied");
    expect(down.changes.find((x) => x.type === ENTITY_TYPE)?.data).toMatchObject({
      name: "Thorn",
      deathState: "dying",
    });
    p2.intent("cbtx.rollDeathSave", { characterId: thorn.entityId, manual: { diceTotal: 14 } });
    const rolled = await nextEvent(p2, "DeathSaveRolled");
    expect(rolled.changes.find((x) => x.type === ENTITY_TYPE)?.data).toMatchObject({
      deathSuccesses: 1,
      deathFailures: 0,
    });
    expect(rolled.changes.some((x) => x.type === GAME_LOG_ENTRY_TYPE)).toBe(false);
    const dmSide = await nextEvent(dm, "DeathSaveRolled");
    expect(dmSide.changes.find((x) => x.type === GAME_LOG_ENTRY_TYPE)?.data).toMatchObject({
      public: false,
    });
    const other = await nextEvent(p1, "DeathSaveRolled");
    expect(other.changes.find((x) => x.type === ENTITY_TYPE)?.data).not.toHaveProperty(
      "deathSuccesses",
    );
    await scan(p1, players["Player 1"]?.id as string);
    // Heal + reveal for the next test.
    dm.intent("cbt.applyHp", { combatantId: thorn.id, kind: "heal", amount: 10 });
    await nextEvent(dm, "HpApplied");
    dm.intent("map.setTokenHidden", { tokenId: thorn.tokenId, hidden: false });
    await nextEvent(dm, "TokenRevealed");
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBTX-01 crash-resume: a pending concentration card, effects, temp HP intact; restart → identical snapshots", async () => {
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
          [EFFECT_TYPE, COMBATANT_TYPE, "notification", ENTITY_TYPE, GAME_LOG_ENTRY_TYPE].map(
            (type) => [type, r[type]],
          ),
        );
        client.close();
      }
      return out;
    };
    const dm = await h.live(DM);
    const mira = byName(dm, "Mira") as CombatantRecord;
    dm.intent("cbt.applyHp", { combatantId: mira.id, kind: "damage", amount: 2 });
    await nextEvent(dm, "NotificationCreated");
    dm.close();
    const before = await snap();
    const pending = Object.values(
      (before.dm as Record<string, Record<string, NotificationRecord>>).notification ?? {},
    ).filter((n) => n.kind === "cbtx-concentration" && n.state === "pending");
    expect(pending).toHaveLength(1);
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
