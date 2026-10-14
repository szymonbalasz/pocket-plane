// Polish pass (sprint 1, #178) over real sockets on `mid-combat`: FR-CBT-58 rulings against a
// natural roll reach players only as client-built text from `payload`; FR-CBT-59 End dismisses
// pending cards (player frames, restart).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
  LOG_KIND_ATTACK,
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
const combatants = (c: TestClient) =>
  Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[];
const byName = (c: TestClient, name: string) => combatants(c).find((x) => x.name === name);
/** The rendered `cbt.attack` lines this client holds, in log order. */
const attackLines = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryView[])
    .filter((e) => e.kind === LOG_KIND_ATTACK)
    .sort((a, b) => a.n - b.n)
    .map((e) => lineText(formatEntry(e).segments));

describe("polish over WS (mid-combat)", () => {
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

  test("FR-CBT-58 leak: a non-natural ruling never reaches players; a natural ruling does, with the agreed copy", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = byName(p1, "Mira") as CombatantRecord;
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    /** Mira attacks with physical dice; the DM rules Hit on Goblin (AC 15). */
    const ruledHit = async (d20: number) => {
      p1.intent("cbt.attack", {
        attackerId: mira.id,
        manual: [{ diceTotal: d20 }, { diceTotal: 4 }],
      });
      const { cardId } = (await p1.next("ack")).result as AttackResult;
      await nextEvent(dm, "NotificationCreated");
      dm.intent("cbt.applyCard", {
        cardId,
        toHitTotal: d20 + 4,
        damageTotal: 6,
        targets: [{ targetId: goblin.id, hit: true, multiplier: "normal" }],
      });
      await dm.next("ack");
      for (const c of [p1, p2]) await barrier(c);
    };

    // Non-natural: 9 + 4 = 13 vs AC 15, ruled Hit → DM-only (G8).
    await ruledHit(9);
    expect(attackLines(dm).at(-1)).toBe(
      "Mira attacks Goblin: 9 + 4 = 13 (physical) vs AC 15 — DM ruled hit 6 piercing damage (1d6+2: 4 + 2) (physical)",
    );
    for (const c of [p1, p2]) {
      expect(attackLines(c).at(-1)).toBe(
        "Mira attacks Goblin: 9 + 4 = 13 (physical) — hit! 6 piercing damage (physical)",
      );
    }

    // Natural 1 ruled Hit → public, built client-side from `payload`.
    await ruledHit(1);
    expect(attackLines(dm).at(-1)).toBe(
      "Mira attacks Goblin: 1 + 4 = 5 (physical) (natural 1) vs AC 15 — DM ruled hit 6 piercing damage (1d6+2: 4 + 2) (physical)",
    );
    for (const c of [p1, p2]) {
      expect(attackLines(c).at(-1)).toBe(
        "Mira attacks Goblin: 1 + 4 = 5 (physical) (natural 1) — DM ruled hit 6 piercing damage (physical)",
      );
      // A player sees "DM ruled" only on the natural line; frames never carry it.
      expect(attackLines(c).filter((l) => l.includes("DM ruled"))).toHaveLength(1);
      for (const leak of ["DM ruled", "DM set", "dmPayload"]) expect(c.raw()).not.toContain(leak);
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CBT-59 End over WS: pending cards dismissed; player-1 gets its card dismissed, player-2 nothing; restart → identical", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = byName(p1, "Mira") as CombatantRecord;
    p1.intent("cbt.attack", { attackerId: mira.id, manual: [{ diceTotal: 12 }, { diceTotal: 3 }] });
    const { cardId } = (await p1.next("ack")).result as AttackResult;
    await nextEvent(dm, "NotificationCreated");
    const notes = (c: TestClient) =>
      Object.values(c.store.records.notification ?? {}) as NotificationRecord[];
    const pending = notes(dm).filter((n) => n.state === "pending");
    // The `mid-combat` Elite card (combat-pending) and Mira's new card.
    expect(pending.map((n) => n.text.split(":")[0]).sort()).toEqual([
      "Elite Goblin Warrior",
      "Mira",
    ]);
    const enc = Object.values(dm.store.records[ENCOUNTER_TYPE] ?? {})[0] as EncounterRecord;
    for (const c of [p1, p2]) await barrier(c);
    const p2Frames = p2.raw().length;

    dm.intent("cbt.end", { encounterId: enc.id });
    expect((await nextEvent(dm, "EncounterEnded")).cause.name).toBe("EncounterEnded");
    const d1 = await nextEvent(dm, "NotificationDismissed");
    const d2 = await nextEvent(dm, "NotificationDismissed");
    expect([d1, d2].map((e) => e.changes[0]?.id).sort()).toEqual(pending.map((n) => n.id).sort());
    await dm.next("ack");
    expect(notes(dm).filter((n) => n.state === "pending")).toEqual([]);

    await nextEvent(p1, "EncounterEnded");
    const own = await nextEvent(p1, "NotificationDismissed");
    expect(own.changes).toEqual([
      expect.objectContaining({
        id: cardId,
        data: expect.objectContaining({ state: "dismissed" }),
      }),
    ]);
    await barrier(p2);
    const p2Since = p2.raw().slice(p2Frames);
    expect(p2Since).toContain("EncounterEnded");
    expect(p2Since).not.toContain("NotificationDismissed");
    expect(p2Since).not.toContain(cardId);
    for (const c of [dm, p1, p2]) c.close();

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        out[k] = [ENCOUNTER_TYPE, COMBATANT_TYPE, "notification"].map(
          (type) => client.store.records[type],
        );
        client.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
