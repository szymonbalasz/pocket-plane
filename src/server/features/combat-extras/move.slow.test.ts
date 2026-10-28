// Sprint 8 CB0 over real sockets on `combat-polish` (CBTX §13.1): `cbtx.moveCombatant` checks, the
// A′ numbers (FR-CBTX-65) and their leak scan incl. "PC dropped under the hidden Elite" and 500
// seeded drops, ties kept per fight (FR-CBTX-66), what keeps the order (FR-CBT-163), the turn
// (FR-CBT-164), a hidden move (FR-CBTX-67) and players (FR-CBTX-68). Order as loaded: Wolf 18
// (hidden), Brakka 17 (+ Drake Companion, Fire Elemental 2 lines), Mira 15 (+ Goblin 2, Owlbear,
// Fire Elemental), Thorn 12, Fire Elemental 3 12 (own), Goblin 12 (fog-hidden), Elite 8 (hidden).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import {
  CBT_INTENTS,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { CombatantMoved } from "@shared/events/combat-extras";
import type { ServerFrame } from "@shared/protocol/frames";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, eventLog, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const MOVE = CBTX_INTENTS.moveCombatant;

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
/** Sends an intent and waits for its ack / reject. */
async function send(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
  }
}
async function ok(c: TestClient, name: string, payload: unknown) {
  const f = await send(c, name, payload);
  if (f.type === "reject") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f;
}
async function rejected(c: TestClient, name: string, payload: unknown) {
  const f = await send(c, name, payload);
  if (f.type !== "reject") throw new Error(`${name} not rejected`);
  return { code: f.code, message: f.message };
}

const rows = (c: TestClient) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).filter(
    // Player redactions carry no `active`: they only ever hold active rows.
    (x) => x.active !== false,
  );
const named = (c: TestClient, name: string) => {
  const r = rows(c).find((x) => x.name === name);
  if (!r) throw new Error(`no row ${name}`);
  return r;
};
/** DM order of rows with a rank. */
const order = (c: TestClient) =>
  rows(c)
    .filter((r) => r.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => r.name);
/** A player's Initiative: visible rows by `playerPosition`. */
const playerOrder = (c: TestClient) =>
  rows(c)
    .filter((r) => r.playerPosition != null)
    .sort((a, b) => (a.playerPosition ?? 0) - (b.playerPosition ?? 0))
    .map((r) => r.name);
const encounterOf = (c: TestClient) =>
  (Object.values(c.store.records[ENCOUNTER_TYPE] ?? {}) as EncounterRecord[]).find(
    (e) => e.status === "started",
  ) as EncounterRecord;
const eventFrames = (fs: readonly ServerFrame[]) =>
  fs.filter((f): f is Extract<ServerFrame, { type: "event" }> => f.type === "event");

