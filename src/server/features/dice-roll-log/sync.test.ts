// DICE §13 integration over real sockets: the `dice-log` bundle, player views, live rolls,
// settings, leak scan, window + convergence (ADR-0029), restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  GAME_LOG_ENTRY_TYPE,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogEntryRecord,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, gameLogEntry, player, roll } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { gameLog } from "./index";
import { seedDice } from "./testing";

const SECRET = "DM-SECRET-ROLL";
const DM = { role: "dm" as const, secret: TEST_SECRET };

const entriesOf = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryRecord[]).sort(
    (a, b) => a.n - b.n,
  );
/** Next event frame with this cause (skips presence changes). */
async function nextEvent(c: TestClient, cause: string) {
  for (;;) {
    const e = await c.next("event", 1000);
    if (e.cause.name === cause) return e;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};

describe("dice-log bundle over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  let ids: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("dice-log", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    ids = Object.fromEntries(
      db
        .select()
        .from(entity)
        .all()
        .map((e) => [e.name, e.id]),
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

  test("DICE §13 rolls-1: DM sees e1–e4 (e2, e3 hidden, e4 manual); players see e1, e4 only", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const all = entriesOf(dm);
    expect(all.map((e) => [e.n, e.actorName, e.category, e.public])).toEqual([
      [1, "Goblin", "attack", true],
      [2, "Goblin", "damage", false],
      [3, "Goblin", "skill-check", false],
      [4, "Mira", "initiative", true],
    ]);
    const e4 = (all[3]?.payload as RollEntryPayload | undefined)?.[0];
    expect(e4).toMatchObject({ manual: true, total: 17, dice: [{ value: 15 }] });
    const e1 = (all[0]?.payload as RollEntryPayload | undefined)?.[0];
    expect(e1?.total).toBe((e1?.dice[0]?.value ?? 0) + 4);
    for (const c of [p1, p2]) {
      expect(entriesOf(c).map((e) => e.n)).toEqual([1, 4]);
      expect(entriesOf(c)[0]).not.toHaveProperty("dmPayload");
      expect(c.store.records[GAME_LOG_SETTINGS_TYPE]).toBeUndefined();
      expect(c.raw()).not.toContain(SECRET);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(dm.store.records[GAME_LOG_SETTINGS_TYPE]).toBeDefined();
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-DICE-09 FR-DICE-10 player-1 as Mira with advantage: event before ack, live to all ≤ 1 s", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const started = performance.now();
    const intentId = p1.intent("dice.roll", {
      expression: "1d20+4",
      mode: "advantage",
      category: "attack",
      actor: { entityId: ids.Mira },
    });
    const ev = await nextEvent(p1, "DiceRolled");
    expect(ev.cause.intentId).toBe(intentId);
    expect(ev.cause.name).toBe("DiceRolled");
    const ack = await p1.next("ack", 1000);
    const result = ack.result as { rollId: string; entryId: string };
    expect(ev.changes[0]?.id).toBe(result.entryId);
    for (const c of [dm, p2]) {
      const e = await nextEvent(c, "DiceRolled");
      expect(e.changes[0]).toMatchObject({ op: "upsert", id: result.entryId });
    }
    expect(performance.now() - started).toBeLessThan(1000);
    const item = (entriesOf(p2).at(-1)?.payload as RollEntryPayload | undefined)?.[0];
    expect(item?.mode).toBe("advantage");
    expect(item?.dice).toHaveLength(2);
    expect(item?.dice.filter((d) => !d.kept)).toHaveLength(1);
    expect(entriesOf(p2).at(-1)).toMatchObject({ actorName: "Mira", public: true });

    // Thorn belongs to player-2 → forbidden; a player `public` → forbidden; nothing logged.
    p1.intent("dice.roll", { expression: "1d20", actor: { entityId: ids.Thorn } }, "thorn");
    expect(await p1.next("reject")).toMatchObject({ intentId: "thorn", code: "forbidden" });
    p1.intent("dice.roll", { expression: "1d20", public: false }, "pub");
    expect(await p1.next("reject")).toMatchObject({ intentId: "pub", code: "forbidden" });
    p1.intent("dice.roll", { expression: "1000d1000" }, "big");
    const big = await p1.next("reject");
    expect(big).toMatchObject({ intentId: "big", code: "invalid" });
    expect(JSON.stringify(big)).toContain("At most 50 dice");
    await dm.expectNoFrame(150);
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-DICE-12 FR-DICE-23 settings: other DM tab converges; players get no frame; not retroactive", async () => {
    const a = await h.live(DM);
    const b = await h.live(DM);
    const p2 = await h.live(p("Player 2"));
    const before = entriesOf(p2).map((e) => e.id);
    a.intent("dice.setCategoryPublic", { category: "skill-check", public: true }, "s1");
    await a.next("ack");
    const ev = await nextEvent(b, "PublicLogCategorySet");
    expect(ev.cause.name).toBe("PublicLogCategorySet");
    expect(ev.changes[0]).toMatchObject({
      type: GAME_LOG_SETTINGS_TYPE,
      data: { skillCheck: true },
    });
    await p2.expectNoFrame(150);
    // Same value → no event at all.
    a.intent("dice.setCategoryPublic", { category: "skill-check", public: true }, "s2");
    await a.next("ack");
    await b.expectNoFrame(150);
    // e3 (skill, hidden at creation) stays hidden; a new skill roll is public.
    a.intent("dice.roll", { expression: "1d20", category: "skill-check", label: "Stealth" }, "r");
    await a.next("ack");
    await barrier(p2);
    const now = entriesOf(p2);
    expect(now.map((e) => e.id).slice(0, before.length)).toEqual(before);
    expect(now.at(-1)?.payload).toMatchObject([{ label: "Stealth" }]);
    expect(now.some((e) => e.n === 3)).toBe(false);
    a.intent("dice.setCategoryPublic", { category: "skill-check", public: false }, "s3");
    await a.next("ack");
    for (const c of [a, b, p2]) c.close();
  });

  test("DICE §13 leak scan + convergence + restart: identical snapshots", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    dm.intent("dice.roll", { expression: "1d6", category: "damage", public: false, label: SECRET });
    await dm.next("ack");
    dm.intent("dice.roll", { expression: "1d6", category: "damage" });
    await dm.next("ack");
    await barrier(p1);
    expect(p1.raw()).not.toContain(SECRET);
    expect(p1.raw()).not.toContain("dmPayload");
    expect(leakScan(h.s, p1)).toEqual([]);
    const fresh = await h.live(p("Player 1"));
    const c = convergence(h.s, p1, fresh);
    expect(c.live[GAME_LOG_ENTRY_TYPE]).toEqual(c.fresh[GAME_LOG_ENTRY_TYPE] ?? {});
    for (const x of [dm, p1, fresh]) x.close();

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        out[k] = {
          entries: client.store.records[GAME_LOG_ENTRY_TYPE],
          settings: client.store.records[GAME_LOG_SETTINGS_TYPE],
        };
        client.close();
      }
      return out;
    };
    const before = await snap();
    const rollCount = db.select().from(roll).all().length;
    await h.restart();
    expect(await snap()).toEqual(before);
    expect(db.select().from(roll).all()).toHaveLength(rollCount);
    expect(db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all().at(-1)?.n).toBe(
      rollCount,
    );
  });
});

