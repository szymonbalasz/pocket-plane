// Sprint 5 kept-template menu over real sockets on the `map-tools` bundle (SCN §13 integration,
// FR-SCN-50): the menu's Delete is the existing `scn.deleteTemplate`; a commit removes the template
// for every client that had it, a refused one reaches nobody, a second delete is `not_found`.
// Leak-free before and after a reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import {
  AOE_TEMPLATE_TYPE,
  SCN_INTENTS as S,
  type TemplateRecordView,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { aoeTemplate, player, scene } from "../../db/schema";
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
const labels = (c: TestClient) =>
  (Object.values(c.store.records[AOE_TEMPLATE_TYPE] ?? {}) as TemplateRecordView[])
    .map((r) => r.label)
    .sort();
const changesSince = (c: TestClient, from: number) =>
  c.frames
    .slice(from)
    .filter((f): f is Extract<ServerFrame, { type: "event" }> => f.type === "event")
    .flatMap((f) => f.changes);
const del = (label: string) => ({
  type: AOE_TEMPLATE_TYPE,
  op: "delete" as const,
  id: templateId[label] as string,
});

describe("SCN §13 template menu Delete over sockets (map-tools)", () => {
  test("FR-SCN-50 delete for everyone: DM and placer delete → TemplateDeleted to all; another player's → forbidden, nothing to anyone; again → not_found", async () => {
    const dm0 = await h.live(dmCred());
    expect(await intent(dm0, I.activateScene, { sceneId: ambush.id })).toMatchObject({
      type: "ack",
    });
    dm0.close();
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    const all = [dm, p1, p2];
    const sync = async () => {
      for (const c of all) await barrier(c);
    };
    expect(labels(dm)).toEqual(["Glyph", "Spirit Guardians", "Thunderwave", "Web"]);
    for (const p of [p1, p2]) expect(labels(p)).toEqual(["Spirit Guardians", "Thunderwave", "Web"]);

    // player-2 deletes player-1's Spirit Guardians → forbidden; nothing reaches anyone.
    let mark = all.map((c) => c.frames.length);
    expect(
      await intent(p2, S.deleteTemplate, { templateId: templateId["Spirit Guardians"] }),
    ).toMatchObject({ type: "reject", code: "forbidden" });
    await sync();
    for (const [i, c] of all.entries()) expect(changesSince(c, mark[i] as number)).toEqual([]);

    // The DM deletes Spirit Guardians (a player's) → its delete reaches all three.
    mark = all.map((c) => c.frames.length);
    expect(
      await intent(dm, S.deleteTemplate, { templateId: templateId["Spirit Guardians"] }),
    ).toMatchObject({ type: "ack" });
    await sync();
    for (const [i, c] of all.entries()) {
      expect(changesSince(c, mark[i] as number)).toEqual([del("Spirit Guardians")]);
      expect(labels(c)).not.toContain("Spirit Guardians");
    }

    // player-2 deletes their own Thunderwave → delete to all.
    mark = all.map((c) => c.frames.length);
    expect(
      await intent(p2, S.deleteTemplate, { templateId: templateId.Thunderwave }),
    ).toMatchObject({ type: "ack" });
    await sync();
    for (const [i, c] of all.entries())
      expect(changesSince(c, mark[i] as number)).toEqual([del("Thunderwave")]);

    // A second delete (the template already gone) → not_found, no event.
    mark = all.map((c) => c.frames.length);
    expect(
      await intent(p2, S.deleteTemplate, { templateId: templateId.Thunderwave }),
    ).toMatchObject({ type: "reject", code: "not_found" });
    expect(
      await intent(dm, S.deleteTemplate, { templateId: templateId.Thunderwave }),
    ).toMatchObject({ type: "reject", code: "not_found" });
    // FR-SCN-26 kept: a player's delete of the hidden Glyph → not_found (never `forbidden`).
    expect(await intent(p1, S.deleteTemplate, { templateId: templateId.Glyph })).toMatchObject({
      type: "reject",
      code: "not_found",
    });
    await sync();
    for (const [i, c] of all.entries()) expect(changesSince(c, mark[i] as number)).toEqual([]);

    expect(labels(dm)).toEqual(["Glyph", "Web"]);
    for (const p of [p1, p2]) expect(labels(p)).toEqual(["Web"]);
    // Reconnect: the fresh snapshot equals the live store; no leak before or after.
    const fresh = await h.live(p1Cred());
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    for (const p of [p1, p2, fresh]) expect(leakScan(h.s, p)).toEqual([]);
    for (const x of [...all, fresh]) x.close();
  });
});
