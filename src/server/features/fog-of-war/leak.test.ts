// FOG §13 leak tests over real sockets (`player-1`, `player-2`) on the `fog` bundle, Goblin Ambush
// active: snapshot + every frame through reveal rect / polygon, undo, Goblin 2 out of fog, Goblin
// into fog, `map.drag` of each (position and `end` frames), an owned token in fog, Fog all, Reveal
// all; again after `resync` and on a fresh connection at each state; convergence. Properties: no
// player frame carries a fog-hidden token (id, name, position); no player record has
// `fogged: true` unless it is that player's own token; no player `signal` names a fog-hidden token
// or previews an ownerless token in a wholly fogged cell.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { FOG_INTENTS as F, FOG_TYPE, type FogRecord } from "@shared/fog-of-war/schemas";
import { fogHidden } from "@shared/fog-of-war/visibility";
import type { ServerFrame } from "@shared/protocol/frames";
import {
  MAP_INTENTS as I,
  MAP_SIGNALS,
  TOKEN_TYPE,
  type TokenRecord,
} from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player, scene, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { toTokenRecord } from "../scenes-map/rows";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const CELL = 70;

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
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

/** Every token record a player frame carried: snapshots, event upserts, `sync.loadScene` acks. */
function tokenRecordsIn(frames: readonly ServerFrame[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const f of frames) {
    if (f.type === "snapshot") out.push(...((f.records[TOKEN_TYPE] ?? []) as never[]));
    if (f.type === "event") {
      for (const ch of f.changes) {
        const data = (ch as { data?: Record<string, unknown> }).data;
        if (ch.type === TOKEN_TYPE && data) out.push(data);
      }
    }
    if (f.type === "ack") {
      const recs = (f.result as { records?: Record<string, unknown[]> } | undefined)?.records;
      out.push(...((recs?.[TOKEN_TYPE] ?? []) as never[]));
    }
  }
  return out;
}

