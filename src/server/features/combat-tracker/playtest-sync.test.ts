// CBT §13 playtest leak tests over real sockets (`mid-combat`, #171): the DM's attack roll line
// (FR-CBT-52) and the outcome line's DM-only detail (FR-CBT-53) never reach player frames.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { AttackResult, CombatantRecord } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { damageRollIdOf } from "./testing";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const LEAKS = ['"rolls"', "DM ruled", "DM set", "dmPayload"];

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
const byName = (c: TestClient, name: string) =>
  (Object.values(c.store.records.combatant ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  );
const entries = (c: TestClient) =>
  Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryRecord[];

describe("playtest leaks over WS (mid-combat)", () => {
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

  test("FR-CBT-52 DM attack roll never reaches players", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // The fixtures' DM attacks (combat-hit, combat-pending) already wrote DM-only roll lines.
    const fixtureLines = entries(dm).filter(
      (e) => e.kind === "roll" && e.category === "attack" && e.rollerRole === "dm",
    );
    expect(fixtureLines.map((e) => [e.actorName, e.public])).toEqual([
      ["Goblin", false],
      ["Elite Goblin Warrior", false],
    ]);
    // Attack public on, no DM override: the DM's roll line stays DM-only.
    dm.intent("dice.setCategoryPublic", { category: "attack", public: true });
    await dm.next("ack");
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    dm.intent("cbt.attack", {
      attackerId: goblin.id,
      manual: [{ diceTotal: 9 }, { diceTotal: 4 }],
    });
    const rolled = await nextEvent(dm, "AttackRolled");
    const line = rolled.changes.find((c) => c.type === GAME_LOG_ENTRY_TYPE);
    expect(line).toMatchObject({ op: "upsert", data: { kind: "roll", public: false } });
    const { cardId } = (await dm.next("ack")).result as AttackResult;
    for (const c of [p1, p2]) {
      await barrier(c);
      const raw = c.raw();
      for (const e of [...fixtureLines.map((x) => x.id), line?.id as string, cardId]) {
        expect(raw).not.toContain(e);
      }
      expect(leakScan(h.s, c)).toEqual([]);
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBT-53 outcome dmPayload stripped for players", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    const mira = byName(dm, "Mira") as CombatantRecord;
    dm.intent("cbt.attack", {
      attackerId: goblin.id,
      mode: "advantage",
      manual: [{ diceTotal: 9, dice: [9, 2] }, { diceTotal: 4 }],
    });
    const { cardId } = (await dm.next("ack")).result as AttackResult;
    // 9 + 4 = 13 vs Mira's AC 16: computed miss, the DM rules a hit and sets 7 damage.
    dm.intent("cbt.applyCard", {
      cardId,
      toHitTotal: 13,
      damageTotal: 7,
      damageRollId: damageRollIdOf(dm.store.records.notification?.[cardId as string]),
      targets: [{ targetId: mira.id, hit: true, multiplier: "normal" }],
      public: true,
    });
    const dmApplied = await nextEvent(dm, "AttackApplied");
    const dmLine = dmApplied.changes.find((c) => c.type === GAME_LOG_ENTRY_TYPE);
    expect(dmLine).toMatchObject({
      data: {
        public: true,
        payload: { manual: { toHit: true, damage: true } },
        dmPayload: {
          overrides: { hit: true, damage: true },
          rolls: {
            toHit: {
              mode: "advantage",
              dice: [
                [9, true],
                [2, false],
              ],
            },
            damage: { dice: [[4, true]] },
          },
        },
      },
    });
    for (const c of [p1, p2]) {
      const ev = await nextEvent(c, "AttackApplied");
      const pl = ev.changes.find((x) => x.type === GAME_LOG_ENTRY_TYPE);
      expect(pl?.id).toBe(dmLine?.id as string);
      expect(pl?.data).toMatchObject({ payload: { manual: { toHit: true, damage: true } } });
      expect(Object.keys(pl?.data as object)).not.toContain("dmPayload");
      await barrier(c);
      for (const leak of LEAKS) expect(c.raw()).not.toContain(leak);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    for (const c of [dm, p1, p2]) c.close();
  });
});
