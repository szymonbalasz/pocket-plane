// Sprint 15 (#385) Use as attack / damage over real sockets on `tray-attacks` (FR-CBT-175, -176,
// FR-DICE-96): the card reaches the DM and its audience player only; the entry upsert reaches
// whoever holds the entry, without its DM-only stamp; a retry after reconnect is refused and the
// card is in the snapshot.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  type UseRollResult,
} from "@shared/combat-tracker/schemas";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };
/** Leak strings for player frames (CBT §13.8). */
const LEAKS = ["usedByCardId", "dmPayload"];

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
const combatant = (c: TestClient, name: string) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  ) as CombatantRecord;
const entries = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryView[]).sort(
    (a, b) => a.n - b.n,
  );
/** The fixture's plain line rolled as `expression` (one item). */
const lineOf = (c: TestClient, expression: string) =>
  entries(c).find(
    (e) => e.kind === "roll" && (e.payload as RollEntryPayload)[0]?.expression === expression,
  ) as GameLogEntryView;
const card = (c: TestClient, id: string) =>
  c.store.records.notification?.[id] as NotificationRecord | undefined;

describe("Use as attack / damage over WS (tray-attacks)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("tray-attacks", { dmSecret: TEST_SECRET, testMode: true });
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

  test("FR-CBT-175 use roll visibility / FR-DICE-96 stamp never reaches players: DM card DM-only; owner card to the owner; entry upserts redacted", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const hidden = lineOf(dm, "2d6");
    const asMira = lineOf(dm, "1d20+5");
    const asMe = lineOf(dm, "1d8+1d6");
    expect([hidden.public, asMira.public, asMe.public]).toEqual([false, true, true]);
    // Players hold the public lines only, without `dmPayload`.
    expect(lineOf(p2, "2d6")).toBeUndefined();
    expect(lineOf(p2, "1d20+5")).toBeDefined();
    const start = [p1.frames.length, p2.frames.length];

    // (1) The DM's hidden 2d6 → Goblin 2's damage-only DM card: nothing reaches players.
    dm.intent("cbt.useRoll", {
      entryId: hidden.id,
      as: "damage",
      attackerId: combatant(dm, "Goblin 2").id,
      types: ["bludgeoning"],
    });
    const dmCard = (await dm.next("ack")).result as UseRollResult;
    // The DM's frames precede its ack: RollUsed (the entry), then the card's NotificationCreated.
    const dmEvents = dm.frames.flatMap((f) => (f.type === "event" ? [f] : []));
    const used = dmEvents.find((f) => f.cause.name === "RollUsed");
    expect(used?.changes.map((x) => x.type)).toEqual([GAME_LOG_ENTRY_TYPE]);
    expect(dmEvents.at(-1)?.cause.name).toBe("NotificationCreated");
    expect(card(dm, dmCard.cardId)?.audience).toBe("dm");
    expect(
      (dm.store.records[GAME_LOG_ENTRY_TYPE]?.[hidden.id] as GameLogEntryView | undefined)
        ?.dmPayload,
    ).toMatchObject({ usedByCardId: dmCard.cardId });
    for (const c of [p1, p2]) await barrier(c);
    for (const [i, c] of [p1, p2].entries()) {
      const frames = JSON.stringify(c.frames.slice(start[i]));
      expect(frames).not.toContain(dmCard.cardId);
      expect(frames).not.toContain("RollUsed");
    }

    // (2) Player 1's 1d20+5 as Mira → Mira's to-hit-only card to Player 1 (toast); Player 2 never
    // gets the card. The entry upsert differs only in its DM-only stamp, so redacted it is the
    // row players hold: dropped as identical (ADR-0042), `RollUsed` arrives without changes.
    const mark = [p1.frames.length, p2.frames.length];
    dm.intent("cbt.useRoll", {
      entryId: asMira.id,
      as: "attack",
      attackerId: combatant(dm, "Mira").id,
    });
    const miraCard = (await dm.next("ack")).result as UseRollResult;
    expect(miraCard.attached).toBe(false);
    const p1Used = await nextEvent(p1, "RollUsed");
    expect(p1Used.changes).toEqual([]);
    await nextEvent(p1, "NotificationCreated");
    expect(card(p1, miraCard.cardId)?.text).toMatch(/^Mira: \d+ to hit \(Attack\)$/);
    const p2Used = await nextEvent(p2, "RollUsed");
    expect(p2Used.changes).toEqual([]);

    // (3) Player 1's 1d8+1d6 as themselves → completes Mira's card (rowless match): one frame to
    // Player 1 with the card (no toast); Player 2 nothing new.
    dm.intent("cbt.useRoll", {
      entryId: asMe.id,
      as: "damage",
      attackerId: combatant(dm, "Mira").id,
      types: ["piercing"],
    });
    expect((await dm.next("ack")).result).toEqual({ cardId: miraCard.cardId, attached: true });
    const completed = await nextEvent(p1, "RollUsed");
    expect(completed.changes.map((x) => x.type)).toEqual(["notification"]);
    expect(card(p1, miraCard.cardId)?.text).toMatch(/^Mira: \d+ to hit, \d+ piercing$/);
    const p2Completed = await nextEvent(p2, "RollUsed");
    expect(p2Completed.changes).toEqual([]);
    for (const c of [p1, p2]) await barrier(c);

    // Leak scan: no stamp, no dmPayload, no DM card in any player frame; Player 2 no card at all.
    for (const [i, c] of [p1, p2].entries()) {
      const frames = JSON.stringify(c.frames.slice(start[i]));
      for (const leak of [...LEAKS, dmCard.cardId]) expect(frames).not.toContain(leak);
    }
    const p2Frames = JSON.stringify(p2.frames.slice(mark[1]));
    expect(p2Frames).not.toContain(miraCard.cardId);
    expect(p2Frames).not.toContain("NotificationCreated");

    // After reconnect: the snapshots carry no stamp either; the DM's carries both.
    const dm2 = await h.live(DM);
    const p1b = await h.live(p("Player 1"));
    const p2b = await h.live(p("Player 2"));
    expect(JSON.stringify(dm2.frames)).toContain("usedByCardId");
    for (const c of [p1b, p2b]) {
      const snap = JSON.stringify(c.frames);
      for (const leak of [...LEAKS, dmCard.cardId]) expect(snap).not.toContain(leak);
    }
    expect(card(p1b, miraCard.cardId)?.state).toBe("pending");
    expect(card(p2b, miraCard.cardId)).toBeUndefined();
    for (const c of [dm, p1, p2, dm2, p1b, p2b]) c.close();
  });

  test("FR-CBT-176 retry after reconnect: a committed cbt.useRoll retried → conflict 'Already used by a card'; the card is in the snapshot", async () => {
    const p1 = await h.live(p("Player 1"));
    p1.intent("dice.roll", { expression: "1d20+4" });
    const rolled = (await p1.next("ack")).result as { entryId: string };
    const dm = await h.live(DM);
    const input = {
      entryId: rolled.entryId,
      as: "attack",
      attackerId: combatant(dm, "Brakka").id,
    };
    dm.intent("cbt.useRoll", input);
    const made = (await dm.next("ack")).result as UseRollResult;
    dm.close();
    const again = await h.live(DM);
    expect(card(again, made.cardId)?.state).toBe("pending");
    again.intent("cbt.useRoll", input);
    const rejected = await again.next("reject");
    expect([rejected.code, rejected.message]).toEqual(["conflict", "Already used by a card"]);
    // Brakka is Player 1's: the card went to them.
    await barrier(p1);
    expect(card(p1, made.cardId)?.audience).toBe("player");
    for (const c of [p1, again]) c.close();
  });
});
