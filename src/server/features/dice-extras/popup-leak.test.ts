// DICEX §13 sprint 4 integration over real sockets on `dice-display`: the DM's hidden roll
// ("DM-SECRET-DICE", eye off), the encounter start's monster initiative lines (FR-CBT-69) and a
// DM attack roll (FR-CBT-52) never reach a player frame, before or after a reconnect
// (FR-DICEX-38); a player `1d20+5` `DiceRolled` frame stays ≤ 1.2 KB (CON-44).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import {
  type DiceRollResult,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryRecord,
} from "@shared/dice-roll-log/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { SCENE_TYPE, type SceneRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const SECRET = "DM-SECRET-DICE";
/** CON-44 (DICEX §12): a player `1d20+5` `DiceRolled` frame (measured 765–782 B). */
const ROLL_FRAME_MAX = 1200;

type EventFrame = Extract<ServerFrame, { type: "event" }>;

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];
const events = (c: TestClient, from = 0) =>
  c.frames.slice(from).filter((f): f is EventFrame => f.type === "event");
/** Game-log entries upserted by the event frames since `from`. */
const logLines = (c: TestClient, from = 0) =>
  events(c, from).flatMap((e) =>
    e.changes
      .filter((x) => x.type === GAME_LOG_ENTRY_TYPE && x.op === "upsert")
      .map((x) => x.data as GameLogEntryRecord),
  );
/** The raw text of the first `cause` event frame since `from` (raw lines pair with `frames`). */
const rawEventSince = (c: TestClient, from: number, cause: string) => {
  const lines = c.raw().split("\n");
  const i = c.frames.findIndex((f, j) => j >= from && f.type === "event" && f.cause.name === cause);
  return i < 0 ? undefined : lines[i];
};

describe("FR-DICEX-38 hidden rolls over sockets (dice-display)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let miraId: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  /** DM-only entry ids made by the three DM actions (+ the attack's card). */
  let hidden: string[] = [];
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const expectClean = (c: TestClient, label: string) => {
    const raw = c.raw();
    expect([label, [SECRET, ...hidden].filter((s) => raw.includes(s))]).toEqual([label, []]);
    expect([label, leakScan(h.s, c)]).toEqual([label, []]);
  };

  beforeAll(async () => {
    const loaded = await loadBundle("dice-display", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const active = db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.active)?.id;
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .filter((p) => p.campaignId === active)
        .map((r) => [r.name, r.linkToken]),
    );
    miraId = db
      .select()
      .from(entity)
      .all()
      .find((e) => e.campaignId === active && e.name === "Mira")?.id as string;
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
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

  test("FR-DICEX-38 hidden roll never reaches a player frame (real sockets, dice-display): eye-off roll, cbt.start, DM attack; reconnect", async () => {
    const mark = dm.frames.length;
    const playerMarks = [p1, p2].map((c) => c.frames.length);

    // 1. DM roll with the eye off.
    const rolled = await answer(
      dm,
      dm.intent("dice.roll", { expression: "1d20", public: false, label: SECRET }),
    );
    expect(rolled.type).toBe("ack");
    const { entryId } = (rolled as { result: DiceRollResult }).result;

    // 2. Start "Ambush at the Ford" on Goblin Ambush: monster initiative lines are DM-only.
    const enc = all<EncounterRecord>(dm, ENCOUNTER_TYPE).find(
      (e) => e.name === "Ambush at the Ford",
    ) as EncounterRecord;
    const scene = all<SceneRecord>(dm, SCENE_TYPE).find((s) => s.name === "Goblin Ambush");
    const started = await answer(
      dm,
      dm.intent("cbt.start", { encounterId: enc.id, sceneId: scene?.id }),
    );
    expect(started.type).toBe("ack");

    // 3. DM Initiative ▸ Attack on Mira: a Goblin's attack roll, DM-only (FR-CBT-52).
    const goblin = all<CombatantRecord>(dm, COMBATANT_TYPE).find(
      (c) => c.name === "Goblin",
    ) as CombatantRecord;
    expect(all<CombatantRecord>(dm, COMBATANT_TYPE).some((c) => c.name === "Mira")).toBe(true);
    const attacked = await answer(dm, dm.intent("cbt.attack", { attackerId: goblin.id }));
    expect(attacked.type).toBe("ack");
    const { cardId } = (attacked as { result: AttackResult }).result;

    // The DM did receive them (not vacuous): the roll, ≥ 1 initiative line, the attack line.
    const dmOnly = logLines(dm, mark).filter((e) => e.public === false);
    expect(dmOnly.map((e) => e.id)).toContain(entryId);
    expect(dmOnly.some((e) => e.category === "initiative")).toBe(true);
    expect(dmOnly.some((e) => e.category === "attack" && e.rollerRole === "dm")).toBe(true);
    expect(dm.raw()).toContain(SECRET);
    hidden = [...new Set([...dmOnly.map((e) => e.id), cardId])];

    for (const [i, c] of [p1, p2].entries()) {
      await barrier(c);
      // Players did get the start itself; only DM-only lines are held back.
      expect(events(c, playerMarks[i]).some((e) => e.cause.name === "EncounterStarted")).toBe(true);
      expect(logLines(c, playerMarks[i]).every((e) => e.public)).toBe(true);
      expectClean(c, `player-${i + 1} live`);
    }

    // Reconnect: the fresh snapshot holds none of them either.
    for (const name of ["Player 1", "Player 2"] as const) {
      const old = name === "Player 1" ? p1 : p2;
      old.close();
      await old.closed;
      const fresh = await h.live(cred(name));
      expect(all(fresh, GAME_LOG_ENTRY_TYPE).length).toBeGreaterThan(0);
      expectClean(fresh, `${name} after reconnect`);
      if (name === "Player 1") p1 = fresh;
      else p2 = fresh;
    }
  });

  test("FR-DICEX-39 CON-44 a player 1d20+5 DiceRolled frame ≤ 1.2 KB (DM, player-2, roller)", async () => {
    const marks = { dm: dm.frames.length, p2: p2.frames.length, p1: p1.frames.length };
    const intentId = p1.intent("dice.roll", {
      expression: "1d20+5",
      category: "skill-check",
      label: "Perception",
      actor: { entityId: miraId },
    });
    expect((await answer(p1, intentId)).type).toBe("ack");
    const sizes: Record<string, number> = {};
    for (const [name, c] of Object.entries({ dm, p2, p1 })) {
      await barrier(c);
      const text = rawEventSince(c, marks[name as keyof typeof marks], "DiceRolled");
      expect([name, text === undefined]).toEqual([name, false]);
      const f = JSON.parse(text as string) as EventFrame;
      expect(f.cause.name).toBe("DiceRolled");
      sizes[name] = Buffer.byteLength(text as string, "utf8");
    }
    console.log("CON-44 player 1d20+5 DiceRolled frame bytes", sizes);
    for (const [name, bytes] of Object.entries(sizes)) {
      expect([name, bytes <= ROLL_FRAME_MAX]).toEqual([name, true]);
    }
  });
});
