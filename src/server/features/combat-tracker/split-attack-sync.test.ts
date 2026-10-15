// N7 split attack over real sockets on `mid-combat` (FR-CBT-70/71/73): player-1's to-hit-only
// card completed by the DM's `cbt.rollDamage` reaches player-1 as an upsert of the same card; the
// damage line follows the card owner's public rule; DM-only facts never reach players.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  LOG_KIND_ATTACK,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
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
const byName = (c: TestClient, name: string) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  );
const entries = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryView[]).sort(
    (a, b) => a.n - b.n,
  );
const attackLines = (c: TestClient) =>
  entries(c)
    .filter((e) => e.kind === LOG_KIND_ATTACK)
    .map((e) => lineText(formatEntry(e).segments));
const card = (c: TestClient, id: string) =>
  c.store.records.notification?.[id] as NotificationRecord | undefined;

describe("split attack over WS (mid-combat)", () => {
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

  test("FR-CBT-71 leak: a DM-completed player card's damage line follows the owner's public rule; DM-only facts never reach players", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = byName(p1, "Mira") as CombatantRecord;
    const goblin = byName(dm, "Goblin") as CombatantRecord;

    // FR-CBT-70: player-1's Attack → a to-hit-only card (one toast for the DM).
    p1.intent("cbt.attack", { attackerId: mira.id, rolls: "toHit", manual: [{ diceTotal: 11 }] });
    const { cardId } = (await p1.next("ack")).result as AttackResult;
    await nextEvent(dm, "NotificationCreated");
    expect(card(p1, cardId)?.text).toBe("Mira: 15 to hit (Shortsword)");
    for (const c of [p1, p2]) await barrier(c);
    const p2Before = p2.frames.length;

    // FR-CBT-71: the DM rolls the damage for the absent player → same card, no new one.
    dm.intent("cbt.rollDamage", { attackerId: mira.id, manual: { diceTotal: 4 } });
    const r = (await dm.next("ack")).result as RollDamageResult;
    expect(r).toMatchObject({ cardId, attached: true });
    const upd = await nextEvent(p1, "NotificationUpdated");
    expect(upd.cause.name).toBe("NotificationUpdated");
    expect(card(p1, cardId)?.text).toBe("Mira: 15 to hit, 6 piercing");
    for (const c of [p1, p2]) await barrier(c);
    // The damage line is public (the owner's rule): both players hold it; player-2 no card.
    for (const c of [p1, p2]) {
      expect(entries(c).at(-1)).toMatchObject({ rollIds: r.rollIds, category: "damage" });
    }
    const p2Frames = JSON.stringify(p2.frames.slice(p2Before));
    expect(p2Frames).not.toContain(cardId);
    expect(p2Frames).not.toContain("NotificationCreated");

    // Apply: hit on Goblin (AC 15). Players' line: no AC, no computed hit, no dmPayload.
    const before = [p1.frames.length, p2.frames.length];
    dm.intent("cbt.applyCard", {
      cardId,
      toHitTotal: 15,
      damageTotal: 6,
      targets: [{ targetId: goblin.id, hit: true, multiplier: "normal" }],
    });
    await dm.next("ack");
    for (const c of [p1, p2]) await barrier(c);
    expect(attackLines(dm).at(-1)).toBe(
      // FR-CBT-73: both rolls physical → one badge, at the end.
      "Mira attacks Goblin: 11 + 4 = 15 vs AC 15 — hit! 6 piercing damage (1d6+2: 4 + 2) (physical)",
    );
    for (const [i, c] of [p1, p2].entries()) {
      expect(attackLines(c).at(-1)).toBe(
        "Mira attacks Goblin: 11 + 4 = 15 — hit! 6 piercing damage (physical)",
      );
      const frames = JSON.stringify(c.frames.slice(before[i]));
      for (const leak of ["dmPayload", "targetAc", "hitComputed", "vs AC", "DM ruled", "DM set"]) {
        expect(frames).not.toContain(leak);
      }
    }
  });
});
