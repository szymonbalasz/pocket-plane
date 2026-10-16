// Test support for FOG §13's V2 integration tests: the `vision` bundle on a real server (DM,
// `player-1` = Mira, `player-2` = Thorn over real sockets), Goblin Ambush active, plus the per-player
// leak checks (snapshot, every frame, a fresh connection, a `resync`).
import { expect } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { entity, player, scene, token } from "@server/db/schema";
import type { Actor, DispatchedEvent } from "@server/events/types";
import { toTokenRecord } from "@server/features/scenes-map/rows";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { createTestServices, TEST_SECRET } from "@server/testing/services";
import type { Viewer } from "@server/ws/records";
import { convergence, leakScan } from "@server/ws/testing/convergence";
import {
  FOG_INTENTS as F,
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  type FogExploredRecord,
  type FogRecord,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import { fogHidden } from "@shared/fog-of-war/visibility";
import type { ServerFrame } from "@shared/protocol/frames";
import { SCN_INTENTS } from "@shared/scene-tools/schemas";
import {
  MAP_INTENTS as I,
  MAP_INTENTS,
  MAP_SIGNALS,
  TOKEN_TYPE,
  type TokenRecord,
} from "@shared/scenes-map/schemas";
import { loadBundle } from "../../index";

export const DM = { role: "dm" as const, secret: TEST_SECRET };
/** Goblin Ambush's grid cell (px). */
export const CELL = 70;
/** `scn-walls`: door d1 (8, 5)–(8, 6). */
export const D1 = 4;

export async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

export async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}

/** Every token record in snapshots and event upserts. */
export function tokenRecordsIn(frames: readonly ServerFrame[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const f of frames) {
    if (f.type === "snapshot") out.push(...((f.records[TOKEN_TYPE] ?? []) as never[]));
    if (f.type === "event") {
      for (const ch of f.changes) {
        const data = (ch as { data?: Record<string, unknown> }).data;
        if (ch.type === TOKEN_TYPE && data) out.push(data);
      }
    }
  }
  return out;
}

export type Who = "p1" | "p2";

