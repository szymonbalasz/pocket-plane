// FR-MAP-53 drag path over real sockets on the `map-tools` bundle (MAP §13, sprint 4): the path is
// a client draw rule over the `map.drag` frames each client already receives, so nothing new
// reaches anyone: players get frames only for tokens they see (FR-MAP-41, FR-FOG-15), and their
// `pathShown` draws a path only for player tokens. `map.drag` keeps its sprint-3 fields.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import {
  MAP_INTENTS as I,
  MAP_SIGNALS,
  TOKEN_TYPE,
  type TokenView,
} from "@shared/scenes-map/schemas";
import { pathShown } from "@ui/features/scenes-map/drag-path";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player, scene, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

let h: TestServer;
let db: Db;
let dir: string;
let links: Record<string, string>;
let ambushId: string;
const ids: Record<string, string> = {};

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
  ambushId = (
    db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush") as {
      id: string;
    }
  ).id;
  for (const t of db.select().from(token).all()) if (t.sceneId === ambushId) ids[t.name] = t.id;
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
const dragFrames = (c: TestClient, from: number) =>
  c.frames
    .slice(from)
    .filter(
      (f): f is Extract<ServerFrame, { type: "signal" }> =>
        f.type === "signal" && f.name === MAP_SIGNALS.drag,
    );
const held = (c: TestClient, id: string) =>
  c.store.records[TOKEN_TYPE]?.[id] as TokenView | undefined;
/** A held drag: a few frames at rest, then the end. */
function holdDrag(c: TestClient, tokenId: string, x: number, y: number) {
  for (const dx of [0, 10, 20])
    c.send({
      type: "signal",
      name: MAP_SIGNALS.drag,
      data: { sceneId: ambushId, tokenId, x: x + dx, y },
    });
  c.send({
    type: "signal",
    name: MAP_SIGNALS.drag,
    data: { sceneId: ambushId, tokenId, end: true },
  });
}

describe("MAP §13 drag path frames (map-tools)", () => {
  test("FR-MAP-53 path frames: Mira → DM + player-2 (path); Goblin Sneak → players glide, no path; fog-hidden Goblin → no frame; Thorn → both players (path); payload keeps its fields; same after a reconnect", async () => {
    const dm0 = await h.live(dmCred());
    expect(await intent(dm0, I.activateScene, { sceneId: ambushId })).toMatchObject({
      type: "ack",
    });
    dm0.close();
    const dm = await h.live(dmCred());
    let p1 = await h.live(p1Cred());
    let p2 = await h.live(p2Cred());
    const [mira, thorn, sneak, goblin] = ["Mira", "Thorn", "Goblin Sneak", "Goblin"].map(
      (n) => ids[n] as string,
    );
    // The fixture as the walkthrough reads it: Mira player-1's, Thorn player-2's, Goblin Sneak
    // visible to both, the Goblin fog-hidden from both.
    expect(held(p1, mira as string)?.ownerPlayerId).not.toBeNull();
    expect(held(p2, thorn as string)?.ownerPlayerId).not.toBeNull();
    for (const p of [p1, p2]) {
      expect(held(p, sneak as string)?.ownerPlayerId).toBeNull();
      expect(held(p, goblin as string)).toBeUndefined();
    }

    const run = async (sender: TestClient, tokenId: string, receivers: TestClient[]) => {
      const marks = receivers.map((c) => c.frames.length);
      holdDrag(sender, tokenId, 140, 490);
      for (const c of [sender, ...receivers]) await barrier(c);
      return receivers.map((c, i) => dragFrames(c, marks[i] as number));
    };
    const fieldsOk = (frames: Extract<ServerFrame, { type: "signal" }>[]) => {
      for (const f of frames) {
        const keys = Object.keys(f.data as object).sort();
        expect(keys.join() === "sceneId,tokenId,x,y" || keys.join() === "end,sceneId,tokenId").toBe(
          true,
        );
      }
    };

    // player-1 drags Mira: the DM and player-2 get the frames and draw the path.
    const [dmGot, p2Got] = await run(p1, mira as string, [dm, p2]);
    for (const [c, got, role] of [
      [dm, dmGot, "dm"],
      [p2, p2Got, "player"],
    ] as const) {
      expect(got?.length).toBe(4);
      fieldsOk(got ?? []);
      expect(pathShown(held(c, mira as string), role)).toBe(true);
    }

    // DM drags Goblin Sneak (visible): players get frames (glide) but draw no path.
    const sneakGot = await run(dm, sneak as string, [p1, p2]);
    for (const [i, p] of [p1, p2].entries()) {
      expect(sneakGot[i]?.length).toBe(4);
      fieldsOk(sneakGot[i] ?? []);
      expect(pathShown(held(p, sneak as string), "player")).toBe(false);
    }
    expect(pathShown(held(dm, sneak as string), "dm")).toBe(true);

    // DM drags the fog-hidden Goblin: no frame naming it reaches a player, so no path.
    const gobMarks = [p1, p2].map((c) => c.frames.length);
    holdDrag(dm, goblin as string, 840, 420);
    await barrier(dm);
    for (const [i, p] of [p1, p2].entries()) {
      await p.expectNoFrame(150);
      expect(dragFrames(p, gobMarks[i] as number)).toEqual([]);
      expect(pathShown(held(p, goblin as string), "player")).toBe(false);
    }

    // DM drags Thorn (a player token): both players get frames and draw the path.
    const thornGot = await run(dm, thorn as string, [p1, p2]);
    for (const [i, p] of [p1, p2].entries()) {
      expect(thornGot[i]?.length).toBe(4);
      expect(pathShown(held(p, thorn as string), "player")).toBe(true);
    }

    // After a reconnect: the same audience (the Goblin still reaches no player).
    p1.close();
    p2.close();
    p1 = await h.live(p1Cred());
    p2 = await h.live(p2Cred());
    for (const p of [p1, p2]) {
      expect(held(p, goblin as string)).toBeUndefined();
      expect(p.raw()).not.toContain(goblin as string);
    }
    const marks = [p1, p2].map((c) => c.frames.length);
    holdDrag(dm, goblin as string, 840, 420);
    await barrier(dm);
    for (const [i, p] of [p1, p2].entries()) {
      await p.expectNoFrame(150);
      expect(dragFrames(p, marks[i] as number)).toEqual([]);
    }
    const again = await run(p1, mira as string, [p2]);
    expect(again[0]?.length).toBe(4);
    for (const c of [dm, p1, p2]) c.close();
  });
});
