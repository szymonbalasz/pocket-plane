// SCN §13 integration over real sockets on the `scene-tools` bundle (build/scene-tools-structure):
// players get doors only (locked as closed, no walls) in the snapshot and in every frame, and only
// the `StructureEdited` cause; a player's move across the wall is rejected with nothing sent to
// anyone; the DM opens d1 and the move passes; the DM moves through walls; Cellar edits reach no
// player; leak scan + convergence; a restart serves the same structure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import {
  type PlayerSceneStructureRecord,
  SCN_INTENTS as S,
  SCENE_STRUCTURE_TYPE,
  type SceneStructureRecord,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player, scene, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { WALL_BLOCKED } from "./guard";

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
const structureOf = (c: TestClient, id: string) =>
  c.store.records[SCENE_STRUCTURE_TYPE]?.[id] as
    | SceneStructureRecord
    | PlayerSceneStructureRecord
    | undefined;
const tokenOf = (c: TestClient, id: string) =>
  c.store.records[TOKEN_TYPE]?.[id] as TokenRecord | undefined;
/** Every `scene-structure` payload a client received (snapshot rows and event data). */
const structureFrames = (c: TestClient) =>
  c.frames.flatMap((f: ServerFrame) => {
    if (f.type === "snapshot") return (f.records[SCENE_STRUCTURE_TYPE] ?? []) as object[];
    if (f.type === "event") {
      return f.changes.filter((ch) => ch.type === SCENE_STRUCTURE_TYPE).map((ch) => ch as object);
    }
    return [];
  });