export async function visionHarness() {
  const loaded = await loadBundle("vision", { dmSecret: TEST_SECRET, testMode: true });
  const db: Db = openFileDb(loaded.config.dbPath);
  const players = db.select().from(player).all();
  const links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
  const pid: Record<Who, string> = {
    p1: players.find((r) => r.name === "Player 1")?.id as string,
    p2: players.find((r) => r.name === "Player 2")?.id as string,
  };
  const ambush = db
    .select()
    .from(scene)
    .all()
    .find((s) => s.name === "Goblin Ambush") as typeof scene.$inferSelect;
  const ambushId = ambush.id;
  const h: TestServer = await startTestServer({ db, fake: false });
  const dm = await h.live(DM);
  const cred = (w: Who) => ({
    role: "player" as const,
    token: links[w === "p1" ? "Player 1" : "Player 2"] as string,
  });

  const send = async (c: TestClient, name: string, input: object) => {
    const a = await answer(c, c.intent(name, input));
    return a as Extract<ServerFrame, { type: "ack" | "reject" }>;
  };
  const ok = async (c: TestClient, name: string, input: object) => {
    const a = await send(c, name, input);
    if (a.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(a)}`);
    return (a as { result: Record<string, unknown> }).result;
  };
  expect((await send(dm, I.activateScene, { sceneId: ambushId })).type).toBe("ack");
  expect((await answer(dm, dm.loadScene(ambushId))).type).toBe("ack");
  const c: Record<Who, TestClient> = { p1: await h.live(cred("p1")), p2: await h.live(cred("p2")) };

  /** Server token rows on Goblin Ambush (with `seenBy`), by name. */
  const tokens = (): Record<string, TokenRecord> =>
    Object.fromEntries(
      db
        .select()
        .from(token)
        .all()
        .filter((t) => t.sceneId === ambushId)
        .map((t) => [t.name, { ...toTokenRecord(t), seenBy: t.seenBy } as TokenRecord]),
    );
  const id = (name: string) => tokens()[name]?.id as string;
  const charId = (name: string) =>
    db
      .select()
      .from(entity)
      .all()
      .find((e) => e.name === name && e.kind === "character")?.id as string;
  const names = (cl: TestClient) =>
    Object.values((cl.store.records[TOKEN_TYPE] ?? {}) as Record<string, TokenRecord>)
      .filter((t) => t.sceneId === ambushId)
      .map((t) => t.name)
      .sort();
  const visionOf = (cl: TestClient, w: Who) =>
    cl.store.records[VISION_TYPE]?.[`${ambushId}:${pid[w]}`] as VisionRecord | undefined;
  const exploredOf = (cl: TestClient, w: Who) =>
    cl.store.records[FOG_EXPLORED_TYPE]?.[`${ambushId}:${pid[w]}`] as FogExploredRecord | undefined;
  const fogOf = (cl: TestClient) => cl.store.records[FOG_TYPE]?.[ambushId] as FogRecord | undefined;
  const hiddenFor = (playerId: string) => (t: TokenRecord) =>
    t.hidden || fogHidden(TOKEN_TYPE, t, playerId);

  const move = (cl: TestClient, name: string, col: number, row: number) =>
    ok(cl, I.moveToken, { tokenId: id(name), col, row });
  const setDoor = (state: 0 | 1 | 2) =>
    ok(dm, SCN_INTENTS.setDoor, { sceneId: ambushId, n: D1, state });
  const senses = (name: string, s: object) =>
    ok(dm, "char.edit", { creatureId: charId(name), set: { senses: s } });
  const undo = async () => {
    const fog = dm.store.records[FOG_TYPE]?.[ambushId] as FogRecord;
    return ok(dm, F.undo, { sceneId: ambushId, expectedEditId: fog.undo?.editId });
  };
  const drag = (cl: TestClient, name: string, at: [number, number] | "end") =>
    cl.send({
      type: "signal",
      name: MAP_SIGNALS.drag,
      data:
        at === "end"
          ? { sceneId: ambushId, tokenId: id(name), end: true }
          : { sceneId: ambushId, tokenId: id(name), x: at[0] * CELL, y: at[1] * CELL },
    });
  const drags = (cl: TestClient, from: number) =>
    cl.frames
      .slice(from)
      .flatMap((f) =>
        f.type === "signal" && f.name === MAP_SIGNALS.drag
          ? [f.data as { tokenId: string; x?: number; end?: true }]
          : [],
      );
  const mark = (): Record<Who, number> => ({ p1: c.p1.frames.length, p2: c.p2.frames.length });
  /** Event frames of a client since `from` with this cause. */
  const events = (cl: TestClient, from: number, cause?: string) =>
    cl.frames
      .slice(from)
      .filter(
        (f): f is Extract<ServerFrame, { type: "event" }> =>
          f.type === "event" && (cause === undefined || f.cause.name === cause),
      );

  /**
   * Both players hold exactly `want` (token names on Goblin Ambush), then per player: leak scan,
   * no secret key on any frame, no upsert since `marks` of a token hidden for them now, `fogged`
   * only on own tokens; a fresh connection converges (tokens, `fog`, `vision`, `fog-explored`) and
   * names no hidden token; a `resync` lands on the same state.
   */
  async function expectSee(want: Record<Who, string[]>, marks?: Record<Who, number>) {
    for (const w of ["p1", "p2"] as const) {
      await until(() => names(c[w]).join() === [...want[w]].sort().join());
    }
    const all = tokens();
    for (const w of ["p1", "p2"] as const) {
      const cl = c[w];
      const me = pid[w];
      const other = pid[w === "p1" ? "p2" : "p1"];
      expect(leakScan(h.s, cl)).toEqual([]);
      const raw = cl.raw();
      for (const key of [
        '"seenBy"',
        '"doorSeen"',
        '"walls"',
        '"invisible"',
        `${ambushId}:${other}`,
      ]) {
        expect(raw).not.toContain(key);
      }
      for (const r of tokenRecordsIn(cl.frames)) {
        if (r.fogged === true) expect(r.ownerPlayerId).toBe(me);
      }
      const hiddenNow = Object.values(all).filter(hiddenFor(me));
      for (const r of tokenRecordsIn(cl.frames.slice(marks?.[w] ?? cl.frames.length))) {
        expect(hiddenNow.map((t) => t.id)).not.toContain(r.id as string);
      }
      const fresh = await h.live(cred(w));
      const conv = convergence(h.s, cl, fresh);
      for (const type of [TOKEN_TYPE, FOG_TYPE, VISION_TYPE, FOG_EXPLORED_TYPE]) {
        expect(conv.live[type] ?? {}).toEqual(conv.fresh[type] ?? {});
      }
      // A combatant row may name a token the player can't see (accepted leak, FOG §11, OQ-FOG-25 B).
      const fr = JSON.stringify(
        fresh.frames.map((f) =>
          f.type === "snapshot" ? { ...f, records: { ...f.records, combatant: [] } } : f,
        ),
      );
      for (const t of hiddenNow) expect(fr).not.toContain(t.id);
      if (hiddenNow.some((t) => t.name === "Goblin Lurker"))
        expect(fr).not.toContain("Goblin Lurker");
      fresh.close();
      const before = cl.frames.length;
      cl.send({ type: "resync" });
      await until(() => cl.frames.slice(before).some((f) => f.type === "snapshot"));
      await until(() => names(cl).join() === [...want[w]].sort().join());
      const snap = cl.frames.slice(before).find((f) => f.type === "snapshot");
      const ids = tokenRecordsIn(snap ? [snap] : []).map((r) => r.id);
      for (const t of hiddenNow) expect(ids).not.toContain(t.id);
    }
  }

  async function stop() {
    await h.stop();
    closeDb(db);
    try {
      rmSync(loaded.dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }

  return {
    h,
    db,
    dm,
    c,
    pid,
    ambushId,
    cred,
    send,
    ok,
    tokens,
    id,
    charId,
    names,
    visionOf,
    exploredOf,
    fogOf,
    move,
    setDoor,
    senses,
    undo,
    drag,
    drags,
    mark,
    events,
    expectSee,
    stop,
  };
}

export type VisionHarness = Awaited<ReturnType<typeof visionHarness>>;

/** Is cell (col, row) in an explored-memory row? */
export function explores(r: FogExploredRecord | undefined, col: number, row: number): boolean {
  if (!r) return false;
  const [c0, r0, cols, rows] = r.box;
  const c = col - c0;
  const rr = row - r0;
  if (c < 0 || rr < 0 || c >= cols || rr >= rows) return false;
  let at = 0;
  let v = 1;
  const want = rr * cols + c;
  for (const part of r.runs === "" ? [] : r.runs.split(",")) {
    const len = Number.parseInt(part, 36);
    if (want < at + len) return v === 1;
    at += len;
    v = 1 - v;
  }
  return false;
}

/**
 * The `vision` bundle on in-process services (no sockets): Goblin Ambush active, commands run as
 * the DM (or a player), every dispatched event captured, snapshots per viewer.
 */
export async function visionServices() {
  const loaded = await loadBundle("vision", { dmSecret: TEST_SECRET, testMode: true });
  const db: Db = openFileDb(loaded.config.dbPath);
  const s = createTestServices({ db });
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => events.push(e));
  const players = db.select().from(player).all();
  const pid: Record<Who, string> = {
    p1: players.find((r) => r.name === "Player 1")?.id as string,
    p2: players.find((r) => r.name === "Player 2")?.id as string,
  };
  const scenes = db.select().from(scene).all();
  const sceneId = (name: string) => scenes.find((x) => x.name === name)?.id as string;
  const ambushId = sceneId("Goblin Ambush");
  const campaignId = scenes[0]?.campaignId as string;
  const dmActor: Actor = { role: "dm", playerId: null, campaignId };
  const actor = (w: Who): Actor => ({ role: "player", playerId: pid[w], campaignId });
  const run = <R = unknown>(name: string, input: unknown, a: Actor = dmActor) =>
    s.commands.run(name, input, { actor: a }) as R;
  const viewer = (w: Who | "dm"): Viewer =>
    w === "dm"
      ? { connId: "dm", campaignId, role: "dm", playerId: null }
      : { connId: w, campaignId, role: "player", playerId: pid[w] };
  const snapshot = (w: Who | "dm") =>
    s.records.snapshot({ db: s.db, presence: { list: () => [] } }, viewer(w));
  const tokenRow = (name: string, on = ambushId) =>
    db
      .select()
      .from(token)
      .all()
      .find((x) => x.name === name && x.sceneId === on) as typeof token.$inferSelect;
  const charId = (name: string) =>
    db
      .select()
      .from(entity)
      .all()
      .find((e) => e.name === name && e.kind === "character")?.id as string;
  const last = () => events.at(-1)?.event;
  /** `[type, id-or-name]` of the last event's changes (token ids → names). */
  const changesOf = (e = last()) =>
    (e?.changes ?? []).map((c) => {
      const t = db
        .select()
        .from(token)
        .all()
        .find((x) => x.id === c.id);
      return `${c.type}:${t ? t.name : c.id === `${ambushId}:${pid.p1}` ? "p1" : c.id === `${ambushId}:${pid.p2}` ? "p2" : c.id}`;
    });
  run(MAP_INTENTS.activateScene, { sceneId: ambushId });
  const stop = () => {
    closeDb(db);
    try {
      rmSync(loaded.dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  };
  return {
    s,
    db,
    events,
    pid,
    sceneId,
    ambushId,
    campaignId,
    dmActor,
    actor,
    run,
    viewer,
    snapshot,
    tokenRow,
    charId,
    last,
    changesOf,
    stop,
  };
}

export type VisionServices = Awaited<ReturnType<typeof visionServices>>;