describe("FR-DICE-17 window over WS (ADR-0029)", () => {
  let h: TestServer;
  beforeAll(async () => {
    h = await startTestServer({ fake: false });
  });
  afterAll(async () => {
    await h.stop();
  });

  test("FR-DICE-17 105 entries → newest 100; markUndone below the floor live; convergence", async () => {
    const t = seedDice(h.s);
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) {
      const r = h.s.commands.run(
        "dice.roll",
        { expression: "1d4", public: i % 2 === 0 },
        { actor: t.dm },
      ) as { entryId: string };
      ids.push(r.entryId);
    }
    h.s.commands.register(
      defineCommand({
        name: "test.undo",
        input: z.object({ id: z.string() }),
        execute({ id }, env) {
          const change = gameLog.markUndone(env, id);
          env.emit({
            type: "DiceRolled",
            campaignId: env.actor.campaignId,
            payload: { entryId: id, rollIds: ["x"] },
            changes: [change],
          });
        },
      }),
    );
    const dm = await h.live(DM);
    const pl = await h.live({ role: "player", token: t.p1.linkToken });
    expect(entriesOf(dm).map((e) => e.n)).toEqual(Array.from({ length: 100 }, (_, i) => i + 6));
    expect(entriesOf(pl).every((e) => e.n >= 6 && e.public)).toBe(true);
    expect(entriesOf(pl)).toHaveLength(50);
    // Undo entry n = 1 (below the floor, public): delivered live to both.
    h.s.commands.run("test.undo", { id: ids[0] }, { actor: t.dm });
    const de = await nextEvent(dm, "DiceRolled");
    expect(de.changes[0]).toMatchObject({ id: ids[0], op: "upsert", data: { undone: true } });
    const pe = await nextEvent(pl, "DiceRolled");
    expect(pe.changes[0]).toMatchObject({ id: ids[0], op: "upsert" });
    for (const [live, cred] of [
      [dm, DM],
      [pl, { role: "player" as const, token: t.p1.linkToken }],
    ] as const) {
      const fresh = await h.live(cred);
      expect(fresh.store.records[GAME_LOG_ENTRY_TYPE]?.[ids[0] as string]).toBeUndefined();
      const c = convergence(h.s, live, fresh);
      expect(c.live[GAME_LOG_ENTRY_TYPE]).toEqual(c.fresh[GAME_LOG_ENTRY_TYPE] ?? {});
      fresh.close();
    }
    dm.close();
    pl.close();
  });
});
