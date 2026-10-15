// FOG §13 integration over real sockets on the `fog` bundle: snapshots per viewer, activation,
// `fogged` only on a player's own tokens, players refused; restart → identical snapshots and undo
// still works. The step-by-step leak walkthrough is in leak.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  FOG_INTENTS as F,
  FOG_TYPE,
  type FogRecord,
  type PlayerFogRecord,
} from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player, scene, token } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

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
const fogOf = (c: TestClient, id: string) =>
  c.store.records[FOG_TYPE]?.[id] as FogRecord | PlayerFogRecord | undefined;
const tokenIds = (c: TestClient) => Object.keys(c.store.records[TOKEN_TYPE] ?? {}).sort();
const tokenOf = (c: TestClient, id: string) =>
  c.store.records[TOKEN_TYPE]?.[id] as TokenRecord | undefined;

describe("fog bundle over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ambushId: string;
  let townId: string;
  let tok: Record<string, { id: string; fogged: boolean; hidden: boolean }>;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("fog", { dmSecret: TEST_SECRET, testMode: true });
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
    tok = Object.fromEntries(
      db
        .select()
        .from(token)
        .all()
        .filter((t) => t.sceneId === ambushId)
        .map((t) => [t.name, { id: t.id, fogged: t.fogged, hidden: t.hidden }]),
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

  test("FOG §13 fixtures: fogged copies and undo depth as fog-ambush-partial says", () => {
    const fogged = Object.entries(tok)
      .filter(([, t]) => t.fogged)
      .map(([n]) => n)
      .sort();
    expect(fogged).toEqual(
      ["Elite Goblin Warrior", "Goblin", "Goblin 2", "Goblin Lurker", "Wolf"].sort(),
    );
    expect(tok.Mira?.fogged).toBe(false);
    expect(tok.Thorn?.fogged).toBe(false);
    expect(tok["Cave Ogre"]?.fogged).toBe(false);
  });

  test("FR-FOG-09 / -12 snapshot: DM every scene's fog with undo; players the active scene's only, redacted", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const fog = fogOf(dm, ambushId) as FogRecord;
    expect(fog).toMatchObject({ fill: "fog", box: [0, 0, 20, 14], undo: { n: 4 } });
    expect(fog.undo?.kind).toBe("reveal-polygon");
    // FR-FOG-25 ripple: Town was revealed after create (one "reveal all" entry).
    expect(fogOf(dm, townId)).toMatchObject({ fill: "clear", runs: "", undo: { n: 1 } });
    expect(p1.store.records[FOG_TYPE] ?? {}).toEqual({
      [townId]: { id: townId, fill: "clear", box: (fogOf(dm, townId) as FogRecord).box, runs: "" },
    });
    // Player refused on every fog intent.
    for (const [name, payload] of [
      [F.setAll, { sceneId: ambushId, fogged: false }],
      [
        F.edit,
        { sceneId: ambushId, op: "reveal", shape: { kind: "rect", c0: 0, r0: 0, c1: 1, r1: 1 } },
      ],
      [F.undo, { sceneId: ambushId, expectedEditId: fog.undo?.editId }],
    ] as const) {
      expect(await answer(p1, p1.intent(name, payload))).toMatchObject({
        type: "reject",
        code: "forbidden",
      });
    }
    dm.close();
    p1.close();
  });

  test("FR-FOG-12 activation: players' resync snapshot = the scene's fog row + only records not fog-hidden; DM all", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect((await answer(dm, dm.intent(I.activateScene, { sceneId: ambushId }))).type).toBe("ack");
    for (const c of [p1, p2]) {
      await until(() => fogOf(c, ambushId) !== undefined);
      expect(tokenIds(c)).toEqual(
        ["Mira", "Thorn", "Cave Ogre"].map((n) => tok[n]?.id as string).sort(),
      );
      expect(fogOf(c, ambushId)).toEqual({
        id: ambushId,
        fill: "fog",
        box: [0, 0, 20, 14],
        runs: (fogOf(dm, ambushId) as FogRecord).runs,
      });
      const raw = c.raw();
      expect(raw).not.toContain("Goblin Lurker");
      for (const n of ["Goblin", "Goblin 2", "Goblin Lurker", "Wolf", "Elite Goblin Warrior"]) {
        expect(raw).not.toContain(tok[n]?.id as string);
      }
      expect(leakScan(h.s, c)).toEqual([]);
    }
    // A DM snapshot holds every token of the active scene (ADR-0041), fogged copies on the wire.
    const fresh = await h.live(DM);
    const ids = Object.keys(fresh.store.records[TOKEN_TYPE] ?? {});
    expect(ids.filter((id) => tokenOf(fresh, id)?.sceneId === ambushId).sort()).toEqual(
      Object.values(tok)
        .map((t) => t.id)
        .sort(),
    );
    expect(tokenOf(fresh, tok["Goblin Lurker"]?.id as string)?.fogged).toBe(true);
    for (const c of [dm, fresh, p1, p2]) c.close();
  });

  test("FOG §9 leak: players get `fogged` only on their own tokens (snapshot + every frame); the DM on all", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = tok.Mira?.id as string; // Player 1's
    const ownerOf = new Map(
      db
        .select({ id: token.id, owner: token.ownerPlayerId })
        .from(token)
        .all()
        .map((t) => [t.id, t.owner]),
    );
    const playerId = Object.fromEntries(
      db
        .select({ id: player.id, name: player.name })
        .from(player)
        .all()
        .map((r) => [r.name, r.id]),
    );
    /** Every token row id a client received carrying `fogged` (snapshot or event). */
    const foggedIds = (c: TestClient) => {
      const ids = new Set<string>();
      for (const f of c.frames) {
        if (f.type === "snapshot") {
          for (const r of (f.records[TOKEN_TYPE] ?? []) as TokenRecord[]) {
            if ("fogged" in r) ids.add(r.id);
          }
        }
        if (f.type === "event") {
          for (const ch of f.changes) {
            const data = (ch as { data?: object }).data;
            if (ch.type === TOKEN_TYPE && data && "fogged" in data) ids.add(ch.id);
          }
        }
      }
      return [...ids];
    };
    // Cover Mira (2, 7): her owner sees `fogged: true`; Player 2 sees her without it.
    const ack = await answer(
      dm,
      dm.intent(F.edit, {
        sceneId: ambushId,
        op: "hide",
        shape: { kind: "rect", c0: 2, r0: 7, c1: 2, r1: 7 },
      }),
    );
    const editId = (ack as { result: { editId: string } }).result.editId;
    await until(() => tokenOf(p1, mira)?.fogged === true);
    await until(() => p2.frames.some((f) => f.type === "event" && f.cause.name === "FogEdited"));
    expect(tokenOf(p2, mira)).toBeDefined();
    expect(tokenOf(p2, mira)).not.toHaveProperty("fogged");
    // The DM wire keeps every copy: the ownerless fogged tokens and Mira.
    expect(tokenOf(dm, mira)?.fogged).toBe(true);
    expect(tokenOf(dm, tok.Goblin?.id as string)?.fogged).toBe(true);
    // Fresh snapshots too, then undo back to the bundle's state.
    const f1 = await h.live(p("Player 1"));
    const f2 = await h.live(p("Player 2"));
    for (const [c, name] of [
      [p1, "Player 1"],
      [p2, "Player 2"],
      [f1, "Player 1"],
      [f2, "Player 2"],
    ] as const) {
      for (const id of foggedIds(c)) expect(ownerOf.get(id)).toBe(playerId[name]);
    }
    expect(foggedIds(p1)).toContain(mira);
    expect(foggedIds(f1)).toContain(mira);
    expect(foggedIds(p2)).toEqual([]);
    expect(
      (await answer(dm, dm.intent(F.undo, { sceneId: ambushId, expectedEditId: editId }))).type,
    ).toBe("ack");
    await until(
      () => tokenOf(p1, mira) !== undefined && !("fogged" in (tokenOf(p1, mira) as object)),
    );
    for (const c of [dm, p1, p2, f1, f2]) c.close();
  });

  test("FOG §11 restart → identical snapshots; fog, undo depth survive; undo still works", async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const c = await h.live(cred);
        out[k] = { fog: c.store.records[FOG_TYPE], tokens: c.store.records[TOKEN_TYPE] };
        c.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
    const dm = await h.live(DM);
    const fog = fogOf(dm, ambushId) as FogRecord;
    expect(fog.undo?.n).toBe(4);
    const ack = await answer(
      dm,
      dm.intent(F.undo, { sceneId: ambushId, expectedEditId: fog.undo?.editId }),
    );
    expect(ack.type).toBe("ack");
    await until(() => (fogOf(dm, ambushId) as FogRecord).undo?.kind === "reveal-rect");
    // The polygon is fogged again: the Cave Ogre's footprint is wholly fogged now.
    await until(() => tokenOf(dm, tok["Cave Ogre"]?.id as string)?.fogged === true);
    dm.close();
  });
});
