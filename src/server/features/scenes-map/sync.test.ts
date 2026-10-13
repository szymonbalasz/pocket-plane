// MAP §13 integration over real sockets on the `scenes` bundle: snapshots per role, moves and
// ownership, activation resync, hide/reveal, signals, REST, leak scan, restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import { MAP_INTENTS as I, MAP_SIGNALS } from "@shared/scenes-map/schemas";
import { asc } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player, scene, sceneFolder, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

let h: TestServer;
let db: Db;
let dir: string;
let links: Record<string, string>;
const sceneId: Record<string, string> = {};
const tokenId: Record<string, string> = {};
let monsterDefIds: string[] = [];
let eliteImage: string;
let wolfImage: string;

beforeAll(async () => {
  const loaded = await loadBundle("scenes", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  links = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((p) => [p.name, p.token]),
  );
  for (const s of db.select().from(scene).all()) sceneId[s.name] = s.id;
  const ambush = sceneId["Goblin Ambush"];
  for (const t of db.select().from(token).orderBy(asc(token.seq)).all()) {
    if (t.sceneId === ambush) tokenId[t.name] = t.id;
    if (t.sceneId === sceneId.Town) tokenId[`town:${t.name}`] = t.id;
    if (t.name === "Elite Goblin Warrior") eliteImage = t.imageAssetId as string;
    if (t.name === "Wolf") wolfImage = t.imageAssetId as string;
  }
  monsterDefIds = db
    .select()
    .from(entity)
    .all()
    .filter((e) => e.kind === "monster")
    .map((e) => e.id);
  h = await startTestServer({ db, fake: false, testMode: true });
}, 30_000); // loads the scenes bundle incl. sharp rasterising: > 5 s under parallel agent load

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
const api = (method: string, path: string, body?: unknown, auth: string | null = TEST_SECRET) =>
  fetch(`${h.http}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const names = (c: TestClient, type: string) =>
  Object.values(c.store.records[type] ?? {})
    .map((r) => (r as { name?: string }).name)
    .sort();
/** Sends an intent and waits for its ack or reject. */
async function intent(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
  }
}
/** Leak strings for player frames (MAP §13), checked against raw bytes. */
function leaks(c: TestClient, extra: string[] = []): string[] {
  const raw = c.raw();
  const always = [
    "Elite Goblin Warrior",
    "Ambush",
    "Cellar",
    "Act 1",
    eliteImage,
    tokenId["Elite Goblin Warrior"] as string,
    ...monsterDefIds,
  ];
  return [...always, ...extra].filter((s) => s && raw.includes(s));
}

describe("scenes-map over REST + WS (scenes bundle)", () => {
  test("FR-MAP-26 snapshots: DM all scenes + folder; players the active Town, redacted", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    expect(names(dm, "scene")).toEqual(["Cellar", "Goblin Ambush", "Town"]);
    expect(names(dm, "scene-folder")).toEqual(["Act 1"]);
    expect(Object.keys(dm.store.records.token ?? {})).toHaveLength(9);
    const scenes = Object.values(p1.store.records.scene ?? {}) as Record<string, unknown>[];
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ id: sceneId.Town, active: true, gridCellSize: 70 });
    expect(scenes[0]).not.toHaveProperty("name");
    expect(p1.store.records["scene-folder"]).toBeUndefined();
    expect(names(p1, "token")).toEqual(["Mira", "Thorn"]);
    for (const t of Object.values(p1.store.records.token ?? {})) {
      expect(t).not.toHaveProperty("definitionId");
    }
    expect(leaks(p1, ["Wolf", wolfImage])).toEqual([]);
    expect(leakScan(h.s, p1)).toEqual([]);
    for (const c of [dm, p1]) c.close();
  });

  test("FR-MAP-36 leak property: a player's tokens carry `speed` only where they own them", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    const ogre = (Object.values(dm.store.records.token ?? {}) as Record<string, unknown>[]).find(
      (t) => t.name === "Cave Ogre",
    );
    expect(ogre).toMatchObject({ speed: 40, shape: "none", size: "large" });
    for (const c of [p1, p2]) {
      const me = c.store.you?.playerId;
      const seen = Object.values(c.store.records.token ?? {}) as Record<string, unknown>[];
      expect(seen.length).toBeGreaterThan(0);
      for (const t of seen) expect("speed" in t).toBe(t.ownerPlayerId === me);
      for (const t of seen) expect(t).toHaveProperty("shape");
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-MAP-15 / -21 move: P1 moves Mira (others see it ≤ 1 s); P2 → forbidden; hidden → not_found", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    const mira = tokenId["town:Mira"] as string;
    const started = performance.now();
    const ack = await intent(p1, I.moveToken, { tokenId: mira, col: 8, row: 5 });
    expect(ack.type).toBe("ack");
    let ev = await dm.next("event", 1000);
    while (ev.cause.name === "presence") ev = await dm.next("event", 1000);
    const ev2 = await p2.next("event", 1000);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(ev.cause.name).toBe("TokenMoved");
    expect(ev.changes[0]).toMatchObject({ type: "token", op: "upsert", data: { col: 8, row: 5 } });
    expect(ev2.changes[0]?.data).not.toHaveProperty("definitionId");
    const rej = await intent(p2, I.moveToken, { tokenId: mira, col: 9, row: 5 });
    expect(rej).toMatchObject({ type: "reject", code: "forbidden" });
    const wolf = await intent(p1, I.moveToken, { tokenId: tokenId.Wolf, col: 1, row: 1 });
    expect(wolf).toMatchObject({ type: "reject", code: "not_found" });
    const place = await intent(p1, I.placeToken, {
      sceneId: sceneId.Town,
      definitionId: monsterDefIds[0],
      col: 1,
      row: 1,
    });
    expect(place).toMatchObject({ type: "reject", code: "forbidden" });
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-MAP-06 activate Goblin Ambush: players resynced, store = fresh snapshot, no hidden tokens", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    // Edits off the active scene reach players as nothing.
    expect(
      (await intent(dm, I.setTokenHidden, { tokenId: tokenId.Goblin, hidden: true })).type,
    ).toBe("ack");
    expect(
      (await intent(dm, I.setTokenHidden, { tokenId: tokenId.Goblin, hidden: false })).type,
    ).toBe("ack");
    await p1.expectNoFrame(150);
    expect((await intent(dm, I.activateScene, { sceneId: sceneId["Goblin Ambush"] })).type).toBe(
      "ack",
    );
    await p1.next("snapshot", 1000);
    expect(names(p1, "token")).toEqual(["Cave Ogre", "Goblin", "Mira", "Thorn"]);
    const fresh = await h.live(p1Cred());
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    expect(leaks(p1, ["Wolf", wolfImage])).toEqual([]);
    expect(leakScan(h.s, p1)).toEqual([]);
    for (const x of [dm, p1, fresh]) x.close();
  });

  test("FR-MAP-19 reveal Wolf → upsert with its image; hide → delete", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    await intent(dm, I.setTokenHidden, { tokenId: tokenId.Wolf, hidden: false });
    const up = await p1.next("event", 1000);
    expect(up.cause.name).toBe("TokenRevealed");
    expect(up.changes[0]).toMatchObject({
      op: "upsert",
      data: { name: "Wolf", imageAssetId: wolfImage },
    });
    await intent(dm, I.setTokenHidden, { tokenId: tokenId.Wolf, hidden: true });
    const del = await p1.next("event", 1000);
    expect(del.cause.name).toBe("TokenHidden");
    expect(del.changes).toEqual([{ type: "token", id: tokenId.Wolf as string, op: "delete" }]);
    const fresh = await h.live(p1Cred());
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    for (const x of [dm, p1, fresh]) x.close();
  });

  test("FR-MAP-25 signals: ping reaches DM + P2 with server `from`, not the sender; player pull → nobody; no log", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    const logs = readEventLog(db).length;
    const data = { sceneId: sceneId["Goblin Ambush"], x: 100, y: 200 };
    p1.send({ type: "signal", name: MAP_SIGNALS.ping, data });
    const playerId = p1.store.you?.playerId;
    for (const c of [dm, p2]) {
      const f = await c.next("signal", 1000);
      expect(f).toMatchObject({ name: "map.ping", data, from: { role: "player", playerId } });
    }
    p1.send({ type: "signal", name: MAP_SIGNALS.pull, data });
    expect(await p1.next("reject", 1000)).toMatchObject({ code: "forbidden" });
    p1.send({
      type: "signal",
      name: MAP_SIGNALS.laser,
      data: { sceneId: "s", points: [[1, 2]], end: true },
    });
    expect((await dm.next("signal", 1000)).name).toBe("map.laser");
    dm.send({ type: "signal", name: MAP_SIGNALS.pull, data });
    expect((await p1.next("signal", 1000)).from).toEqual({ role: "dm" });
    p1.send({ type: "signal", name: MAP_SIGNALS.ping, data: { ...data, x: 99999 } });
    expect(await p1.next("reject", 1000)).toMatchObject({ code: "invalid" });
    await barrier(p2);
    expect(
      p2.frames.filter((f) => f.type === "signal").map((f) => (f as { name: string }).name),
    ).toEqual(["map.ping", "map.laser", "map.pull"]);
    expect(readEventLog(db).length).toBe(logs);
    for (const c of [dm, p1, p2]) c.close();
  });

  test("MAP §9 REST: auth, create / patch / duplicate / delete, folders; players see nothing", async () => {
    const p1 = await h.live(p1Cred());
    expect((await api("POST", "/scenes", { name: "X", mapAssetId: "a" }, null)).status).toBe(401);
    expect((await api("POST", "/scenes", {}, links["Player 1"] as string)).status).toBe(401);
    const tavernMap = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Town")?.mapAssetId as string;
    const created = await api("POST", "/scenes", { name: "Tavern", mapAssetId: tavernMap });
    expect(created.status).toBe(201);
    const tavern = ((await created.json()) as { scene: { id: string; active: boolean } }).scene;
    expect(tavern.active).toBe(false);
    expect((await api("POST", "/scenes", { name: "Bad", mapAssetId: "nope" })).status).toBe(404);
    expect((await api("POST", "/scenes", { name: "", mapAssetId: tavernMap })).status).toBe(400);
    const folder = await api("POST", "/scene-folders", { name: "Act 2" });
    expect(folder.status).toBe(201);
    const act2 = ((await folder.json()) as { sceneFolder: { id: string } }).sceneFolder;
    const dup = await api("POST", `/scenes/${sceneId["Goblin Ambush"]}/duplicate`);
    expect(dup.status).toBe(201);
    const copy = ((await dup.json()) as { scene: { id: string; name: string; active: boolean } })
      .scene;
    expect(copy).toMatchObject({ name: "Goblin Ambush (copy)", active: false });
    const moved = await api("PATCH", `/scenes/${copy.id}`, { folderId: act2.id });
    expect(moved.status).toBe(200);
    expect((await api("PATCH", `/scenes/${copy.id}`, {})).status).toBe(400);
    expect((await api("PATCH", `/scene-folders/${act2.id}`, { name: "Act II" })).status).toBe(200);
    expect((await api("DELETE", `/scenes/${sceneId["Goblin Ambush"]}`)).status).toBe(409);
    expect((await api("DELETE", `/scenes/${tavern.id}`)).status).toBe(204);
    expect((await api("DELETE", `/scenes/${tavern.id}`)).status).toBe(404);
    const copyTokens = db
      .select()
      .from(token)
      .all()
      .filter((t) => t.sceneId === copy.id);
    expect(
      copyTokens
        .filter((t) => t.hidden)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["Elite Goblin Warrior", "Wolf"]);
    expect(
      db
        .select()
        .from(sceneFolder)
        .all()
        .map((f) => f.name)
        .sort(),
    ).toEqual(["Act 1", "Act II"]);
    await barrier(p1);
    expect(p1.frames.filter((f: ServerFrame) => f.type === "event")).toEqual([]);
    expect(leaks(p1, ["Act 2", "Act II", "Tavern"])).toEqual([]);
    p1.close();
  });

  test("MAP §13 restart: identical snapshots; positions, hidden flags, active scene survive", async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: dmCred(), p1: p1Cred(), p2: p2Cred() })) {
        const c = await h.live(cred);
        const f = c.frames.find((x) => x.type === "snapshot");
        const r = f?.type === "snapshot" ? f.records : {};
        out[k] = { scene: r.scene, folder: r["scene-folder"], token: r.token };
        c.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
    expect(h.s.records.activeSceneOf(db.select().from(scene).all()[0]?.campaignId as string)).toBe(
      sceneId["Goblin Ambush"] as string,
    );
  });
});
