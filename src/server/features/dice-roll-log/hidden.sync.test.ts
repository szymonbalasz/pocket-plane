// FR-DICE-99–102 over real sockets on the `dice-log` bundle: the roller and the others get `delete`
// on a hide and `upsert` on a reveal, the DM keeps the line throughout, `hiddenFrom` never reaches
// a player; a hide survives a reconnect and a restart; stats and the recap follow it at once.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { DmLuckResult, PlayerLuckResult, STATS_QUERY_INTENT } from "@shared/stats/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { SET_ENTRY_HIDDEN } from "./hidden";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const entry = (c: TestClient, id: string) =>
  c.store.records[GAME_LOG_ENTRY_TYPE]?.[id] as GameLogEntryRecord | undefined;

async function nextEvent(c: TestClient, cause: string) {
  for (;;) {
    const e = await c.next("event", 1000);
    if (e.cause.name === cause) return e;
  }
}

describe("FR-DICE-99 dice.setEntryHidden over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  let mira: string;
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
    mira = db
      .select()
      .from(entity)
      .all()
      .find((e) => e.name === "Mira")?.id as string;
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

  const rollAs = async (c: TestClient) => {
    c.intent("dice.roll", { expression: "1d20+2", actor: { entityId: mira } }, "roll");
    const ack = await c.next("ack", 1000);
    return (ack.result as { entryId: string }).entryId;
  };

  test("FR-DICE-99 FR-DICE-100 hide → delete for the roller and the others, DM keeps it; reveal → upsert; hiddenFrom never in a player frame", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const id = await rollAs(p1);
    for (const c of [dm, p2]) await nextEvent(c, "DiceRolled");

    dm.intent(SET_ENTRY_HIDDEN, { entryId: id, hidden: true }, "hide");
    for (const c of [p1, p2]) {
      const ev = await nextEvent(c, "LogEntryHiddenSet");
      expect(ev.changes).toEqual([expect.objectContaining({ op: "delete", id })]);
      expect(entry(c, id)).toBeUndefined();
    }
    const dmEv = await nextEvent(dm, "LogEntryHiddenSet");
    expect(dmEv.changes).toEqual([expect.objectContaining({ op: "upsert", id })]);
    expect(entry(dm, id)).toMatchObject({
      public: false,
      hiddenFrom: { public: true, audiencePlayerId: null },
    });
    expect(await dm.next("ack", 1000)).toMatchObject({ intentId: "hide" });

    // A player sending it is refused, and learns nothing.
    p1.intent(SET_ENTRY_HIDDEN, { entryId: id, hidden: false }, "nope");
    expect(await p1.next("reject", 1000)).toMatchObject({ intentId: "nope", code: "forbidden" });

    // Reconnect: the snapshot agrees.
    const fresh = await h.live(p("Player 1"));
    expect(entry(fresh, id)).toBeUndefined();
    expect(convergence(h.s, p1, fresh).live[GAME_LOG_ENTRY_TYPE]).toEqual(
      convergence(h.s, p1, fresh).fresh[GAME_LOG_ENTRY_TYPE] ?? {},
    );
    fresh.close();

    dm.intent(SET_ENTRY_HIDDEN, { entryId: id, hidden: false }, "reveal");
    for (const c of [p1, p2]) {
      const ev = await nextEvent(c, "LogEntryHiddenSet");
      expect(ev.changes).toEqual([expect.objectContaining({ op: "upsert", id })]);
      expect(entry(c, id)).toMatchObject({ public: true });
      expect(entry(c, id)).not.toHaveProperty("hiddenFrom");
      expect(entry(c, id)).not.toHaveProperty("dmPayload");
      expect(c.raw()).not.toContain("hiddenFrom");
      expect(leakScan(h.s, c)).toEqual([]);
    }
    await nextEvent(dm, "LogEntryHiddenSet");
    expect(entry(dm, id)).toMatchObject({ public: true, hiddenFrom: null });
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-DICE-99 a hide survives a server restart", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const id = await rollAs(p1);
    dm.intent(SET_ENTRY_HIDDEN, { entryId: id, hidden: true }, "hide");
    await nextEvent(p1, "LogEntryHiddenSet");
    await dm.next("ack", 1000);
    for (const c of [dm, p1]) c.close();
    await h.restart();
    const dm2 = await h.live(DM);
    const p2 = await h.live(p("Player 1"));
    expect(entry(p2, id)).toBeUndefined();
    expect(entry(dm2, id)).toMatchObject({
      public: false,
      hiddenFrom: { public: true, audiencePlayerId: null },
    });
    for (const c of [dm2, p2]) c.close();
  });

  test("FR-DICE-102 stats: a hidden line counts for the DM only, at once, and back on a reveal", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const ask = async (c: TestClient, input: unknown) => {
      const intentId = c.intent(STATS_QUERY_INTENT, input);
      for (;;) {
        const f = await c.next(undefined, 3000);
        if (f.type === "ack" && f.intentId === intentId) return f.result;
      }
    };
    const sum = (rows: readonly { rolls: number }[]) => rows.reduce((n, r) => n + r.rolls, 0);
    const dmRolls = async () => sum(DmLuckResult.parse(await ask(dm, { scope: "luck" })).luck.rows);
    const playerRolls = async () =>
      sum(PlayerLuckResult.parse(await ask(p1, { scope: "luck" })).luck.rows);

    const id = await rollAs(p1);
    await nextEvent(dm, "DiceRolled");
    const dmBefore = await dmRolls();
    const playerBefore = await playerRolls();

    dm.intent(SET_ENTRY_HIDDEN, { entryId: id, hidden: true }, "hide");
    await nextEvent(p1, "LogEntryHiddenSet");
    await dm.next("ack", 1000);
    expect(await dmRolls()).toBe(dmBefore);
    expect(await playerRolls()).toBe(playerBefore - 1);

    dm.intent(SET_ENTRY_HIDDEN, { entryId: id, hidden: false }, "reveal");
    await nextEvent(p1, "LogEntryHiddenSet");
    await dm.next("ack", 1000);
    expect(await playerRolls()).toBe(playerBefore);
    for (const c of [dm, p1]) c.close();
  });
});
