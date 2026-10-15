// FOG §13 integration with SCN on the `fog-scn` bundle (Goblin Ambush active): the barrel at
// (16, 2) and the DM kept template "Trap" are absent from player frames (snapshot, events, a
// fresh connection) until their cells are revealed; a reveal of (15, 1)–(19, 13) upserts them in
// the one FogEdited; Undo deletes them again. A DM ephemeral `scn.template` wholly in fog → DM
// only, partly revealed → all; a player's template in fog (signal or kept) → every viewer. The door
// on (15, 13)–(16, 13) (f = 1) is dropped from the players' `scene-structure` until revealed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { FOG_INTENTS as F, FOG_TYPE, type FogRecord } from "@shared/fog-of-war/schemas";
import {
  AOE_TEMPLATE_TYPE,
  type PlayerSceneStructureRecord,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  SCN_INTENTS,
  SCN_SIGNALS,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { aoeTemplate, player, prop, scene, sceneStructure } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 1500) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}

describe("FOG §13 fog-scn: SCN subjects under fog (player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ambushId: string;
  let barrelId: string;
  let trapId: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });
  const ids = (c: TestClient, type: string) => Object.keys(c.store.records[type] ?? {}).sort();
  /** Door segments in a client's `scene-structure` of Goblin Ambush. */
  const doors = (c: TestClient) =>
    (
      (c.store.records[SCENE_STRUCTURE_TYPE]?.[ambushId] as PlayerSceneStructureRecord | undefined)
        ?.doors ?? []
    ).map((d) => d.slice(1, 5).join(","));
  const FOG_DOOR = "15,13,16,13";
  const templateKeys = (c: TestClient, from: number) =>
    c.frames
      .slice(from)
      .flatMap((f) =>
        f.type === "signal" && f.name === SCN_SIGNALS.template
          ? [(f.data as { key: string }).key]
          : [],
      );
  const sphere = (x: number, y: number, key: string, extra = {}) => ({
    sceneId: ambushId,
    shape: "sphere",
    x,
    y,
    size: 10,
    angle: 0,
    key,
    ...extra,
  });

  /** Both players' stores, a fresh connection and the leak scan agree on what is visible. */
  async function expectHidden(hidden: boolean) {
    for (const [c, name] of [
      [p1, "Player 1"],
      [p2, "Player 2"],
    ] as const) {
      await until(() => ids(c, SCENE_PROP_TYPE).includes(barrelId) === !hidden);
      await until(() => ids(c, AOE_TEMPLATE_TYPE).includes(trapId) === !hidden);
      await until(() => doors(c).includes(FOG_DOOR) === !hidden);
      expect(doors(c)).toEqual(expect.arrayContaining(["8,5,8,6", "8,11,8,12"]));
      expect(leakScan(h.s, c)).toEqual([]);
      const fresh = await h.live(p(name));
      const conv = convergence(h.s, c, fresh);
      for (const type of [SCENE_PROP_TYPE, AOE_TEMPLATE_TYPE, SCENE_STRUCTURE_TYPE, FOG_TYPE]) {
        expect(conv.live[type] ?? {}).toEqual(conv.fresh[type] ?? {});
      }
      if (hidden) {
        for (const leak of [barrelId, trapId, '"Trap"']) expect(fresh.raw()).not.toContain(leak);
      }
      fresh.close();
    }
  }

  beforeAll(async () => {
    const loaded = await loadBundle("fog-scn", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((r) => [r.name, r.linkToken]),
    );
    ambushId = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush")?.id as string;
    barrelId = db
      .select()
      .from(prop)
      .all()
      .find((r) => r.col === 16 && r.row === 2)?.id as string;
    trapId = db
      .select()
      .from(aoeTemplate)
      .all()
      .find((r) => r.label === "Trap")?.id as string;
    h = await startTestServer({ db, fake: false, testMode: true });
    dm = await h.live(DM);
    expect((await answer(dm, dm.intent(I.activateScene, { sceneId: ambushId }))).type).toBe("ack");
    p1 = await h.live(p("Player 1"));
    p2 = await h.live(p("Player 2"));
  }, 30_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FOG §13 fixture fog-scn: barrel and Trap fogged; the SCN units' subjects as before", () => {
    const props = db.select().from(prop).all();
    expect(props.find((r) => r.id === barrelId)).toMatchObject({ hidden: false, fogged: true });
    expect(props.find((r) => r.col === 5 && r.row === 3)?.fogged).toBe(false); // scn-props barrel
    const tpl = db.select().from(aoeTemplate).all();
    expect(tpl.find((r) => r.id === trapId)).toMatchObject({
      hidden: false,
      fogged: true,
      placedByPlayerId: null,
    });
    expect(tpl.find((r) => r.label === "Spirit Guardians")?.fogged).toBe(false);
    // FR-SCN-36: the fog door f = 1; scn-walls' doors (one clear adjoining cell each) f = 0.
    const st = db.select().from(sceneStructure).all()[0];
    expect(st?.doors.map((d) => [d.slice(1, 5).join(","), d[6]])).toEqual([
      ["8,5,8,6", 0],
      ["8,11,8,12", 0],
      [FOG_DOOR, 1],
    ]);
  });

  test("FR-FOG-12 snapshot: barrel and Trap absent for players (DM holds them); fresh connections agree", async () => {
    await expectHidden(true);
    for (const c of [p1, p2]) {
      expect(c.raw()).not.toContain(barrelId);
      expect(c.raw()).not.toContain('"Trap"');
    }
    for (const c of [p1, p2]) expect(c.raw()).not.toContain("15,13,16,13");
    const fresh = await h.live(DM);
    expect(doors(fresh)).toContain(FOG_DOOR);
    expect(ids(fresh, SCENE_PROP_TYPE)).toContain(barrelId);
    expect(fresh.store.records[AOE_TEMPLATE_TYPE]?.[trapId]).toMatchObject({ fogged: true });
    fresh.close();
  });

  test("FR-FOG-15 scn.template: DM wholly in fog → DM only; partly revealed → all; a player's in fog → all", async () => {
    const marks = [p1.frames.length, p2.frames.length];
    const dm2 = await h.live(DM);
    const send = (c: TestClient, data: object) =>
      c.send({ type: "signal", name: SCN_SIGNALS.template, data });
    send(dm, sphere(18, 5, "dm-fog", { label: "Ambush glyph" }));
    send(dm, sphere(7, 5, "dm-partly")); // cells (5..8, 3..6): (5..7, *) revealed
    send(p1, sphere(18, 5, "p1-fog"));
    await until(() => templateKeys(p2, marks[1] as number).length === 2);
    await until(() => templateKeys(dm2, 0).length === 3);
    expect(templateKeys(p2, marks[1] as number).sort()).toEqual(["dm-partly", "p1-fog"]);
    expect(templateKeys(p1, marks[0] as number)).toEqual(["dm-partly"]);
    expect(p2.raw()).not.toContain("Ambush glyph");
    // A player's kept template in fog: visible to the other player too (exempt, FR-FOG-11).
    const ack = await answer(
      p1,
      p1.intent(SCN_INTENTS.placeTemplate, {
        sceneId: ambushId,
        shape: "sphere",
        x: 18,
        y: 9,
        size: 10,
        angle: 0,
        label: "Mira's fog",
      }),
    );
    expect(ack.type).toBe("ack");
    const kept = (ack as { result: { templateId: string } }).result.templateId;
    await until(() => ids(p2, AOE_TEMPLATE_TYPE).includes(kept));
    expect(
      db
        .select()
        .from(aoeTemplate)
        .all()
        .find((r) => r.id === kept)?.fogged,
    ).toBe(true);
    // The DM wire keeps the copy; neither player (placer or other) gets it.
    await until(() => ids(dm2, AOE_TEMPLATE_TYPE).includes(kept));
    expect(dm2.store.records[AOE_TEMPLATE_TYPE]?.[kept]).toMatchObject({ fogged: true });
    for (const c of [p1, p2]) {
      expect(c.store.records[AOE_TEMPLATE_TYPE]?.[kept]).toMatchObject({ label: "Mira's fog" });
      expect(c.store.records[AOE_TEMPLATE_TYPE]?.[kept]).not.toHaveProperty("fogged");
    }
    dm2.close();
  });

  test("FR-FOG-08 / -12 reveal (15, 1)–(19, 13) → barrel + Trap upsert in the one FogEdited; Undo → delete", async () => {
    const marks = [p1.frames.length, p2.frames.length];
    const ack = await answer(
      dm,
      dm.intent(F.edit, {
        sceneId: ambushId,
        op: "reveal",
        shape: { kind: "rect", c0: 15, r0: 1, c1: 19, r1: 13 },
      }),
    );
    expect(ack.type).toBe("ack");
    await expectHidden(false);
    for (const [i, c] of [p1, p2].entries()) {
      const ev = c.frames
        .slice(marks[i])
        .find((f) => f.type === "event" && f.cause.name === "FogEdited");
      const changes = ev?.type === "event" ? ev.changes : [];
      expect(changes.map((ch) => [ch.type, ch.id, ch.op])).toEqual(
        expect.arrayContaining([
          [SCENE_PROP_TYPE, barrelId, "upsert"],
          [AOE_TEMPLATE_TYPE, trapId, "upsert"],
          [SCENE_STRUCTURE_TYPE, ambushId, "upsert"],
        ]),
      );
      // Revealed: the wire carries no `fogged` copy on them.
      expect(c.store.records[SCENE_PROP_TYPE]?.[barrelId]).not.toHaveProperty("fogged");
      expect(c.store.records[AOE_TEMPLATE_TYPE]?.[trapId]).toMatchObject({ label: "Trap" });
    }
    const fog = dm.store.records[FOG_TYPE]?.[ambushId] as FogRecord;
    const undo = await answer(
      dm,
      dm.intent(F.undo, { sceneId: ambushId, expectedEditId: fog.undo?.editId }),
    );
    expect(undo.type).toBe("ack");
    await expectHidden(true);
  });

  test("FOG §13 property: no player prop / template row carries `fogged`, not even a player-placed template in fog", () => {
    for (const c of [p1, p2]) {
      for (const f of c.frames) {
        const rows: Record<string, unknown>[] = [];
        if (f.type === "snapshot") {
          for (const t of [SCENE_PROP_TYPE, AOE_TEMPLATE_TYPE]) {
            rows.push(...((f.records[t] ?? []) as Record<string, unknown>[]));
          }
        }
        if (f.type === "event") {
          for (const ch of f.changes) {
            const data = (ch as { data?: Record<string, unknown> }).data;
            if ((ch.type === SCENE_PROP_TYPE || ch.type === AOE_TEMPLATE_TYPE) && data) {
              rows.push(data);
            }
          }
        }
        // Fog-hidden (DM-placed) rows never arrive; exempt player-placed ones arrive without
        // their `fogged` copy (scene-tools' redactTemplate).
        for (const r of rows) expect(r).not.toHaveProperty("fogged");
      }
    }
  });
});
