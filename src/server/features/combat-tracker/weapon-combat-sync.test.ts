// Sprint 4 S4-1b over real sockets on `rules-effects` (MOD §13.1): player-1's Flame Tongue attack
// and the DM's per-part apply on Goblin (Fire Ward). Players get the card (owner only) and the
// outcome line with `damageParts` values; extra-part dice, defense facts and hp_change rows never
// reach them, live or after a reconnect (rulings B4, FR-CHARX-57).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadRulesEffects } from "@fixtures/units/effect-modifiers/rules-effects";
import type { AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  HP_CHANGE_TYPE,
  LOG_KIND_ATTACK,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { Attack } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const byName = (c: TestClient, name: string) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  );
const attackEntries = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryView[])
    .filter((e) => e.kind === LOG_KIND_ATTACK)
    .sort((a, b) => a.n - b.n);
const lastLine = (c: TestClient) => {
  const e = attackEntries(c).at(-1);
  return e ? lineText(formatEntry(e).segments) : null;
};

/** What players must never receive about the apply (MOD §13.1 leak strings). */
const LEAKS = ["dmPayload", "extraDefense", "damage_parts", HP_CHANGE_TYPE];
/** On the outcome line itself: no dice of any part (the player's own roll line has its own). */
const LINE_LEAKS = ['"rolled"', "2d6", "expression"];

describe("weapon parts over WS (rules-effects)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadRulesEffects({ dmSecret: TEST_SECRET, testMode: true });
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

  test("FR-CBT-84 leak: players' line carries part values only; extra-part dice, defense facts, hp_change never reach players (live and after reconnect)", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const brakka = byName(p1, "Brakka") as CombatantRecord;
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    const stats = (
      dm.store.records.entity?.[brakka.entityId as string] as {
        statBlock: { attacks: Attack[] };
      }
    ).statBlock;
    const flame = stats.attacks.find((a) => a.name === "Flame Tongue greatsword") as Attack;

    // Step 3 (Rage spent: no Divine Fury offer): d20 14; slashing 3 + 5; fire 2 + 6.
    p1.intent("cbt.attack", {
      attackerId: brakka.id,
      attackId: flame.id,
      manual: [{ diceTotal: 14 }, { diceTotal: 8, dice: [3, 5] }],
      manualExtra: [{ diceTotal: 8, dice: [2, 6] }],
    });
    const { cardId } = (await p1.next("ack")).result as AttackResult;
    for (const c of [dm, p1, p2]) await barrier(c);
    const card = (c: TestClient) =>
      c.store.records.notification?.[cardId] as NotificationRecord | undefined;
    expect(card(p1)?.text).toBe("Brakka: 22 to hit, 13 slashing + 8 fire");
    expect(card(dm)?.text).toBe("Brakka: 22 to hit, 13 slashing + 8 fire");
    expect(card(p2)).toBeUndefined();

    const before = [p1.frames.length, p2.frames.length];
    dm.intent("cbt.applyCard", {
      cardId,
      toHitTotal: 22,
      damageTotal: 13,
      targets: [
        { targetId: goblin.id, hit: true, multiplier: "normal", extraMultipliers: ["half"] },
      ],
    });
    await dm.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(lastLine(dm)).toContain("+ 4 fire (half) (2d6: 2 + 6) damage");
    for (const c of [p1, p2]) {
      expect(lastLine(c)).toBe(
        "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 13 slashing + 4 fire (half) damage (physical)",
      );
      expect((attackEntries(c).at(-1)?.payload as AttackLogPayload).damageParts).toEqual([
        { type: "fire", value: 4, multiplier: "half" },
      ]);
    }
    for (const [i, c] of [p1, p2].entries()) {
      const frames = JSON.stringify(c.frames.slice(before[i]));
      for (const leak of [...LEAKS, ...LINE_LEAKS]) expect(frames).not.toContain(leak);
    }

    // Reconnect: the snapshot carries the same player-safe line, nothing more.
    for (const name of ["Player 1", "Player 2"]) {
      const again = await h.live(p(name));
      expect(lastLine(again)).toContain("13 slashing + 4 fire (half) damage");
      const snapshot = JSON.stringify(again.frames);
      for (const leak of LEAKS) expect(snapshot).not.toContain(leak);
      const line = JSON.stringify(attackEntries(again).at(-1));
      for (const leak of LINE_LEAKS) expect(line).not.toContain(leak);
    }
  });
});
