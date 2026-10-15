// SCN §13 props over real sockets on the `scene-tools-props` bundle: DM acks + frames; players get
// redacted props of the active scene only (no `locked`, no campaign; the chest's asset only once
// revealed; hide → delete); players refused; edits on a non-active scene reach no player; leak
// scan + convergence; reconnect and restart → identical snapshots (SCN §11).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type PlayerScenePropRecord,
  SCN_INTENTS as S,
  SCENE_PROP_TYPE,
  type ScenePropRecord,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, player, prop, scene } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const propsOf = (c: TestClient) =>
  (c.store.records[SCENE_PROP_TYPE] ?? {}) as Record<
    string,
    ScenePropRecord | PlayerScenePropRecord
  >;

describe("scene-tools props over WS (build/scene-tools-props)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ambushId: string;
  let townId: string;
  let img: Record<string, string>;
  let ids: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("scene-tools-props", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    const scenes = db.select().from(scene).all();
    ambushId = scenes.find((s) => s.name === "Goblin Ambush")?.id as string;
    townId = scenes.find((s) => s.name === "Town")?.id as string;
    img = Object.fromEntries(
      db
        .select()
        .from(asset)
        .all()
        .map((a) => [a.name, a.id]),
    );
    const byAsset = Object.fromEntries(Object.entries(img).map(([n, id]) => [id, n]));
    ids = Object.fromEntries(
      db
        .select()
        .from(prop)
        .all()
        .map((r) => [String(byAsset[r.assetId]).replace("prop-", ""), r.id]),
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

  test("SCN §13 step 1 snapshots: players get barrel + table (redacted), never the hidden chest or its asset", async () => {
    const dm = await h.live(DM);
    // Town is active: nothing of Goblin Ambush reaches anyone's snapshot yet (DM window, scene gate).
    const p1 = await h.live(p("Player 1"));
    expect(propsOf(p1)).toEqual({});
    expect(propsOf(dm)).toEqual({});
    expect((await answer(dm, dm.intent(I.activateScene, { sceneId: ambushId }))).type).toBe("ack");
    for (const c of [dm, p1]) c.close();
    const d = await h.live(DM);
    expect(Object.keys(propsOf(d)).sort()).toEqual(
      [ids.barrel, ids.table, ids.chest].map(String).sort(),
    );
    expect(propsOf(d)[ids.chest as string]).toMatchObject({ hidden: true, locked: false });
    for (const name of ["Player 1", "Player 2"]) {
      const c = await h.live(p(name));
      const ps = propsOf(c);
      expect(Object.keys(ps).sort()).toEqual([ids.barrel, ids.table].map(String).sort());
      expect(ps[ids.table as string]).toMatchObject({ col: 4, row: 11, w: 2, h: 1, rotation: 90 });
      const raw = c.raw();
      for (const leak of [img["prop-chest"] as string, '"locked"', ids.chest as string]) {
        expect(raw).not.toContain(leak);
      }
      expect(leakScan(h.s, c)).toEqual([]);
      c.close();
    }
    d.close();
  });

  test("SCN §13 step 6 live: place, resize, rotate, hide; reveal + lock the chest; players see each change, never `locked`", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // Players are refused every prop intent.
    const refused = await answer(
      p1,
      p1.intent(S.placeProp, { sceneId: ambushId, assetId: img["prop-barrel"], col: 1, row: 1 }),
    );
    expect(refused).toMatchObject({ type: "reject", code: "forbidden" });
    const placed = await answer(
      dm,
      dm.intent(S.placeProp, { sceneId: ambushId, assetId: img["prop-barrel"], col: 6, row: 12 }),
    );
    expect(placed.type).toBe("ack");
    const id = (placed as { result: { propId: string } }).result.propId;
    await until(() => propsOf(p1)[id] !== undefined && propsOf(p2)[id] !== undefined);
    expect(propsOf(p1)[id]).toMatchObject({ col: 6, row: 12, w: 1, h: 1 });
    for (const [name, input] of [
      [S.updateProp, { propId: id, w: 2, h: 2 }],
      [S.updateProp, { propId: id, rotation: 90 }],
    ] as const) {
      expect((await answer(dm, dm.intent(name, input))).type).toBe("ack");
    }
    await until(() => propsOf(p2)[id]?.rotation === 90);
    expect(propsOf(p2)[id]).toMatchObject({ w: 2, h: 2, rotation: 90 });
    expect((await answer(dm, dm.intent(S.setPropHidden, { propId: id, hidden: true }))).type).toBe(
      "ack",
    );
    await until(() => propsOf(p1)[id] === undefined && propsOf(p2)[id] === undefined);
    expect(propsOf(dm)[id]).toMatchObject({ hidden: true });
    // Reveal the chest: it arrives with its image; lock it; a locked drag is refused.
    const chest = ids.chest as string;
    expect(p1.raw()).not.toContain(img["prop-chest"] as string);
    await answer(dm, dm.intent(S.setPropHidden, { propId: chest, hidden: false }));
    await until(() => propsOf(p1)[chest] !== undefined);
    expect(propsOf(p1)[chest]).toMatchObject({ assetId: img["prop-chest"], col: 17, row: 12 });
    expect((await answer(dm, dm.intent(S.updateProp, { propId: chest, locked: true }))).type).toBe(
      "ack",
    );
    await until(() => (propsOf(dm)[chest] as ScenePropRecord | undefined)?.locked === true);
    const drag = await answer(dm, dm.intent(S.updateProp, { propId: chest, col: 15 }));
    expect(drag).toMatchObject({ type: "reject", code: "conflict" });
    // Prop frames: only Prop* causes; no `locked` anywhere a player received.
    for (const c of [p1, p2]) {
      expect(c.raw()).not.toContain('"locked"');
      const causes = c.frames.flatMap((f) => (f.type === "event" ? [f.cause.name] : []));
      expect(new Set(causes)).toEqual(
        new Set(["PropPlaced", "PropUpdated", "PropHidden", "PropRevealed"]),
      );
      expect(leakScan(h.s, c)).toEqual([]);
    }
    // Live stores equal fresh snapshots (FR-SYNC-20).
    for (const [c, cred] of [
      [dm, DM],
      [p1, p("Player 1")],
    ] as const) {
      const fresh = await h.live(cred);
      const conv = convergence(h.s, c, fresh);
      expect(conv.live).toEqual(conv.fresh);
      fresh.close();
    }
    // Tidy for later tests: back to the bundle's state for the chest; drop the barrel.
    await answer(dm, dm.intent(S.updateProp, { propId: chest, locked: false }));
    await answer(dm, dm.intent(S.setPropHidden, { propId: chest, hidden: true }));
    await answer(dm, dm.intent(S.deleteProp, { propId: id }));
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-SCN-32 edits on a non-active scene reach no player; the DM gets them live", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const ack = await answer(
      dm,
      dm.intent(S.placeProp, { sceneId: townId, assetId: img["prop-table"], col: 2, row: 2 }),
    );
    const id = (ack as { result: { propId: string } }).result.propId;
    await until(() => propsOf(dm)[id] !== undefined);
    await answer(dm, dm.intent(S.updateProp, { propId: id, col: 3 }));
    await answer(dm, dm.intent(S.deleteProp, { propId: id }));
    await p1.expectNoFrame(150);
    expect(p1.raw()).not.toContain(id);
    for (const c of [dm, p1]) c.close();
  });

  test("SCN §11 reconnect and restart → identical snapshots; props intact", async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const c = await h.live(cred);
        out[k] = c.store.records[SCENE_PROP_TYPE];
        c.close();
      }
      return out;
    };
    const before = await snap();
    expect(Object.keys(before.dm as object)).toHaveLength(3);
    expect(Object.keys(before.p1 as object)).toHaveLength(2);
    expect(await snap()).toEqual(before);
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
