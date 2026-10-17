// FOG §13 sprint-4 party leak tests (V6, FR-FOG-49–52) over real sockets on the `vision-party`
// bundle (`player-1` = Mira, vision 30 ft; `player-2` = Thorn, darkvision 60 ft, Devil's Sight,
// Sees invisible; Goblin 2 Invisible), Goblin Ambush active. Each state: snapshot + every frame,
// a fresh connection (convergence) and a `resync` (`expectSee`): switch off, on, on → off, on
// again with Thorn in the darkness, off again. Then the switch's guards (player → `forbidden`,
// same value → no event).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  explores,
  type VisionHarness,
  visionHarness,
} from "@fixtures/units/fog-of-war/vision-harness";
import {
  FOG_INTENTS as F,
  FOG_EXPLORED_TYPE,
  FOG_SETTINGS_TYPE,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";

const PARTY = ["Mira", "Thorn"];
const THORN_SEES = ["Goblin", "Goblin 2", "Goblin Lurker", "Cave Ogre"];

describe("FOG §13 V6 party vision leak walkthrough (player-1, player-2)", () => {
  let t: VisionHarness;
  beforeAll(async () => {
    t = await visionHarness("vision-party");
  });
  afterAll(async () => {
    await t.stop();
  });
  const party = (on: boolean) => t.send(t.dm, F.setPartyVision, { on });
  const visionIds = (w: "p1" | "p2") => Object.keys(t.c[w].store.records[VISION_TYPE] ?? {}).sort();
  const pair = (w: "p1" | "p2") => `${t.ambushId}:${t.pid[w]}`;
  const campaignOf = () => t.c.p1.store.you?.campaignId as string;
  const settings = (w: "p1" | "p2") =>
    t.c[w].store.records[FOG_SETTINGS_TYPE]?.[campaignOf()] as
      | { id: string; partyVision: boolean }
      | undefined;

  test("FR-FOG-49 off (default): d1 open, Mira → (7, 5) → P1 Goblin, P2 nothing; each holds only their own `vision`", async () => {
    expect(settings("p1")).toEqual({ id: campaignOf(), partyVision: false });
    await t.setDoor(0);
    const m = t.mark();
    await t.move(t.c.p1, "Mira", 7, 5);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
    expect(visionIds("p1")).toEqual([pair("p1")]);
    expect(visionIds("p2")).toEqual([pair("p2")]);
  });

  test("FR-FOG-49 / -50 / -51 on: one PartyVisionSet; P2 gets Goblin + P1's `vision`; P1 gets P2's `vision` without `inv`; P2's memory grows from the party's sight", async () => {
    const m = t.mark();
    expect((await party(true)).type).toBe("ack");
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: [...PARTY, "Goblin"] }, m, { party: true });
    for (const w of ["p1", "p2"] as const) {
      const ev = t.events(t.c[w], m[w], "PartyVisionSet");
      expect(ev).toHaveLength(1);
      expect(settings(w)?.partyVision).toBe(true);
      expect(visionIds(w)).toEqual([pair("p1"), pair("p2")].sort());
    }
    // P1's copy of Thorn's `vision`: polygons and `src`, never `inv` (Thorn sees invisible).
    const thornForP1 = t.c.p1.store.records[VISION_TYPE]?.[pair("p2")] as VisionRecord;
    expect(thornForP1.dark).toHaveLength(1);
    expect(thornForP1.src).toEqual([t.id("Thorn")]);
    expect("inv" in thornForP1).toBe(false);
    const own = t.c.p2.store.records[VISION_TYPE]?.[pair("p2")] as VisionRecord | undefined;
    expect(own?.inv).toEqual([0]);
    expect(t.c.p1.raw()).not.toContain('"inv"');
    // FR-FOG-37 (OQ-FOG-47): P2's memory now holds the cell Mira sees through d1.
    expect(explores(t.exploredOf(t.c.p2, "p2"), 11, 6)).toBe(true);
    // Memory rows stay own-only.
    expect(Object.keys(t.c.p1.store.records[FOG_EXPLORED_TYPE] ?? {})).toEqual([pair("p1")]);
  });

  test("FR-FOG-51 on → off: P2 Goblin delete + P1's `vision` delete; P2's memory kept; resync carries neither", async () => {
    const m = t.mark();
    expect((await party(false)).type).toBe("ack");
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m, { party: true });
    const ev2 = t.events(t.c.p2, m.p2, "PartyVisionSet");
    expect(ev2).toHaveLength(1);
    const ops = ev2[0]?.changes.map((c) => `${c.type}:${c.op}:${c.id}`) ?? [];
    expect(ops).toContain(`${TOKEN_TYPE}:delete:${t.id("Goblin")}`);
    expect(ops).toContain(`${VISION_TYPE}:delete:${pair("p1")}`);
    expect(visionIds("p1")).toEqual([pair("p1")]);
    expect(visionIds("p2")).toEqual([pair("p2")]);
    expect(explores(t.exploredOf(t.c.p2, "p2"), 11, 6)).toBe(true);
  });

  test("FR-FOG-50 on, the DM moves Thorn into the darkness (11, 9): P1 gets Goblin 2 (invisible), Goblin, Lurker, Cave Ogre via the party; no P1 frame carries `invisible`, `inv`, `seesInvisible` or Thorn's senses", async () => {
    let m = t.mark();
    await t.move(t.c.p1, "Mira", 2, 7);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m, { party: true });
    m = t.mark();
    expect((await party(true)).type).toBe("ack");
    await t.expectSee({ p1: PARTY, p2: PARTY }, m, { party: true });
    m = t.mark();
    await t.move(t.dm, "Thorn", 11, 9);
    await t.expectSee({ p1: [...PARTY, ...THORN_SEES], p2: [...PARTY, ...THORN_SEES] }, m, {
      party: true,
    });
    const raw = t.c.p1.raw();
    for (const s of ['"invisible"', '"inv"', '"seesInvisible"', '"darkvisionFt":60']) {
      expect(raw).not.toContain(s);
    }
  });

  test("FR-FOG-51 off again: P1 deletes all four (Mira sees none of them); P2 keeps them", async () => {
    const m = t.mark();
    expect((await party(false)).type).toBe("ack");
    await t.expectSee({ p1: PARTY, p2: [...PARTY, ...THORN_SEES] }, m, { party: true });
    const ops = t
      .events(t.c.p1, m.p1, "PartyVisionSet")
      .flatMap((e) => e.changes)
      .filter((c) => c.type === TOKEN_TYPE && c.op === "delete")
      .map((c) => c.id)
      .sort();
    expect(ops).toEqual(THORN_SEES.map((n) => t.id(n)).sort());
  });

  test("FR-FOG-49 the switch from a player → forbidden; same value → no event", async () => {
    const r = await t.send(t.c.p1, F.setPartyVision, { on: true });
    expect(r).toMatchObject({ type: "reject", code: "forbidden" });
    const m = t.mark();
    expect((await party(false)).type).toBe("ack");
    await Bun.sleep(50);
    expect(t.events(t.c.p1, m.p1)).toEqual([]);
    expect(t.events(t.c.p2, m.p2)).toEqual([]);
  });
});
