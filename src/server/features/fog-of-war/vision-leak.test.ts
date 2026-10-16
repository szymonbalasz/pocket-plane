// FOG §13 V2 per-player leak tests over real sockets on the `vision` bundle (`player-1` = Mira,
// vision 30 ft; `player-2` = Thorn, darkvision 60 ft + Devil's Sight), Goblin Ambush active: sight
// through the open door, explored memory, darkness and the blind rule, walls and doors cutting
// sight, Fog all / Reveal all, the darkness filter by sight, `map.drag` and template routing,
// can't-see → `not_found`. Each state: snapshot + every frame + a fresh connection + a `resync`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  explores,
  type VisionHarness,
  visionHarness,
} from "@fixtures/units/fog-of-war/vision-harness";
import {
  FOG_INTENTS as F,
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  VISION_TYPE,
} from "@shared/fog-of-war/schemas";
import { SCN_INTENTS, SCN_SIGNALS } from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, TOKEN_TYPE } from "@shared/scenes-map/schemas";

const THORN = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };
const PARTY = ["Mira", "Thorn"];

describe("FOG §13 V2 leak walkthrough: dynamic vision (player-1, player-2)", () => {
  let t: VisionHarness;
  beforeAll(async () => {
    t = await visionHarness();
  });
  afterAll(async () => {
    await t.stop();
  });

  test("FR-FOG-32 / -33 / -39 start: each player gets their own `vision` (Mira `see` cut at x = 8, Thorn `dark`), nobody's monsters", async () => {
    await t.expectSee({ p1: PARTY, p2: PARTY });
    const v1 = t.visionOf(t.c.p1, "p1");
    const v2 = t.visionOf(t.c.p2, "p2");
    expect(v1).toMatchObject({ blind: false, dark: [] });
    expect(v1?.see).toHaveLength(1);
    const xs = (flat: number[]) => flat.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs(v1?.see[0] ?? []))).toBeLessThanOrEqual(8);
    expect(v2).toMatchObject({ blind: false, see: [] });
    expect(v2?.dark).toHaveLength(1);
    // Every vertex of Thorn's polygon with 0 ≤ y ≤ 14 has x ≤ 8 (the wall at x = 8, doors closed).
    const d = v2?.dark[0] ?? [];
    for (let i = 0; i < d.length; i += 2) {
      if ((d[i + 1] as number) >= 0 && (d[i + 1] as number) <= 14) {
        expect(d[i] as number).toBeLessThanOrEqual(8);
      }
    }
    // Only their own rows: no other player's `vision` / `fog-explored`.
    expect(Object.keys(t.c.p1.store.records[VISION_TYPE] ?? {})).toEqual([
      `${t.ambushId}:${t.pid.p1}`,
    ]);
    expect(Object.keys(t.c.p2.store.records[VISION_TYPE] ?? {})).toEqual([
      `${t.ambushId}:${t.pid.p2}`,
    ]);
    // DM snapshot: no `view-as` rows (FR-FOG-43).
    expect(t.dm.store.records[VISION_TYPE] ?? {}).toEqual({});
    // Senses of the other player's character never reach a player.
    expect(t.c.p1.raw()).not.toContain('"darkvisionFt":60');
    expect(t.c.p2.raw()).not.toContain('"visionFt":30');
  });

  test("FR-FOG-34 / -37 d1 open, Mira → (7, 5): P1 gets Goblin and cell (11, 6) explored; P2 nothing", async () => {
    await t.setDoor(0);
    const m = t.mark();
    await t.move(t.c.p1, "Mira", 7, 5);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
    expect(explores(t.exploredOf(t.c.p1, "p1"), 11, 6)).toBe(true);
    // P2's memory (from the activation) didn't move with Mira.
    expect(t.events(t.c.p2, m.p2).flatMap((e) => e.changes.map((c) => c.type))).not.toContain(
      FOG_EXPLORED_TYPE,
    );
    // Goblin 2 is in darkness (Mira has no see-through): not seen.
    expect(t.c.p1.raw()).not.toContain(t.id("Goblin 2"));
    // One TokenMoved per player; P2's carries Mira only (party), no Goblin.
    const ev2 = t.events(t.c.p2, m.p2, "TokenMoved");
    expect(ev2).toHaveLength(1);
    expect(ev2[0]?.changes.map((c) => [c.type, c.id])).toEqual([[TOKEN_TYPE, t.id("Mira")]]);
    const ev1 = t.events(t.c.p1, m.p1, "TokenMoved");
    expect(ev1).toHaveLength(1);
    // Mira + Goblin, P1's vision and memory; the darkness now meets P1's sight (FR-FOG-44: `fog`
    // upsert) and d2's samples are in it (`doorSeen`, the structure row).
    expect([...new Set(ev1[0]?.changes.map((c) => c.type))].sort()).toEqual(
      [FOG_EXPLORED_TYPE, FOG_TYPE, "scene-structure", TOKEN_TYPE, VISION_TYPE].sort(),
    );
  });

  test("FR-FOG-37 Mira back to (2, 7): P1 Goblin delete, (11, 6) stays in memory", async () => {
    const m = t.mark();
    await t.move(t.c.p1, "Mira", 2, 7);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m);
    expect(explores(t.exploredOf(t.c.p1, "p1"), 11, 6)).toBe(true);
    const del = t
      .events(t.c.p1, m.p1, "TokenMoved")
      .flatMap((e) => e.changes)
      .find((c) => c.id === t.id("Goblin"));
    expect(del?.op).toBe("delete");
  });

  test("FR-FOG-33 / -36 Thorn (11, 9) in darkness with see-through → P2 gets Goblin 2, Goblin, Lurker; without → blind (all but Thorn deleted)", async () => {
    let m = t.mark();
    await t.move(t.dm, "Thorn", 11, 9);
    await t.expectSee(
      { p1: PARTY, p2: [...PARTY, "Goblin", "Goblin 2", "Goblin Lurker", "Cave Ogre"] },
      m,
    );
    expect(t.visionOf(t.c.p2, "p2")?.blind).toBe(false);
    m = t.mark();
    await t.senses("Thorn", { ...THORN, seesMagicalDarkness: false });
    await t.expectSee({ p1: PARTY, p2: ["Thorn"] }, m);
    expect(t.visionOf(t.c.p2, "p2")).toMatchObject({ blind: true, see: [], dark: [] });
    // P1 is unaffected: Thorn stays a party token for P1 (P2 is blind, P1 isn't).
    expect(t.events(t.c.p1, m.p1, "CharacterSheetEdited").flatMap((e) => e.changes)).toEqual([]);
    // Back: the view returns in one event.
    m = t.mark();
    await t.senses("Thorn", THORN);
    await t.expectSee(
      { p1: PARTY, p2: [...PARTY, "Goblin", "Goblin 2", "Goblin Lurker", "Cave Ogre"] },
      m,
    );
    expect(t.events(t.c.p2, m.p2, "CharacterSheetEdited")).toHaveLength(1);
    m = t.mark();
    await t.move(t.dm, "Thorn", 2, 9);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m);
  });

  test("FR-FOG-33 a wall [10, 5, 10, 8] cuts Mira (7, 5) → Goblin; removed, then d1 closed cuts it again", async () => {
    await t.move(t.c.p1, "Mira", 7, 5);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY });
    let m = t.mark();
    const added = await t.ok(t.dm, SCN_INTENTS.addWalls, {
      sceneId: t.ambushId,
      segments: [[10, 5, 10, 8]],
    });
    await t.expectSee({ p1: PARTY, p2: PARTY }, m);
    m = t.mark();
    await t.ok(t.dm, SCN_INTENTS.removeSegments, {
      sceneId: t.ambushId,
      ns: added.ns as number[],
    });
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
    m = t.mark();
    await t.setDoor(1);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m);
    await t.setDoor(0);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY });
  });

  test("FR-FOG-15 map.drag of Goblin: frames only to players who see the stored token and the previewed cell", async () => {
    const m = t.mark();
    t.drag(t.dm, "Goblin", [12, 6]); // stays in P1's sight
    t.drag(t.dm, "Goblin", [17, 1]); // out of every sight (Explored corridor: records hidden)
    t.drag(t.dm, "Goblin", "end");
    await until(() => t.drags(t.c.p1, m.p1).length === 2);
    expect(t.drags(t.c.p1, m.p1).map((d) => (d.end ? "end" : d.x))).toEqual([12 * 70, "end"]);
    await Bun.sleep(100);
    expect(t.drags(t.c.p2, m.p2)).toEqual([]);
    expect(JSON.stringify(t.c.p2.frames.slice(m.p2))).not.toContain(t.id("Goblin"));
  });

  test("FR-FOG-15 a DM ephemeral template reaches only players who see a cell of it", async () => {
    const m = t.mark();
    const send = (data: object) => t.dm.send({ type: "signal", name: SCN_SIGNALS.template, data });
    const sphere = (x: number, y: number, key: string) => ({
      sceneId: t.ambushId,
      shape: "sphere",
      x,
      y,
      size: 5,
      angle: 0,
      key,
    });
    send(sphere(12, 6, "in-p1-sight")); // around Goblin: Mira sees it through d1
    send(sphere(17, 12, "nobody")); // static fog, in nobody's sight
    const keys = (w: "p1" | "p2") =>
      t.c[w].frames
        .slice(m[w])
        .flatMap((f) =>
          f.type === "signal" && f.name === SCN_SIGNALS.template
            ? [(f.data as { key: string }).key]
            : [],
        );
    await until(() => keys("p1").length === 1);
    await Bun.sleep(100);
    expect(keys("p1")).toEqual(["in-p1-sight"]);
    expect(keys("p2")).toEqual([]);
  });

  test("FR-FOG-11 P1 naming Goblin while unseen → not_found (checkMove, moveToken, drag), no id echoed", async () => {
    await t.setDoor(1);
    await t.expectSee({ p1: PARTY, p2: PARTY });
    const gob = t.id("Goblin");
    for (const name of [I.checkMove, I.moveToken]) {
      const a = await t.send(t.c.p1, name, { tokenId: gob, col: 3, row: 3 });
      expect(a).toMatchObject({ type: "reject", code: "not_found" });
    }
    const before = t.c.p1.frames.length;
    t.drag(t.c.p1, "Goblin", [3, 3]);
    await until(() => t.c.p1.frames.slice(before).some((f) => f.type === "reject"));
    const err = t.c.p1.frames.slice(before).find((f) => f.type === "reject");
    expect(err).toMatchObject({ code: "not_found" });
    await t.setDoor(0);
  });

  test("FR-FOG-06 Fog all / Reveal all re-derive by sight; darkness and memory kept", async () => {
    await t.move(t.c.p1, "Mira", 7, 5);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY });
    await t.ok(t.dm, F.setAll, { sceneId: t.ambushId, fogged: false });
    // Everything statically clear: every unhidden token but those in darkness (Goblin 2).
    const open = [...PARTY, "Goblin", "Goblin Lurker", "Cave Ogre"];
    await t.expectSee({ p1: open, p2: open });
    await t.ok(t.dm, F.setAll, { sceneId: t.ambushId, fogged: true });
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY });
    expect(explores(t.exploredOf(t.c.p1, "p1"), 11, 6)).toBe(true);
  });
  test("FR-FOG-44 darkness filtered by sight: [17.5, 11.5, 1] → no fog upsert; [1.5, 8.5, 1] over the nook → both", async () => {
    // Memory from the earlier steps (Thorn saw the Lurker's corner) would count (FR-FOG-44).
    await t.ok(t.dm, F.forgetExplored, { sceneId: t.ambushId });
    await t.move(t.c.p1, "Mira", 2, 7);
    let m = t.mark();
    const far = (await t.ok(t.dm, F.placeDarkness, {
      sceneId: t.ambushId,
      shape: { circle: [17.5, 11.5, 1] },
    })) as { darknessId: string };
    for (const w of ["p1", "p2"] as const) {
      await until(() => t.events(t.c[w], m[w], "DarknessPlaced").length === 1);
      expect(t.events(t.c[w], m[w], "DarknessPlaced")[0]?.changes).toEqual([]);
      expect(t.c[w].raw()).not.toContain(far.darknessId);
    }
    m = t.mark();
    const nook = (await t.ok(t.dm, F.placeDarkness, {
      sceneId: t.ambushId,
      shape: { circle: [1.5, 8.5, 1] },
    })) as { darknessId: string };
    for (const w of ["p1", "p2"] as const) {
      await until(() => t.events(t.c[w], m[w], "DarknessPlaced").length === 1);
      const ch = t.events(t.c[w], m[w], "DarknessPlaced")[0]?.changes ?? [];
      expect(ch.filter((c) => c.type === FOG_TYPE).map((c) => c.op)).toEqual(["upsert"]);
      expect((t.fogOf(t.c[w])?.darkness ?? []).map((d) => d.id)).toContain(nook.darknessId);
    }
    await t.undo();
    await t.undo();
    await t.expectSee({ p1: PARTY, p2: PARTY });
  });

  test("FR-FOG-14 Goblin seen by P1 only → its combatant reaches both; seen by nobody → hidden for both", async () => {
    await t.ok(t.dm, "cbt.start", { encounterId: encounterId(), sceneId: t.ambushId });
    const goblinCombatant = () =>
      Object.values(t.c.p2.store.records.combatant ?? {}).some(
        (r) => (r as { name?: string }).name === "Goblin",
      );
    await t.move(t.c.p1, "Mira", 7, 5);
    // Lurker is not a combatant.
    await until(() => goblinCombatant());
    await t.setDoor(1);
    await until(() => !goblinCombatant());
    await t.setDoor(0);
    await until(() => goblinCombatant());
  });

  function encounterId(): string {
    const enc = Object.values(t.dm.store.records.encounter ?? {}) as { id: string; name: string }[];
    return enc.find((e) => e.name === "Ambush at the Ford")?.id as string;
  }
});

async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
