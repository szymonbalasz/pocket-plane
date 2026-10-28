// Sprint 14 F2 (BL-137, K9 walkthrough): a player's Notifications lists their own attack's card,
// pending on the DM, under "Waiting" (client). Leak check over real sockets on the `mid-combat`
// bundle: the rows a player's Waiting section can hold are only the ones FR-NOTE-06 already sends
// them: their own card. Another player's card and the DM's card never reach them: not in frames,
// not in the snapshot, not after a reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const byName = (c: TestClient, name: string) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  );
const notes = (c: TestClient) =>
  Object.values(c.store.records.notification ?? {}) as NotificationRecord[];
/** Rows a player's Notifications shows under Waiting: pending, visible, owned by someone else. */
const waitingOf = (c: TestClient, me: string) =>
  notes(c).filter(
    (n) => n.state === "pending" && !(n.actionRole === "player" && n.actionPlayerId === me),
  );

describe("BL-137 a player's Waiting rows: own cards only", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, { token: string; id: string }>;
  const p = (name: string) => ({
    role: "player" as const,
    token: (tokens[name] as { token: string }).token,
  });

  beforeAll(async () => {
    const loaded = await loadBundle("mid-combat", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken, id: player.id })
        .from(player)
        .all()
        .map((r) => [r.name, { token: r.token, id: r.id }]),
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

  test("FR-NOTE-06 FR-NOTE-17 BL-137 leak scan: Player 1 waits on their own card only; Player 2 and the DM's card never reach a player, live or after a reconnect", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const p1Id = (tokens["Player 1"] as { id: string }).id;
    const p2Id = (tokens["Player 2"] as { id: string }).id;
    // Player 1's Mira attacks: a card for Player 1, pending on the DM ("Waiting for DM").
    const mira = byName(p1, "Mira") as CombatantRecord;
    p1.intent("cbt.attack", { attackerId: mira.id });
    const own = ((await p1.next("ack")).result as AttackResult).cardId as string;
    // The DM's Goblin attacks: a DM-only card.
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    dm.intent("cbt.attack", {
      attackerId: goblin.id,
      manual: [{ diceTotal: 9 }, { diceTotal: 4 }],
    });
    const dmCard = ((await dm.next("ack")).result as AttackResult).cardId as string;
    for (const c of [dm, p1, p2]) await barrier(c);

    expect(waitingOf(p1, p1Id).map((n) => n.id)).toContain(own);
    expect(p1.store.records.notification?.[own]).toMatchObject({
      state: "pending",
      actionRole: "dm",
      audience: "player",
      audiencePlayerId: p1Id,
    });
    expect(waitingOf(p2, p2Id).map((n) => n.id)).not.toContain(own);
    for (const c of [p1, p2]) {
      expect(c.raw()).not.toContain(dmCard);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(p2.raw()).not.toContain(own);
    // Every row a player waits on is addressed to them (FR-NOTE-06): no other audience.
    for (const [c, me] of [
      [p1, p1Id],
      [p2, p2Id],
    ] as const) {
      for (const n of waitingOf(c, me)) {
        expect(n.audience === "all" || n.audiencePlayerId === me).toBe(true);
      }
    }

    // Reconnect: the snapshots carry the same.
    p1.close();
    p2.close();
    const r1 = await h.live(p("Player 1"));
    const r2 = await h.live(p("Player 2"));
    expect(waitingOf(r1, p1Id).map((n) => n.id)).toContain(own);
    expect(r1.raw()).not.toContain(dmCard);
    expect(r2.raw()).not.toContain(dmCard);
    expect(r2.raw()).not.toContain(own);
    for (const c of [r1, r2]) expect(leakScan(h.s, c)).toEqual([]);
    for (const c of [dm, r1, r2]) c.close();
  });
});