describe("CB0 cbtx.moveCombatant on combat-polish over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  let encId: string;
  let links: Record<string, string>;
  const move = (name: string, after: string | null) =>
    ok(dm, MOVE, {
      encounterId: encId,
      combatantId: named(dm, name).id,
      afterId: after === null ? null : named(dm, after).id,
    });
  const settle = async () => {
    for (const c of [dm, p1, p2]) await barrier(c);
  };
  const moves = () =>
    db.select().from(eventLog).where(eq(eventLog.type, CombatantMoved.type)).all().length;
  const leaks = () => {
    for (const c of [p1, p2]) expect(leakScan(h.s, c)).toEqual([]);
    for (const c of [p1, p2]) expect(c.raw()).not.toContain("tieOrder");
  };

  beforeEach(async () => {
    const loaded = await loadBundle("combat-polish", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((r) => [r.name, r.linkToken]),
    );
    h = await startTestServer({ db, fake: false });
    const ambush = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const actor = { role: "dm" as const, playerId: null, campaignId: ambush?.campaignId as string };
    h.s.commands.run("map.activateScene", { sceneId: ambush?.sceneId }, { actor });
    dm = await h.live(DM);
    p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    p2 = await h.live({ role: "player", token: links["Player 2"] as string });
    encId = encounterOf(dm).id;
  }, 60_000);

  afterEach(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-CBTX-64 move checks", async () => {
    const id = (n: string) => named(dm, n).id;
    const body = (c: string, a: string | null) => ({
      encounterId: encId,
      combatantId: c,
      afterId: a,
    });
    // removed
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: id("Fire Elemental 3"), removed: true });
    expect(await rejected(dm, MOVE, body(id("Fire Elemental 3"), null))).toEqual({
      code: "conflict",
      message: "Restore Fire Elemental 3 first",
    });
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: id("Fire Elemental 3"), removed: false });
    // attached (after-owner) companion: moves with its owner
    expect(await rejected(dm, MOVE, body(id("Goblin 2"), null))).toEqual({
      code: "conflict",
      message: "Goblin 2 moves with Mira",
    });
    // anchor: attached, itself, removed
    const drop = { code: "invalid" as const, message: "Drop below a row with initiative" };
    expect(await rejected(dm, MOVE, body(id("Thorn"), id("Owlbear")))).toEqual(drop);
    expect(await rejected(dm, MOVE, body(id("Thorn"), id("Thorn")))).toEqual(drop);
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: id("Mira"), removed: true });
    expect(await rejected(dm, MOVE, body(id("Thorn"), id("Mira")))).toEqual(drop);
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: id("Mira"), removed: false });
    // ids of no / another encounter → not_found; strict input
    expect((await rejected(dm, MOVE, body("nope", null))).code).toBe("not_found");
    expect(
      (await rejected(dm, MOVE, { ...body(id("Thorn"), null), encounterId: "nope" })).code,
    ).toBe("not_found");
    expect((await rejected(dm, MOVE, { ...body(id("Thorn"), null), x: 1 })).code).toBe("invalid");
    const crypt = db
      .select()
      .from(encounter)
      .where(
        and(eq(encounter.status, "ended"), eq(encounter.campaignId, encounterOf(dm).campaignId)),
      )
      .get();
    expect(crypt).toBeDefined();
    expect(
      (await rejected(dm, MOVE, { ...body(id("Thorn"), null), encounterId: crypt?.id })).code,
    ).toBe("not_found");
    // same spot → ack, no write, no event
    const before = moves();
    const seen = dm.frames.length;
    await move("Fire Elemental 3", "Thorn");
    await settle();
    expect(eventFrames(dm.frames.slice(seen))).toEqual([]);
    expect(moves()).toBe(before);
  });

  test("FR-CBTX-65 numbers after a drop", async () => {
    // (a) private row: Goblin 12 dropped after Wolf → 18, `initRollId` null
    expect(named(dm, "Goblin").initRollId).not.toBeNull();
    await move("Goblin", "Wolf");
    expect(named(dm, "Goblin")).toMatchObject({ initiative: 18, initRollId: null });
    expect(order(dm).slice(0, 3)).toEqual(["Wolf", "Goblin", "Brakka"]);
    // (a) hidden Elite to the top → the first row's number
    await move("Elite Goblin Warrior", null);
    expect(named(dm, "Elite Goblin Warrior").initiative).toBe(18);
    expect(order(dm)[0]).toBe("Elite Goblin Warrior");
    // (b) Thorn within the 12-tie → unchanged
    await move("Thorn", "Fire Elemental 3");
    expect(named(dm, "Thorn").initiative).toBe(12);
    // (b) Brakka 17 below Thorn 12 → 12; her lines move with her
    await move("Brakka", "Thorn");
    expect(named(dm, "Brakka").initiative).toBe(12);
    expect(order(dm).slice(-3)).toEqual(["Fire Elemental 3", "Thorn", "Brakka"]);
    await settle();
    expect(named(p1, "Brakka").initiative).toBe(12);
    // (b) Thorn 12 to the top: nearest visible PC below is Mira 15 → 15; the 18s rewritten after him
    await move("Thorn", null);
    expect(named(dm, "Thorn").initiative).toBe(15);
    expect(order(dm).slice(0, 5)).toEqual([
      "Thorn",
      "Elite Goblin Warrior",
      "Wolf",
      "Goblin",
      "Mira",
    ]);
    for (const n of ["Elite Goblin Warrior", "Wolf", "Goblin"]) {
      expect(named(dm, n)).toMatchObject({ initiative: 15, initRollId: null });
    }
    await settle();
    expect(playerOrder(p2).slice(0, 2)).toEqual(["Thorn", "Mira"]);
    leaks();
  });

  test("FR-CBTX-65 numbers never leak (PC dropped under the hidden Elite; 500 seeded drops)", async () => {
    await move("Elite Goblin Warrior", null);
    expect(named(dm, "Elite Goblin Warrior").initiative).toBe(18);
    await settle();
    const from = { p1: p1.frames.length, p2: p2.frames.length };
    await move("Thorn", "Elite Goblin Warrior");
    await settle();
    // Thorn takes the nearest visible PC's number below (Brakka 17), never 18
    expect(named(dm, "Thorn").initiative).toBe(17);
    expect(named(dm, "Wolf").initiative).toBe(17);
    expect(order(dm).slice(0, 4)).toEqual(["Elite Goblin Warrior", "Thorn", "Wolf", "Brakka"]);
    for (const [c, i] of [
      [p1, from.p1],
      [p2, from.p2],
    ] as const) {
      const text = JSON.stringify(c.frames.slice(i));
      expect(text).not.toContain('"initiative":18');
      expect(named(c, "Thorn").initiative).toBe(17);
    }
    leaks();

    // 500 seeded drops: every PC number in a player frame is its old number or another PC's.
    let seed = 0x5eed;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const movable = () =>
      rows(dm).filter(
        (r) =>
          !r.removed &&
          !(
            (r.turnMode === "after-owner" || r.turnMode === "in-owner-turn") &&
            rows(dm).some((o) => o.kind === "pc" && o.entityId === r.ownerCharacterId)
          ),
      );
    let applied = 0;
    for (let i = 0; i < 500; i++) {
      const list = movable();
      const c = list[rand(list.length)] as CombatantRecord;
      const anchors = list.filter((r) => r.id !== c.id && r.initiative !== null);
      const pick = rand(anchors.length + 1);
      const afterId = pick === anchors.length ? null : (anchors[pick] as CombatantRecord).id;
      const publicNumbers = new Set(
        rows(dm)
          .filter((r) => r.kind === "pc")
          .map((r) => r.initiative),
      );
      const marks = [p1.frames.length, p2.frames.length];
      const f = await send(dm, MOVE, { encounterId: encId, combatantId: c.id, afterId });
      if (f.type === "ack") applied += 1;
      for (const [k, pc] of [p1, p2].entries()) {
        await barrier(pc);
        for (const ev of eventFrames(pc.frames.slice(marks[k]))) {
          for (const ch of ev.changes) {
            if (ch.type !== COMBATANT_TYPE || ch.op !== "upsert") continue;
            const r = ch.data as Partial<CombatantRecord>;
            expect(r).not.toHaveProperty("tieOrder");
            if (r.kind !== "pc") {
              expect(r).not.toHaveProperty("initiative");
              continue;
            }
            expect(publicNumbers.has(r.initiative ?? null)).toBe(true);
          }
        }
      }
    }
    expect(applied).toBeGreaterThan(250);
    leaks();
  }, 120_000);

  test("FR-CBTX-65 hidden PC dropped under a monster keeps a PC number", async () => {
    await ok(dm, "map.setTokenHidden", { tokenId: named(dm, "Thorn").tokenId, hidden: true });
    expect(named(dm, "Thorn").hidden).toBe(true);
    // Under the hidden Wolf 18: the nearest PC below is Brakka 17, never the Wolf's 18.
    await move("Thorn", "Wolf");
    expect(named(dm, "Thorn").initiative).toBe(17);
    expect(named(dm, "Wolf").initiative).toBe(18);
    await ok(dm, "map.setTokenHidden", { tokenId: named(dm, "Thorn").tokenId, hidden: false });
    await settle();
    for (const c of [p1, p2]) expect(named(c, "Thorn").initiative).toBe(17);
    leaks();
  });

  test("FR-CBTX-66 ties kept per fight", async () => {
    // Default order of the 12-tie: Thorn, Fire Elemental 3, Goblin (init bonus). Thorn dropped
    // between FE 3 and Goblin → FE 3, Thorn, Goblin with tieOrder 1, 2, 3.
    const before = moves();
    await move("Thorn", "Fire Elemental 3");
    expect(moves()).toBe(before + 1);
    const tie = () =>
      ["Fire Elemental 3", "Thorn", "Goblin"].map((n) => [
        named(dm, n).tieOrder,
        named(dm, n).position,
      ]);
    const pos = named(dm, "Mira").position as number;
    expect(tie()).toEqual([
      [1, pos + 4],
      [2, pos + 5],
      [3, pos + 6],
    ]);
    // a removed row in the tie keeps its value; the others are rewritten
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: named(dm, "Goblin").id, removed: true });
    await move("Thorn", "Mira");
    expect(named(dm, "Thorn").tieOrder).toBe(1);
    expect(named(dm, "Fire Elemental 3").tieOrder).toBe(2);
    expect(named(dm, "Goblin").tieOrder).toBe(3);
    // Mira's after-owner companions (Goblin 2 has 12) never get a tie slot
    expect(named(dm, "Goblin 2").tieOrder).toBeNull();
    await settle();
    expect(playerOrder(p2).slice(-2)).toEqual(["Thorn", "Fire Elemental 3"]);
    leaks();
  });

  test("FR-CBT-163 order survives", async () => {
    // Inside the 12-tie (Thorn, FE 3, Goblin): Goblin dropped after Thorn → 1, 2, 3.
    await move("Goblin", "Thorn");
    const tie = ["Thorn", "Goblin", "Fire Elemental 3"];
    const tieOrders = () => tie.map((n) => named(dm, n).tieOrder);
    expect(tieOrders()).toEqual([1, 2, 3]);
    // (d) remove / restore and hide / reveal keep it
    const goblin = named(dm, "Goblin");
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: goblin.id, removed: true });
    await ok(dm, CBT_INTENTS.setRemoved, { combatantId: goblin.id, removed: false });
    const fe3Token = named(dm, "Fire Elemental 3").tokenId;
    await ok(dm, "map.setTokenHidden", { tokenId: fe3Token, hidden: true });
    expect(named(dm, "Fire Elemental 3").hidden).toBe(true);
    await ok(dm, "map.setTokenHidden", { tokenId: fe3Token, hidden: false });
    expect(tieOrders()).toEqual([1, 2, 3]);
    // (a) Next × 10 across a round: no re-sort (Brakka's in-turn lines rank only on their turn)
    const ranked = () =>
      JSON.stringify(
        rows(dm)
          .filter((r) => r.turnMode !== "in-owner-turn")
          .map((r) => [r.name, r.position, r.tieOrder]),
      );
    const snap = ranked();
    const round = encounterOf(dm).round;
    for (let i = 0; i < 10; i++) {
      const e = encounterOf(dm);
      await ok(dm, CBT_INTENTS.nextTurn, {
        encounterId: encId,
        expectedRound: e.round,
        expectedTurnId: e.turnCombatantId,
      });
    }
    expect(encounterOf(dm).round).toBeGreaterThan(round);
    expect(ranked()).toBe(snap);
    // (b) a combatant joining on the tie goes after the arranged rows
    const before = new Set(rows(dm).map((r) => r.id));
    await ok(dm, CBTX_INTENTS.addCombatants, {
      encounterId: encId,
      items: [{ definitionId: goblin.entityId }],
    });
    const added = rows(dm).find((r) => !before.has(r.id)) as CombatantRecord;
    await ok(dm, CBT_INTENTS.setInitiative, { combatantId: added.id, value: 12 });
    expect(added.tieOrder ?? null).toBeNull();
    const in12 = () => order(dm).filter((n) => named(dm, n).initiative === 12 && n !== "Goblin 2");
    expect(in12()).toEqual([...tie, added.name]);
    // (c) `setInitiative` on Thorn (same value) clears only Thorn's: he goes after the arranged rows
    await ok(dm, CBT_INTENTS.setInitiative, { combatantId: named(dm, "Thorn").id, value: 12 });
    expect(tieOrders()).toEqual([null, 2, 3]);
    expect(in12().slice(0, 2)).toEqual(["Goblin", "Fire Elemental 3"]);
    // (c) an own companion set to after-owner and back: no tie slot
    const thornChar = named(dm, "Thorn").entityId;
    const fe3 = named(dm, "Fire Elemental 3").id;
    await ok(dm, CBT_INTENTS.setCompanion, {
      combatantId: fe3,
      owner: { characterId: thornChar, turnMode: "after-owner" },
    });
    expect(named(dm, "Fire Elemental 3").tieOrder).toBeNull();
    await ok(dm, CBT_INTENTS.setCompanion, {
      combatantId: fe3,
      owner: { characterId: thornChar, turnMode: "own" },
    });
    expect(named(dm, "Fire Elemental 3").tieOrder).toBeNull();
    expect(named(dm, "Goblin").tieOrder).toBe(2);
    // (c) release / Turn hostile of an `own` companion holding a tie slot clears it
    await move("Fire Elemental 3", "Goblin");
    expect(named(dm, "Fire Elemental 3").tieOrder).not.toBeNull();
    await ok(dm, CBT_INTENTS.setCompanion, { combatantId: fe3, owner: null, side: "enemy" });
    expect(named(dm, "Fire Elemental 3").tieOrder).toBeNull();
    expect(named(dm, "Goblin").tieOrder).not.toBeNull();
    await settle();
    leaks();
  });

  test("FR-CBT-164 turn stays on the moved combatant", async () => {
    // Next → Brakka's turn (a visible PC: players hold the turn copy too).
    let e = encounterOf(dm);
    await ok(dm, CBT_INTENTS.nextTurn, {
      encounterId: encId,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
    e = encounterOf(dm);
    const brakka = named(dm, "Brakka").id;
    expect(e.turnCombatantId).toBe(brakka);
    expect(e.playerTurnCombatantId).toBe(brakka);
    await settle();
    const marks = [dm.frames.length, p1.frames.length, p2.frames.length];
    await move("Brakka", "Thorn"); // the turn row moves down
    await move("Wolf", "Fire Elemental 3"); // a row from above the turn to below it
    await move("Goblin", null); // a row from below to the top
    await settle();
    const after = encounterOf(dm);
    expect(after).toMatchObject({
      round: e.round,
      turnCombatantId: brakka,
      playerTurnCombatantId: brakka,
    });
    for (const [k, c] of [dm, p1, p2].entries()) {
      const names = eventFrames(c.frames.slice(marks[k])).map((f) => f.cause.name);
      expect(names.every((n) => n === CombatantMoved.type)).toBe(true);
      expect(encounterOf(c).playerTurnCombatantId).toBe(brakka);
    }
    // Next steps from Brakka's new spot: Goblin, Mira, Thorn, Brakka, FE 3, Wolf, Elite → FE 3.
    await ok(dm, CBT_INTENTS.nextTurn, {
      encounterId: encId,
      expectedRound: after.round,
      expectedTurnId: brakka,
    });
    expect(encounterOf(dm).turnCombatantId).toBe(named(dm, "Fire Elemental 3").id);
  });

  test("FR-CBTX-67 hidden move sends players nothing", async () => {
    await settle();
    const marks = { p1: p1.frames.length, p2: p2.frames.length };
    await move("Elite Goblin Warrior", null);
    await move("Goblin", "Wolf"); // fog-hidden
    expect(named(dm, "Elite Goblin Warrior").position).toBe(1);
    // Both moves are acked, so anything sent for them precedes each player's pong.
    for (const c of [p1, p2]) await barrier(c);
    expect(p1.frames.slice(marks.p1).map((f) => f.type)).toEqual(["pong"]);
    expect(p2.frames.slice(marks.p2).map((f) => f.type)).toEqual(["pong"]);
    leaks();
  });

  test("FR-CBT-168 reconnect and restart keep the order (snapshots equal)", async () => {
    await move("Elite Goblin Warrior", null);
    await move("Thorn", "Elite Goblin Warrior");
    await move("Goblin", "Thorn");
    await settle();
    const view = (c: TestClient) =>
      JSON.stringify([...rows(c)].sort((x, y) => x.id.localeCompare(y.id))) +
      JSON.stringify(encounterOf(c));
    const views = [dm, p1, p2].map(view);
    const creds = [
      DM,
      { role: "player" as const, token: links["Player 1"] as string },
      { role: "player" as const, token: links["Player 2"] as string },
    ] as const;
    // reconnect, then a server restart: the same records and order for everyone
    for (const restart of [false, true]) {
      for (const c of [dm, p1, p2]) c.close();
      if (restart) await h.restart();
      [dm, p1, p2] = await Promise.all([h.live(creds[0]), h.live(creds[1]), h.live(creds[2])]);
      expect([dm, p1, p2].map(view)).toEqual(views);
    }
    expect(order(dm).slice(0, 4)).toEqual(["Elite Goblin Warrior", "Thorn", "Goblin", "Wolf"]);
    leaks();
  });

  test("FR-CBTX-68 player cannot move", async () => {
    const thorn = named(p2, "Thorn").id;
    expect(
      (await rejected(p2, MOVE, { encounterId: encId, combatantId: thorn, afterId: null })).code,
    ).toBe("forbidden");
  });
});