describe("scene-tools bundle over WS (build/scene-tools-structure)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ambushId: string;
  let cellarId: string;
  let miraId: string;
  let goblinId: string;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("scene-tools", { dmSecret: TEST_SECRET, testMode: true });
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
    // A second scene to edit while it isn't active ("Cellar" in the walkthrough).
    cellarId = scenes.find((s) => s.id !== ambushId && !s.active)?.id as string;
    const tokens = db.select().from(token).all();
    miraId = tokens.find((t) => t.sceneId === ambushId && t.name === "Mira")?.id as string;
    goblinId = tokens.find((t) => t.sceneId === ambushId && t.name === "Goblin")?.id as string;
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

  test("SCN §13 guard + doors over WS: refused move sends nothing; d1 opened → the move passes; players see doors only", async () => {
    const show = await h.live(DM);
    expect((await answer(show, show.intent(I.activateScene, { sceneId: ambushId }))).type).toBe(
      "ack",
    );
    show.close();
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(structureOf(dm, ambushId)).toMatchObject({
      walls: [
        [1, 8, 0, 8, 5],
        [2, 8, 6, 8, 11],
        [3, 8, 12, 8, 14],
      ],
      doors: [
        [4, 8, 5, 8, 6, 1, 0],
        [5, 8, 11, 8, 12, 2, 0],
      ],
    });
    for (const c of [p1, p2]) {
      expect(structureOf(c, ambushId)).toEqual({
        id: ambushId,
        doors: [
          [4, 8, 5, 8, 6, 0],
          [5, 8, 11, 8, 12, 0],
        ],
      });
    }

    // FR-SCN-11: Mira (2, 7) → (10, 7) is refused; no frame reaches anyone.
    const counts = [dm, p1, p2].map((c) => c.frames.length);
    const refused = await answer(p1, p1.intent(I.moveToken, { tokenId: miraId, col: 10, row: 7 }));
    expect(refused).toMatchObject({ type: "reject", code: "conflict", message: WALL_BLOCKED });
    await Bun.sleep(50);
    expect(dm.frames.length).toBe(counts[0] as number);
    expect(p2.frames.length).toBe(counts[2] as number);
    expect(tokenOf(dm, miraId)).toMatchObject({ col: 2, row: 7 });

    // FR-SCN-09: the DM opens d1 (double-click = setDoor open); players see it open.
    expect(
      (await answer(dm, dm.intent(S.setDoor, { sceneId: ambushId, n: 4, state: 0 }))).type,
    ).toBe("ack");
    for (const c of [p1, p2]) {
      await until(
        () => (structureOf(c, ambushId) as PlayerSceneStructureRecord).doors[0]?.[5] === 1,
      );
    }
    expect(
      (await answer(p1, p1.intent(I.moveToken, { tokenId: miraId, col: 7, row: 5 }))).type,
    ).toBe("ack");
    expect(
      (await answer(p1, p1.intent(I.moveToken, { tokenId: miraId, col: 9, row: 5 }))).type,
    ).toBe("ack");
    await until(() => tokenOf(p2, miraId)?.col === 9);

    // Lock / unlock d2: players see it closed throughout.
    for (const state of [1, 2] as const) {
      expect(
        (await answer(dm, dm.intent(S.setDoor, { sceneId: ambushId, n: 5, state }))).type,
      ).toBe("ack");
    }
    await until(() => (structureOf(dm, ambushId) as SceneStructureRecord).rev === 6);

    // FR-SCN-10: the DM is never blocked.
    expect(
      (await answer(dm, dm.intent(I.moveToken, { tokenId: goblinId, col: 4, row: 6 }))).type,
    ).toBe("ack");

    // A wall drawn on a non-active scene reaches no player.
    const before = [p1, p2].map((c) => structureFrames(c).length);
    expect(
      (await answer(dm, dm.intent(S.addWalls, { sceneId: cellarId, segments: [[1, 1, 3, 1]] })))
        .type,
    ).toBe("ack");
    await until(() => structureOf(dm, cellarId) !== undefined);
    await Bun.sleep(50);
    expect([p1, p2].map((c) => structureFrames(c).length)).toEqual(before);

    for (const c of [p1, p2]) {
      const frames = JSON.stringify(structureFrames(c));
      expect(frames).not.toContain('"walls"');
      expect(frames).not.toContain(cellarId);
      for (const s of structureFrames(c)) {
        const doors = (
          (s as { data?: PlayerSceneStructureRecord }).data ?? (s as PlayerSceneStructureRecord)
        ).doors;
        expect(doors.every((d) => d.length === 6 && (d[5] === 0 || d[5] === 1))).toBe(true);
        expect(doors.find((d) => d[0] === 5)?.[5]).toBe(0);
      }
      // Players see only the cause name of StructureEdited.
      const edits = c.frames.filter(
        (f) => f.type === "event" && f.cause.name === "StructureEdited",
      );
      expect(edits.length).toBe(3);
      for (const leak of ['"payload"', '"ns"', "setDoor", "addWalls"]) {
        expect(JSON.stringify(edits)).not.toContain(leak);
      }
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(leakScan(h.s, dm)).toEqual([]);
    for (const [live, cred] of [
      [dm, DM],
      [p1, p("Player 1")],
      [p2, p("Player 2")],
    ] as const) {
      const fresh = await h.live(cred);
      const c = convergence(h.s, live, fresh);
      expect(c.live[SCENE_STRUCTURE_TYPE]).toEqual(c.fresh[SCENE_STRUCTURE_TYPE] ?? {});
      expect(c.live[TOKEN_TYPE]).toEqual(c.fresh[TOKEN_TYPE] ?? {});
      fresh.close();
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("SCN §11 restart: walls and door states come back in the snapshot", async () => {
    const dm1 = await h.live(DM);
    const want = structureOf(dm1, ambushId);
    dm1.close();
    await h.stop();
    h = await startTestServer({ db, fake: false });
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    expect(structureOf(dm, ambushId)).toEqual(want as SceneStructureRecord);
    expect((structureOf(p1, ambushId) as PlayerSceneStructureRecord).doors).toEqual([
      [4, 8, 5, 8, 6, 1],
      [5, 8, 11, 8, 12, 0],
    ]);
    dm.close();
    p1.close();
  });
});
