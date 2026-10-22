// ENT §13 integration over real sockets on the `entities` bundle: REST, player views,
// live upserts, leak scan, restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { type EntityRecord, REDACTED_CHARACTER_KEYS } from "@shared/entities/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import { asc, sql } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { READ_ONLY_MESSAGE } from "./commands";

let h: TestServer;
let db: Db;
let dir: string;
let tokens: Record<string, string>;
const byName: Record<string, EntityRecord & { source?: string | null }> = {};

beforeAll(async () => {
  const loaded = await loadBundle("entities", { dmSecret: TEST_SECRET });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  tokens = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((p) => [p.name, p.token]),
  );
  h = await startTestServer({ db, fake: false });
  for (const r of db.select().from(entity).orderBy(asc(sql`rowid`)).all()) {
    byName[r.name] = r as unknown as EntityRecord;
  }
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

const id = (name: string) => byName[name]?.id as string;
const api = (method: string, path: string, body?: unknown, auth: string | null = TEST_SECRET) =>
  fetch(`${h.http}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const put = (e: EntityRecord, patch: Record<string, unknown> = {}) =>
  api("PUT", `/entities/${e.id}`, {
    name: e.name,
    portraitAssetId: e.portraitAssetId,
    statBlock: e.statBlock,
    ...(e.kind === "character" ? { ownerPlayerId: e.ownerPlayerId } : {}),
    ...patch,
  });
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
/** The next ack or reject (a `sync.load` reply). */
async function loadReply(c: TestClient) {
  for (;;) {
    const f = await c.next();
    if (f.type === "ack" || f.type === "reject") return f;
  }
}
const entityChanges = (frames: ServerFrame[]) =>
  frames.flatMap((f) => (f.type === "event" ? f.changes.filter((c) => c.type === "entity") : []));

describe("entities over REST + WS (entities bundle)", () => {
  test("FR-ENT-15/16 snapshots: P1 Mira full + Thorn redacted, P2 the reverse, no monsters", async () => {
    const p1 = await h.live({ role: "player", token: tokens["Player 1"] as string });
    const p2 = await h.live({ role: "player", token: tokens["Player 2"] as string });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const view = (c: TestClient) =>
      Object.values(c.store.records.entity ?? {}) as Record<string, unknown>[];
    const mira = (c: TestClient) => view(c).find((r) => r.name === "Mira");
    const thorn = (c: TestClient) => view(c).find((r) => r.name === "Thorn");
    expect(view(p1)).toHaveLength(2);
    expect(mira(p1)).toMatchObject({ hpCurrent: 12, statBlock: { ac: 16 } });
    // FR-CHARX-35 / FR-CBTX-32: the one whitelist, deathState included.
    expect(Object.keys(thorn(p1) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    expect(thorn(p2)).toMatchObject({ hpCurrent: 10 });
    expect(Object.keys(mira(p2) ?? {})).not.toContain("statBlock");
    expect(p1.store.records["imported-entity"]).toBeUndefined();
    // DM: characters + Elite in `entity`, no Marsh Troll. `imported-entity` is lazy (FR-CMP-15):
    // in no snapshot; Goblin + Wolf come by id with `sync.load`.
    expect(
      view(dm)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["Elite Goblin Warrior", "Mira", "Thorn"]);
    expect(dm.store.records["imported-entity"]).toBeUndefined();
    dm.load("imported-entity", [id("Goblin"), id("Wolf")]);
    await dm.next("ack");
    const imported = Object.values(dm.store.records["imported-entity"] ?? {}) as { name: string }[];
    expect(imported.map((r) => r.name).sort()).toEqual(["Goblin", "Wolf"]);
    p1.load("imported-entity", [id("Goblin"), id("Wolf")]);
    expect((await p1.next("reject")).code).toBe("forbidden");
    expect(p1.store.records["imported-entity"]).toBeUndefined();
    for (const c of [p1, p2, dm]) c.close();
  });

  test("FR-ENT-07 REST: imported PUT → 403 read-only; auth 401; strict body 400", async () => {
    const goblin = byName.Goblin as EntityRecord;
    const r = await put(goblin, { statBlock: { ...goblin.statBlock, ac: 1 } });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ code: "forbidden", message: READ_ONLY_MESSAGE });
    expect((await api("POST", "/entities", {}, null)).status).toBe(401);
    expect((await api("POST", "/entities", {}, tokens["Player 1"] as string)).status).toBe(401);
    const spoof = await api("POST", "/entities", {
      kind: "monster",
      name: "Spoof",
      campaignId: "x",
      statBlock: goblin.statBlock,
    });
    expect(spoof.status).toBe(400);
    expect(((await spoof.json()) as { code: string }).code).toBe("invalid");
    const dup = await api("POST", "/entities", {
      kind: "monster",
      name: "elite goblin warrior",
      statBlock: goblin.statBlock,
    });
    expect(dup.status).toBe(409);
    expect((await api("PUT", "/entities/nope", { name: "x", statBlock: {} })).status).toBe(404);
  });

  test("FR-ENT-22 REST tokenShape: fixture square; PUT none; PUT without tokenShape → null", async () => {
    const elite = byName["Elite Goblin Warrior"] as EntityRecord;
    expect(elite.tokenShape).toBe("square");
    const body = async (r: Response) => ((await r.json()) as { entity: EntityRecord }).entity;
    const none = await put(elite, { tokenShape: "none" });
    expect(none.status).toBe(200);
    expect((await body(none)).tokenShape).toBe("none");
    const omitted = await put(elite);
    expect(omitted.status).toBe(200);
    expect((await body(omitted)).tokenShape).toBeNull();
    const bad = await put(elite, { tokenShape: "hex" });
    expect(bad.status).toBe(400);
    // Restore the fixture value for the tests below.
    const restored = await put(elite, { tokenShape: "square" });
    byName["Elite Goblin Warrior"] = await body(restored);
    const created = await api("POST", "/entities", {
      kind: "monster",
      name: "Round Goblin",
      statBlock: (byName.Goblin as EntityRecord).statBlock,
    });
    expect((await body(created)).tokenShape).toBeNull();
  });

  test("FR-ENT-21 REST speed 33 → 400 with issue path statBlock.speed", async () => {
    const elite = byName["Elite Goblin Warrior"] as EntityRecord;
    const r = await put(elite, { statBlock: { ...elite.statBlock, speed: 33 } });
    expect(r.status).toBe(400);
    const issues = ((await r.json()) as { issues: { path: string[] }[] }).issues;
    expect(issues.map((i) => i.path.join("."))).toEqual(["statBlock.speed"]);
  });

  test("FR-ENT-18 monster edits reach the DM ≤ 1 s; players get no event frame", async () => {
    const p1 = await h.live({ role: "player", token: tokens["Player 1"] as string });
    const p2 = await h.live({ role: "player", token: tokens["Player 2"] as string });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const elite = byName["Elite Goblin Warrior"] as EntityRecord;
    const started = performance.now();
    const res = await put(elite, { statBlock: { ...elite.statBlock, hpMax: 20 } });
    expect(res.status).toBe(200);
    const updated = ((await res.json()) as { entity: EntityRecord }).entity;
    byName["Elite Goblin Warrior"] = updated;
    const ev = await dm.next("event", 1000);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(ev.cause.name).toBe("EntityUpdated");
    expect(ev.changes[0]).toMatchObject({ type: "entity", op: "upsert", data: { id: elite.id } });

    const created = await api("POST", "/entities", {
      kind: "monster",
      name: "Goblin Boss",
      derivedFromId: id("Goblin"),
      statBlock: (byName.Goblin as EntityRecord).statBlock,
    });
    expect(created.status).toBe(201);
    const boss = ((await created.json()) as { entity: EntityRecord }).entity;
    expect(boss).toMatchObject({ derivedFromId: id("Goblin"), campaignId: elite.campaignId });
    expect((await dm.next("event", 1000)).cause.name).toBe("EntityCreated");
    await p1.expectNoFrame(200);
    await p2.expectNoFrame(10);
    for (const c of [p1, p2, dm]) c.close();
  });

  test("FR-ENT-15 rename Mira: P1 full upsert, P2 redacted upsert", async () => {
    const p1 = await h.live({ role: "player", token: tokens["Player 1"] as string });
    const p2 = await h.live({ role: "player", token: tokens["Player 2"] as string });
    const mira = byName.Mira as EntityRecord;
    expect((await put(mira, { name: "Mira Vale" })).status).toBe(200);
    const e1 = await p1.next("event", 1000);
    const e2 = await p2.next("event", 1000);
    expect(e1.changes[0]?.data).toMatchObject({ name: "Mira Vale", hpCurrent: 12 });
    expect(e2.changes[0]?.data).toEqual({
      id: mira.id,
      kind: "character",
      name: "Mira Vale",
      portraitAssetId: null,
      ownerPlayerId: mira.ownerPlayerId,
      down: false,
      level: 1,
      className: "Fighter",
      species: null,
      deathState: null,
      hpCurrent: 12,
      hpMax: 12,
      tempHp: 0,
      ac: 16,
    });
    for (const c of [p1, p2]) c.close();
  });

  test("FR-ENT-15 Mira at 0 HP: P2's redacted upsert has down true and hpCurrent 0 (ADR-0063)", async () => {
    const p1 = await h.live({ role: "player", token: tokens["Player 1"] as string });
    const p2 = await h.live({ role: "player", token: tokens["Player 2"] as string });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    dm.intent("char.adjustHp", { characterId: id("Mira"), delta: -12 }, "down");
    const e1 = await p1.next("event", 1000);
    const e2 = await p2.next("event", 1000);
    expect(e1.changes.find((c) => c.type === "entity")?.data).toMatchObject({ hpCurrent: 0 });
    const redacted = e2.changes.find((c) => c.type === "entity")?.data as Record<string, unknown>;
    expect(redacted).toMatchObject({ id: id("Mira"), down: true, hpCurrent: 0, hpMax: 12 });
    expect(Object.keys(redacted)).not.toContain("statBlock");
    // Back above 0 → down false again.
    dm.intent("char.adjustHp", { characterId: id("Mira"), delta: 12 }, "up");
    const up = await p2.next("event", 1000);
    expect(up.changes.find((c) => c.type === "entity")?.data).toMatchObject({ down: false });
    for (const c of [p1, p2, dm]) c.close();
  });

  test("ENT §13 leak scan + restart: player-1 never sees monster names or Thorn's dice; snapshots survive", async () => {
    const creds = {
      dm: { role: "dm" as const, secret: TEST_SECRET },
      p1: { role: "player" as const, token: tokens["Player 1"] as string },
      p2: { role: "player" as const, token: tokens["Player 2"] as string },
    };
    const p1 = await h.live(creds.p1);
    // Edits during the session: a monster, Thorn, a new custom.
    const thorn = byName.Thorn as EntityRecord;
    await put(thorn, { statBlock: { ...thorn.statBlock, ac: 15 } });
    await api("POST", "/entities", {
      kind: "monster",
      name: "Hidden Horror",
      statBlock: (byName.Goblin as EntityRecord).statBlock,
    });
    // FR-SYNC-38: the load reply is scanned too (a player's load of the DM-only type is refused).
    p1.load("imported-entity", [id("Goblin"), id("Wolf")]);
    await p1.next("reject");
    await barrier(p1);
    const raw = p1.raw();
    for (const s of ["Elite Goblin Warrior", "Marsh Troll", "Goblin", "Hidden Horror", "1d4+3"]) {
      expect({ s, leaked: raw.includes(s) }).toEqual({ s, leaked: false });
    }
    expect(entityChanges(p1.frames).every((c) => c.id === thorn.id)).toBe(true);

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, c] of Object.entries(creds)) {
        const client = await h.live(c);
        const f = client.frames.find((x) => x.type === "snapshot");
        const records = f?.type === "snapshot" ? f.records : {};
        // `imported-entity` is lazy (FR-CMP-15): compare the load reply (DM) / the refusal.
        client.load("imported-entity", [id("Goblin"), id("Wolf")]);
        const reply = await loadReply(client);
        // Presence depends on who is connected; entities' types must be identical.
        out[k] = {
          entity: records.entity,
          imported: records["imported-entity"],
          load: reply.type === "ack" ? reply.result : reply.code,
        };
        client.close();
      }
      return out;
    };
    const before = await snap();
    p1.close();
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
