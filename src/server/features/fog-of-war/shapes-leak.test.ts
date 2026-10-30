// FOG §13 V1 leak tests over real sockets (`player-1`, `player-2`) on the `fog` bundle, Goblin
// Ambush active: freeform shapes and magical darkness (static). Darkness is filtered per player
// (FR-FOG-44): a shape whose box lies in static fog reaches nobody (the event arrives with its
// `cause` only); one over revealed area reaches both; one over a player's explored memory reaches
// that player only. Darkness and Explored hide records (FR-FOG-34). Checked on the snapshot, every
// event, the DM's `sync.loadScene` ack, a fresh connection and a `resync`; `seenBy` on no wire.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  FOG_INTENTS as F,
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  type FogRecord,
  type PlayerFogRecord,
} from "@shared/fog-of-war/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import { MAP_INTENTS as I, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { fogExplored, player, scene } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const AT = "2026-01-01T00:00:00.000Z";

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

describe("FOG §13 V1 leak walkthrough: shapes + darkness (player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let playerIds: Record<string, string>;
  let ambushId: string;
  let campaignId: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  const fogOf = (c: TestClient) =>
    c.store.records[FOG_TYPE]?.[ambushId] as PlayerFogRecord | FogRecord | undefined;
  const darkIds = (c: TestClient) => (fogOf(c)?.darkness ?? []).map((d) => d.id);
  const names = (c: TestClient) =>
    Object.values((c.store.records[TOKEN_TYPE] ?? {}) as Record<string, TokenRecord>)
      .filter((t) => t.sceneId === ambushId)
      .map((t) => t.name)
      .sort();
  const send = async (name: string, input: object) => {
    const a = await answer(dm, dm.intent(name, { sceneId: ambushId, ...input }));
    expect(a.type).toBe("ack");
    return (a as { result: Record<string, unknown> }).result;
  };
  const place = async (shape: object) =>
    (await send(F.placeDarkness, { shape })).darknessId as string;
  const undo = async () => {
    const fog = dm.store.records[FOG_TYPE]?.[ambushId] as FogRecord;
    await send(F.undo, { expectedEditId: fog.undo?.editId });
  };
  const mark = (): [number, number] => [p1.frames.length, p2.frames.length];
  /** The event frames a player got since `from` with this cause. */
  const events = (c: TestClient, from: number, cause: string) =>
    c.frames
      .slice(from)
      .filter(
        (f): f is Extract<ServerFrame, { type: "event" }> =>
          f.type === "event" && f.cause.name === cause,
      );

  /**
   * Each player holds exactly `want` darkness ids (and `tokens`, by name); every frame is free of
   * `seenBy` and of the darkness ids outside that player's set (`never`); a fresh connection and a
   * `resync` carry the same filtered row.
   */
  async function expectDarkness(
    want: { p1: string[]; p2: string[] },
    never: { p1?: string[]; p2?: string[] },
    tokens?: string[],
  ) {
    const all: [TestClient, string, string[], string[]][] = [
      [p1, "Player 1", want.p1, never.p1 ?? []],
      [p2, "Player 2", want.p2, never.p2 ?? []],
    ];
    for (const [c, , ids] of all) {
      await until(() => darkIds(c).join() === ids.join());
      if (tokens) await until(() => names(c).join() === [...tokens].sort().join());
    }
    for (const [c, name, ids, absent] of all) {
      expect(leakScan(h.s, c)).toEqual([]);
      const raw = c.raw();
      expect(raw).not.toContain("seenBy");
      for (const id of absent) expect(raw).not.toContain(id);
      const fresh = await h.live(p(name));
      const conv = convergence(h.s, c, fresh);
      expect(conv.live[FOG_TYPE]).toEqual(conv.fresh[FOG_TYPE] ?? {});
      expect(conv.live[TOKEN_TYPE]).toEqual(conv.fresh[TOKEN_TYPE] ?? {});
      expect(darkIds(fresh)).toEqual(ids);
      expect(fresh.raw()).not.toContain("seenBy");
      fresh.close();
    }
    const before = p1.frames.length;
    p1.send({ type: "resync" });
    await until(() => p1.frames.slice(before).some((f) => f.type === "snapshot"));
    await until(() => darkIds(p1).join() === want.p1.join());
    // The DM: every darkness shape, never `seenBy` (events, snapshot, `sync.loadScene` ack).
    expect((await answer(dm, dm.loadScene(ambushId))).type).toBe("ack");
    expect(dm.raw()).not.toContain("seenBy");
  }

  beforeAll(async () => {
    const loaded = await loadBundle("fog", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    playerIds = Object.fromEntries(players.map((r) => [r.name, r.id]));
    const ambush = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush");
    ambushId = ambush?.id as string;
    campaignId = ambush?.campaignId as string;
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    expect((await answer(dm, dm.intent(I.activateScene, { sceneId: ambushId }))).type).toBe("ack");
    expect((await answer(dm, dm.loadScene(ambushId))).type).toBe("ack");
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

  const party = ["Mira", "Thorn", "Cave Ogre"];
  const ids: Record<string, string> = {};

  test("FR-FOG-05 / -26 a freeform polygon (Fog) reaches both players as a shape (accepted leak), records follow", async () => {
    const m = mark();
    await send(F.edit, {
      op: "fog",
      shape: { polygon: [15.3, 10.2, 18.6, 10.2, 18.6, 12.7, 15.3, 12.7] },
    });
    for (const [i, c] of [p1, p2].entries()) {
      await until(() => (fogOf(c)?.shapes.length ?? 0) === 3);
      expect(fogOf(c)?.shapes.at(-1)).toEqual({
        op: "fog",
        polygon: [15.3, 10.2, 18.6, 10.2, 18.6, 12.7, 15.3, 12.7],
      });
      expect(events(c, m[i] as number, "FogEdited")).toHaveLength(1);
    }
    await expectDarkness({ p1: [], p2: [] }, {}, party);
  });

  test("FR-FOG-44 darkness [17.5, 11.5, 1] in static fog → no fog upsert to either player (event cause only)", async () => {
    const m = mark();
    ids.fogged = await place({ circle: [17.5, 11.5, 1] });
    for (const [i, c] of [p1, p2].entries()) {
      await until(() => events(c, m[i] as number, "DarknessPlaced").length === 1);
      expect(events(c, m[i] as number, "DarknessPlaced")[0]?.changes).toEqual([]);
    }
    await until(() => darkIdsDm().includes(ids.fogged as string));
    await expectDarkness({ p1: [], p2: [] }, { p1: [ids.fogged], p2: [ids.fogged] });
  });

  const darkIdsDm = () => darkIds(dm);

  test("FR-FOG-44 darkness [1.5, 8.5, 1] over the revealed nook → both players get the fog upsert", async () => {
    const m = mark();
    ids.nook = await place({ circle: [1.5, 8.5, 1] });
    for (const [i, c] of [p1, p2].entries()) {
      await until(() => events(c, m[i] as number, "DarknessPlaced").length === 1);
      expect(
        events(c, m[i] as number, "DarknessPlaced")[0]?.changes.map((ch) => [ch.type, ch.op]),
      ).toEqual([[FOG_TYPE, "upsert"]]);
    }
    const f = ids.fogged as string;
    await expectDarkness({ p1: [ids.nook], p2: [ids.nook] }, { p1: [f], p2: [f] });
  });

  test("FR-FOG-44 a cell of player-1's explored memory in the box → the shape reaches player-1 only", async () => {
    // Cell (18, 11).
    const shape = [[[18, 11, 19, 11, 19, 12, 18, 12]]];
    db.insert(fogExplored)
      .values({
        sceneId: ambushId,
        playerId: playerIds["Player 1"] as string,
        campaignId,
        shape,
        updatedAt: AT,
      })
      .run();
    const at = mark();
    // Moved one cell east: its box now holds the centre (18.5, 11.5).
    await send(F.moveDarkness, { darknessId: ids.fogged, dx: 1, dy: 0 });
    await until(() => events(p2, at[1], "DarknessMoved").length === 1);
    expect(events(p2, at[1], "DarknessMoved")[0]?.changes).toEqual([]);
    await expectDarkness(
      { p1: [ids.fogged as string, ids.nook as string], p2: [ids.nook as string] },
      { p2: [ids.fogged as string] },
    );
    // Player 1's own memory row reached them with the resync snapshot; never player 2.
    const memoryId = `${ambushId}:${playerIds["Player 1"]}`;
    expect(Object.keys(p1.store.records[FOG_EXPLORED_TYPE] ?? {})).toEqual([memoryId]);
    expect(p2.raw()).not.toContain(memoryId);
  });

  test("FR-FOG-31 Forget explored → the memory-only shape leaves player-1 (fog upsert); player-2 gets the cause only", async () => {
    const m = mark();
    await send(F.forgetExplored, {});
    await until(() => events(p2, m[1], "ExploredForgotten").length === 1);
    expect(events(p2, m[1], "ExploredForgotten")[0]?.changes).toEqual([]);
    await expectDarkness(
      { p1: [ids.nook as string], p2: [ids.nook as string] },
      { p2: [ids.fogged as string] },
    );
  });

  test("FR-FOG-34 darkness over the revealed Cave Ogre → it leaves both players; Undo → back (one undo stack, FR-FOG-07)", async () => {
    ids.ogre = await place({ circle: [10, 11, 1.5] });
    await expectDarkness(
      { p1: [ids.nook as string, ids.ogre], p2: [ids.nook as string, ids.ogre] },
      { p2: [ids.fogged as string] },
      ["Mira", "Thorn"],
    );
    await undo();
    await expectDarkness(
      { p1: [ids.nook as string], p2: [ids.nook as string] },
      { p2: [ids.fogged as string] },
      party,
    );
  });

  test("FR-FOG-01 an Explored shape over the Cave Ogre hides it (map shown, records hidden); Reveal all keeps darkness", async () => {
    await send(F.edit, { op: "explored", shape: { rect: [8.5, 9.5, 11.5, 12.5] } });
    await expectDarkness(
      { p1: [ids.nook as string], p2: [ids.nook as string] },
      { p2: [ids.fogged as string] },
      ["Mira", "Thorn"],
    );
    await send(F.setAll, { fogged: false });
    // Everything clear: both darkness shapes now meet clear cells → both players.
    await expectDarkness(
      {
        p1: [ids.fogged as string, ids.nook as string],
        p2: [ids.fogged as string, ids.nook as string],
      },
      {},
    );
    // Owned tokens and non-hidden monsters; Goblin 2 etc. now revealed.
    expect(names(p1)).toContain("Goblin");
    await send(F.clearDarkness, {});
    await expectDarkness({ p1: [], p2: [] }, {});
  });
});
