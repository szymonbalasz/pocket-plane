// Sprint 4 templates over real sockets on the `map-tools` bundle (SCN §13 integration): every
// client computes the same affected squares from the kept rows (no cell list on any wire), and
// Clear templates' scope (FR-SCN-44) per role, leak-free before and after a reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import { templateCells } from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  SCN_INTENTS as S,
  type TemplateRecordView,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { aoeTemplate, player, scene } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

let h: TestServer;
let db: Db;
let dir: string;
let links: Record<string, string>;
let ambush: SceneRecord;
const templateId: Record<string, string> = {};

beforeAll(async () => {
  const loaded = await loadBundle("map-tools", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  links = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((p) => [p.name, p.token]),
  );
  ambush = db
    .select()
    .from(scene)
    .all()
    .find((s) => s.name === "Goblin Ambush") as SceneRecord;
  for (const t of db.select().from(aoeTemplate).all()) templateId[t.label] = t.id;
  h = await startTestServer({ db, fake: false, testMode: true });
}, 60_000); // loads the vision bundle incl. sharp rasterising

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const dmCred = () => ({ role: "dm" as const, secret: TEST_SECRET });
const p1Cred = () => ({ role: "player" as const, token: links["Player 1"] as string });
const p2Cred = () => ({ role: "player" as const, token: links["Player 2"] as string });
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
async function intent(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
  }
}
const kept = (c: TestClient) =>
  Object.values(c.store.records[AOE_TEMPLATE_TYPE] ?? {}) as TemplateRecordView[];
const labels = (c: TestClient) =>
  kept(c)
    .map((r) => r.label)
    .sort();
/** Each kept template's squares as this client draws them (FR-SCN-21, cut to the map). */
const squares = (c: TestClient) =>
  Object.fromEntries(
    kept(c).map((t) => [
      t.label,
      templateCells(
        t,
        {
          gridCellSize: ambush.gridCellSize,
          gridOffsetX: ambush.gridOffsetX,
          gridOffsetY: ambush.gridOffsetY,
          mapWidth: ambush.mapWidth as number,
          mapHeight: ambush.mapHeight as number,
        },
        { cut: true },
      )
        .map(([col, row]) => `${col},${row}`)
        .join(" "),
    ]),
  );
const clearedEvents = (c: TestClient, from: number) =>
  c.frames
    .slice(from)
    .filter((f): f is Extract<ServerFrame, { type: "event" }> => f.type === "event");

describe("SCN §13 map-tools templates over sockets", () => {
  test("FR-SCN-44 Clear templates scope (map-tools): Web + Glyph only, players keep theirs and get Web's delete; then the rest; nothing left → no event; player → forbidden", async () => {
    const dm0 = await h.live(dmCred());
    expect(await intent(dm0, I.activateScene, { sceneId: ambush.id })).toMatchObject({
      type: "ack",
    });
    dm0.close();
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    expect(labels(dm)).toEqual(["Glyph", "Spirit Guardians", "Thunderwave", "Web"]);
    for (const p of [p1, p2]) {
      expect(labels(p)).toEqual(["Spirit Guardians", "Thunderwave", "Web"]);
      expect(p.raw()).not.toContain("Glyph");
    }
    // FR-SCN-41 / -23: no cell list on the wire; every client draws the same squares, incl.
    // Thunderwave's 8 golden squares.
    for (const c of [dm, p1, p2]) expect(c.raw()).not.toMatch(/"cells"/);
    const p2Squares = squares(p2);
    expect(p2Squares.Thunderwave).toBe("3,8 2,9 3,9 4,9 2,10 3,10 4,10 3,11");
    expect(squares(p1)).toEqual(p2Squares);
    const { Glyph: _glyph, ...dmVisible } = squares(dm);
    expect(dmVisible).toEqual(p2Squares);

    // Default scope: DM-placed only (Web, Glyph).
    const logBefore = readEventLog(db).length;
    const mark = [dm, p1, p2].map((c) => c.frames.length);
    expect(await intent(dm, S.clearTemplates, { sceneId: ambush.id })).toMatchObject({
      type: "ack",
    });
    for (const c of [p1, p2]) await barrier(c);
    expect(clearedEvents(dm, mark[0] as number).map((f) => f.cause.name)).toEqual([
      "TemplatesCleared",
    ]);
    const log = readEventLog(db);
    expect(log.length).toBe(logBefore + 1);
    const entry = log.at(-1);
    expect(entry?.type).toBe("TemplatesCleared");
    const payload = entry?.payload as { sceneId: string; templateIds: string[]; players: boolean };
    expect({ ...payload, templateIds: [...payload.templateIds].sort() }).toEqual({
      sceneId: ambush.id,
      templateIds: [templateId.Glyph as string, templateId.Web as string].sort(),
      players: false,
    });
    expect(labels(dm)).toEqual(["Spirit Guardians", "Thunderwave"]);
    for (const [i, p] of [p1, p2].entries()) {
      expect(labels(p)).toEqual(["Spirit Guardians", "Thunderwave"]);
      const changes = clearedEvents(p, mark[i + 1] as number).flatMap((f) => f.changes);
      // Web's delete (they saw it); none for their own; nothing about Glyph.
      expect(changes).toEqual([
        { type: AOE_TEMPLATE_TYPE, op: "delete", id: templateId.Web as string },
      ]);
      expect(JSON.stringify(changes)).not.toContain(templateId.Glyph as string);
    }

    // A player can't clear (default-DM intent).
    expect(await intent(p1, S.clearTemplates, { sceneId: ambush.id, players: true })).toMatchObject(
      {
        type: "reject",
        code: "forbidden",
      },
    );
    // Reconnect: the fresh snapshot equals the live store; no leak before or after.
    const fresh = await h.live(p2Cred());
    const c = convergence(h.s, p2, fresh);
    expect(c.live).toEqual(c.fresh);
    for (const p of [p1, p2, fresh]) expect(leakScan(h.s, p)).toEqual([]);

    // With the tick: the players' kept ones go too.
    const mark2 = [p1, p2].map((x) => x.frames.length);
    await intent(dm, S.clearTemplates, { sceneId: ambush.id, players: true });
    for (const x of [p1, p2, fresh]) await barrier(x);
    for (const x of [dm, p1, p2, fresh]) expect(labels(x)).toEqual([]);
    for (const [i, p] of [p1, p2].entries()) {
      const ids = clearedEvents(p, mark2[i] as number)
        .flatMap((f) => f.changes)
        .map((ch) => ch.id)
        .sort();
      expect(ids).toEqual(
        [templateId["Spirit Guardians"] as string, templateId.Thunderwave as string].sort(),
      );
    }
    // Nothing left: no write, no event.
    const logAfter = readEventLog(db).length;
    const mark3 = dm.frames.length;
    expect(await intent(dm, S.clearTemplates, { sceneId: ambush.id, players: true })).toMatchObject(
      {
        type: "ack",
      },
    );
    await barrier(dm);
    expect(clearedEvents(dm, mark3)).toEqual([]);
    expect(readEventLog(db).length).toBe(logAfter);
    for (const p of [p1, p2, fresh]) expect(leakScan(h.s, p)).toEqual([]);
    for (const x of [dm, p1, p2, fresh]) x.close();
  });
});
