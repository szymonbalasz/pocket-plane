// Sprint 15 bundle `tray-attacks` (CBT §13.8, FR-CBT-177, #385): `rules-effects` +
// `kit-mira-spells` + `tray-log-rolls` loads from empty and is deterministic: the fight at round
// 1, the Wolf's turn; three unused plain log lines (the DM's hidden 2d6, Player 1's 1d20+5 as Mira
// and 1d8+1d6 as themselves), no card yet.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb, type Db } from "@server/db/client";
import { combatant, encounter, gameLogEntry, notification, player } from "@server/db/schema";
import {
  type GameLogEntryRecord,
  isUsedRoll,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "tray-attacks";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

const load = async () => {
  const r = await loadBundle(BUNDLE, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
};

/** The bundle's plain roll lines (no encounter), oldest first. */
const plainLines = (db: Db) =>
  (
    db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all() as GameLogEntryRecord[]
  ).filter((e) => e.kind === "roll" && e.encounterId === null);

describe("tray-attacks bundle (CBT §13.8)", () => {
  test("FR-CBT-177 tray-attacks loads from empty: round 1, the Wolf's turn; three unused plain lines; no card", async () => {
    const { r, db } = await load();
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-2)).toEqual(["kit-mira-spells", "tray-log-rolls"]);
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    expect(enc?.round).toBe(1);
    const rows = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id as string))
      .all();
    expect(rows.find((c) => c.id === enc?.turnCombatantId)?.name).toBe("Wolf");
    const init = Object.fromEntries(rows.map((c) => [c.name, c.initiative]));
    expect(init).toMatchObject({
      Wolf: 18,
      Brakka: 17,
      Mira: 15,
      Goblin: 12,
      "Goblin 2": 12,
      Thorn: 10,
      "Elite Goblin Warrior": 8,
    });
    const p1 = db.select().from(player).where(eq(player.name, "Player 1")).get();
    const lines = plainLines(db).slice(-3);
    expect(
      lines.map((e) => [
        (e.payload as RollEntryPayload).map((i) => i.expression),
        e.actorName,
        e.rollerRole,
        e.public,
      ]),
    ).toEqual([
      [["2d6"], "DM", "dm", false],
      [["1d20+5"], "Mira", "player", true],
      [["1d8+1d6"], "Player 1", "player", true],
    ]);
    expect(lines.slice(1).every((e) => e.rollerPlayerId === p1?.id)).toBe(true);
    expect(lines.some((e) => isUsedRoll(e))).toBe(false);
    expect(
      db.select().from(notification).where(eq(notification.kind, "damage-card")).all(),
    ).toEqual([]);
  }, 60_000);

  test("FR-CBT-177 tray-attacks deterministic: two loads give identical lines", async () => {
    const a = await load();
    const b = await load();
    expect(plainLines(b.db)).toEqual(plainLines(a.db));
  }, 90_000);
});