describe("FOG §13 leak walkthrough (player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let playerIds: Record<string, string>;
  let ambushId: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  /** Goblin Ambush tokens by name, from the DB (current state). */
  const tokens = () =>
    Object.fromEntries(
      db
        .select()
        .from(token)
        .all()
        .filter((t) => t.sceneId === ambushId)
        .map((t) => [t.name, toTokenRecord(t)]),
    ) as Record<string, TokenRecord>;
  const id = (name: string) => tokens()[name]?.id as string;
  const hiddenForPlayers = (t: TokenRecord) => t.hidden || fogHidden(TOKEN_TYPE, t);
  const names = (c: TestClient) =>
    Object.values((c.store.records[TOKEN_TYPE] ?? {}) as Record<string, TokenRecord>)
      .filter((t) => t.sceneId === ambushId)
      .map((t) => t.name)
      .sort();
  const fogEdit = async (input: object) => {
    const a = await answer(dm, dm.intent(F.edit, { sceneId: ambushId, ...input }));
    expect(a.type).toBe("ack");
    return (a as { result: { editId: string } }).result.editId;
  };
  const setAll = async (fogged: boolean) =>
    expect((await answer(dm, dm.intent(F.setAll, { sceneId: ambushId, fogged }))).type).toBe("ack");
  const undo = async () => {
    const fog = dm.store.records[FOG_TYPE]?.[ambushId] as FogRecord;
    const a = await answer(
      dm,
      dm.intent(F.undo, { sceneId: ambushId, expectedEditId: fog.undo?.editId }),
    );
    expect(a.type).toBe("ack");
  };
  const move = async (c: TestClient, name: string, col: number, row: number) =>
    expect((await answer(c, c.intent(I.moveToken, { tokenId: id(name), col, row }))).type).toBe(
      "ack",
    );
  const drag = (c: TestClient, name: string, at: [number, number] | "end") =>
    c.send({
      type: "signal",
      name: MAP_SIGNALS.drag,
      data:
        at === "end"
          ? { sceneId: ambushId, tokenId: id(name), end: true }
          : { sceneId: ambushId, tokenId: id(name), x: at[0] * CELL, y: at[1] * CELL },
    });
  const drags = (c: TestClient, from: number) =>
    c.frames
      .slice(from)
      .flatMap((f) =>
        f.type === "signal" && f.name === MAP_SIGNALS.drag
          ? [f.data as { sceneId: string; tokenId: string; x?: number; y?: number; end?: true }]
          : [],
      );

  /**
   * Both players hold exactly `want` (names on Goblin Ambush); then every check: leak scan, the
   * `fogged` property over every frame, upserts since `mark` only of visible tokens, a fresh
   * connection converges and carries no fog-hidden id / name, and a `resync` snapshot too.
   */
  async function expectPlayersSee(want: string[], marks: [number, number]) {
    for (const c of [p1, p2]) await until(() => names(c).join() === [...want].sort().join());
    const all = tokens();
    const hiddenNow = Object.values(all).filter(hiddenForPlayers);
    for (const [i, [c, name]] of (
      [
        [p1, "Player 1"],
        [p2, "Player 2"],
      ] as const
    ).entries()) {
      expect(leakScan(h.s, c)).toEqual([]);
      const me = playerIds[name];
      for (const r of tokenRecordsIn(c.frames)) {
        if (r.fogged === true) expect(r.ownerPlayerId).toBe(me);
      }
      for (const r of tokenRecordsIn(c.frames.slice(marks[i]))) {
        expect(hiddenNow.map((t) => t.id)).not.toContain(r.id as string);
      }
      // Fresh connection = the reconnect snapshot.
      const fresh = await h.live(p(name));
      const conv = convergence(h.s, c, fresh);
      expect(conv.live[TOKEN_TYPE]).toEqual(conv.fresh[TOKEN_TYPE] ?? {});
      expect(conv.live[FOG_TYPE]).toEqual(conv.fresh[FOG_TYPE] ?? {});
      const raw = fresh.raw();
      for (const t of hiddenNow) expect(raw).not.toContain(t.id);
      if (hiddenNow.some((t) => t.name === "Goblin Lurker")) {
        expect(raw).not.toContain("Goblin Lurker");
      }
      fresh.close();
    }
    // `resync` on a live connection: the same filtered snapshot.
    const before = p2.frames.length;
    p2.send({ type: "resync" });
    await until(() => p2.frames.slice(before).some((f) => f.type === "snapshot"));
    const snap = p2.frames.slice(before).find((f) => f.type === "snapshot");
    const ids = tokenRecordsIn(snap ? [snap] : []).map((r) => r.id);
    for (const t of hiddenNow) expect(ids).not.toContain(t.id);
    await until(() => names(p2).join() === [...want].sort().join());
  }
  const mark = (): [number, number] => [p1.frames.length, p2.frames.length];

  beforeAll(async () => {
    const loaded = await loadBundle("fog", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    playerIds = Object.fromEntries(players.map((r) => [r.name, r.id]));
    ambushId = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush")?.id as string;
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    expect((await answer(dm, dm.intent(I.activateScene, { sceneId: ambushId }))).type).toBe("ack");
    p1 = await h.live(p("Player 1"));
    p2 = await h.live(p("Player 2"));
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

  test("FOG §13 walkthrough 1: players see Mira, Thorn, Cave Ogre only", async () => {
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre"], [0, 0]);
    for (const c of [p1, p2]) expect(c.raw()).not.toContain("Goblin Lurker");
  });

  test("FR-FOG-05 / -12 walkthrough 2: reveal rect (11, 5)–(13, 7) → Goblin upserts; Goblin 2 still absent", async () => {
    const m = mark();
    await fogEdit({ op: "reveal", shape: { kind: "rect", c0: 11, r0: 5, c1: 13, r1: 7 } });
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin"], m);
    for (const c of [p1, p2]) {
      const ev = c.frames
        .slice(m[c === p1 ? 0 : 1])
        .find((f) => f.type === "event" && f.cause.name === "FogEdited");
      // One event: the fog row and the revealed token together.
      expect(ev?.type === "event" && ev.changes.map((ch) => [ch.type, ch.op])).toEqual([
        [FOG_TYPE, "upsert"],
        [TOKEN_TYPE, "upsert"],
      ]);
    }
  });

  test("FR-FOG-05 walkthrough 3–4: polygon reveal → Lurker upserts; Undo → delete", async () => {
    let m = mark();
    await fogEdit({
      op: "reveal",
      shape: {
        kind: "polygon",
        points: [
          [15, 10],
          [19, 10],
          [19, 13],
          [15, 13],
        ],
      },
    });
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin", "Goblin Lurker"], m);
    m = mark();
    await undo();
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin"], m);
    const lurker = id("Goblin Lurker");
    for (const c of [p1, p2]) {
      const del = c.frames
        .slice(m[c === p1 ? 0 : 1])
        .flatMap((f) => (f.type === "event" ? f.changes : []))
        .find((ch) => ch.id === lurker);
      expect(del?.op).toBe("delete");
    }
  });

  test("FR-FOG-15 walkthrough 5: drag Goblin 2 inside fog → no player frame; it appears on the drop", async () => {
    const goblin2 = id("Goblin 2");
    for (const c of [p1, p2]) expect(c.raw()).not.toContain(goblin2);
    const m = mark();
    const other = await h.live(DM); // a second DM tab sees the preview
    for (const at of [
      [12, 8],
      [12, 7],
      [11, 7],
      [11, 6],
    ] as [number, number][]) {
      drag(dm, "Goblin 2", at);
    }
    await until(() => drags(other, 0).length === 4);
    await move(dm, "Goblin 2", 11, 6);
    drag(dm, "Goblin 2", "end");
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin", "Goblin 2"], m);
    expect(tokens()["Goblin 2"]).toMatchObject({ col: 11, row: 6 });
    // Every position frame preceded the drop: none reached a player; the end frame (after the
    // drop, the token visible now) may.
    for (const [i, c] of [p1, p2].entries()) {
      expect(drags(c, m[i] as number).filter((d) => d.end !== true)).toEqual([]);
    }
    other.close();
  });

  test("FR-FOG-15 walkthrough 6: drag Goblin into fog → glides to the edge, vanishes on the drop", async () => {
    const goblin = id("Goblin");
    const m = mark();
    // (13, 6) clear; (14, 6), (16, 6) wholly fogged.
    for (const at of [
      [13, 6],
      [14, 6],
      [16, 6],
    ] as [number, number][]) {
      drag(dm, "Goblin", at);
    }
    await until(() => drags(p1, m[0]).length >= 1 && drags(p2, m[1]).length >= 1);
    await move(dm, "Goblin", 16, 6);
    drag(dm, "Goblin", "end");
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin 2"], m);
    for (const [i, c] of [p1, p2].entries()) {
      // Only the clear-cell frame; the end frame routes by the stored state (fog-hidden → DM).
      expect(drags(c, m[i] as number)).toEqual([
        { sceneId: ambushId, tokenId: goblin, x: 910, y: 420 },
      ]);
      const del = c.frames
        .slice(m[i])
        .flatMap((f) => (f.type === "event" ? f.changes : []))
        .find((ch) => ch.id === goblin);
      expect(del?.op).toBe("delete");
    }
  });

  test("FR-FOG-11 / -15 walkthrough 7: hide (0, 3)–(7, 11); player-1 drags Mira into fog → both still see Mira and Thorn", async () => {
    let m = mark();
    await fogEdit({ op: "hide", shape: { kind: "rect", c0: 0, r0: 3, c1: 7, r1: 11 } });
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin 2"], m);
    expect(tokens().Mira?.fogged).toBe(true);
    m = mark();
    drag(p1, "Mira", [5, 5]);
    await until(() => drags(p2, m[1]).length === 1);
    await move(p1, "Mira", 5, 5);
    drag(p1, "Mira", "end");
    await until(() => drags(p2, m[1]).length === 2);
    await expectPlayersSee(["Mira", "Thorn", "Cave Ogre", "Goblin 2"], m);
    expect(tokens().Mira).toMatchObject({ col: 5, row: 5, fogged: true });
    const mira = p1.store.records[TOKEN_TYPE]?.[id("Mira")] as TokenRecord;
    expect(mira).toMatchObject({ col: 5, row: 5, fogged: true });
    expect(p2.store.records[TOKEN_TYPE]?.[id("Mira")]).not.toHaveProperty("fogged");
  });

  test("FR-FOG-06 / -07 walkthrough 8: Fog all → only the party; Reveal all → every non-hidden token; Undo → back", async () => {
    let m = mark();
    await setAll(true);
    await expectPlayersSee(["Mira", "Thorn"], m);
    m = mark();
    await setAll(false);
    await expectPlayersSee(
      ["Mira", "Thorn", "Cave Ogre", "Goblin", "Goblin 2", "Goblin Lurker"],
      m,
    );
    m = mark();
    await undo();
    await expectPlayersSee(["Mira", "Thorn"], m);
    // Hidden + fogged never reached a player in any step.
    for (const c of [p1, p2]) {
      for (const n of ["Wolf", "Elite Goblin Warrior"]) expect(c.raw()).not.toContain(id(n));
    }
  });
});
