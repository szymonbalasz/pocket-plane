// Sprint 10, H1 (BL-92, protocol gate I15) over real sockets on `mid-combat`: the three card
// updates that used to emit their own `NotificationUpdated` ride on their domain event, so each
// action sends one event frame to the DM and to the card's owner: Apply hit (`ruled`), the damage
// that completes a to-hit-only card, and a second damage roll on the completed card (unused).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  type DamageCardPayload,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { partRollIdsFor } from "./testing";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const byName = (c: TestClient, name: string) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  );
const card = (c: TestClient, id: string) =>
  c.store.records.notification?.[id] as NotificationRecord | undefined;
/** The event frames a client got since `mark` (after a barrier). */
const eventsSince = (c: TestClient, mark: number) =>
  c.frames.slice(mark).filter((f): f is Extract<ServerFrame, { type: "event" }> => {
    return f.type === "event";
  });

describe("BL-92 one frame per card action (mid-combat)", () => {
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

  test("FR-NOTE-74 Apply hit, completing damage and an unused roll each send one event frame carrying the card", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = byName(p1, "Mira") as CombatantRecord;
    const goblin = byName(dm, "Goblin") as CombatantRecord;

    p1.intent("cbt.attack", { attackerId: mira.id, rolls: "toHit", manual: [{ diceTotal: 11 }] });
    const { cardId } = (await p1.next("ack")).result as AttackResult;
    for (const c of [dm, p1, p2]) await barrier(c);

    /** Runs one action and checks each client's event frames for it. */
    const one = async (cause: string, act: () => Promise<unknown>) => {
      const marks = [dm, p1, p2].map((c) => c.frames.length);
      await act();
      for (const c of [dm, p1, p2]) await barrier(c);
      const [d, a, b] = [dm, p1, p2].map((c, i) => eventsSince(c, marks[i] as number));
      for (const evs of [d, a]) {
        expect(evs.map((e) => e.cause.name)).toEqual([cause]);
        expect(evs[0]?.changes.filter((x) => x.id === cardId)).toHaveLength(1);
      }
      // Player-2 never gets player-1's card, nor a frame of its own for it.
      expect(JSON.stringify(b)).not.toContain(cardId);
      expect(b.map((e) => e.cause.name)).not.toContain("NotificationUpdated");
    };

    // Apply hit: the card gains `ruled` inside HitApplied.
    await one("HitApplied", async () => {
      dm.intent("cbt.applyHit", {
        cardId,
        toHitTotal: 15,
        targets: [{ targetId: goblin.id, hit: true, multiplier: "normal" }],
        partRollIds: partRollIdsFor(dm.store.records.notification?.[cardId]),
      });
      await dm.next("ack");
    });
    expect((card(p1, cardId)?.payload as DamageCardPayload | undefined)?.ruled).toBe(true);

    // Damage completes the to-hit-only card inside DamageRolled.
    await one("DamageRolled", async () => {
      p1.intent("cbt.rollDamage", { attackerId: mira.id, manual: { diceTotal: 4 } });
      const r = (await p1.next("ack")).result as RollDamageResult;
      expect(r).toMatchObject({ cardId, attached: true });
    });
    expect(card(dm, cardId)?.text).toBe("Mira: 15 to hit, 6 piercing");

    // A second roll on the completed card: no new card; `unusedRolls` inside DamageRolled.
    await one("DamageRolled", async () => {
      p1.intent("cbt.rollDamage", { attackerId: mira.id, manual: { diceTotal: 2 } });
      const r = (await p1.next("ack")).result as RollDamageResult;
      expect(r).toMatchObject({ cardId, unused: true });
    });
    expect((card(p1, cardId)?.payload as DamageCardPayload | undefined)?.unusedRolls).toHaveLength(
      1,
    );
    for (const c of [dm, p1, p2]) c.close();
  });
});
