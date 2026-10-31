// FR-MAP-121 / -122 over real sockets on bundle `spell-fx` (DM, `player-1`, `player-2`): the DM's
// `map.teleportToken` moves any token; `vfx.poof` reaches each connection only for the ends where
// it receives the token (hidden, party vision on this bundle), and a plain move never smokes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { MAP_INTENTS as I, type SceneRecord, type TokenRecord } from "@shared/scenes-map/schemas";
import { type PoofCue, VFX_POOF_SIGNAL } from "@shared/spell-fx/cue";
import { closeDb, type Db } from "../../db/client";
import { player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let links: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("spell-fx", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  links = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const P = (name: string): Credential => ({ role: "player", token: links[name] as string });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function ok(c: TestClient, name: string, payload: unknown) {
  const f = await reply(c, name, payload);
  if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f.result;
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const cuesOf = (c: TestClient) =>
  c.frames
    .filter((f): f is Extract<ServerFrame, { type: "signal" }> => f.type === "signal")
    .filter((f) => f.name === VFX_POOF_SIGNAL)
    .map((f) => f.data as PoofCue);

async function table() {
  const dm = await h.live(DM);
  const p1 = await h.live(P("Player 1"));
  const p2 = await h.live(P("Player 2"));
  const token = (name: string) =>
    (Object.values(dm.store.records.token ?? {}) as TokenRecord[]).find(
      (x) => x.name === name,
    ) as TokenRecord;
  /** What each of DM, player-1 and player-2 receive while `act` runs. */
  const during = async (act: () => Promise<unknown>) => {
    const clients = [dm, p1, p2];
    const from = clients.map((c) => cuesOf(c).length);
    await act();
    for (const c of clients) await barrier(c);
    return clients.map((c, i) => cuesOf(c).slice(from[i]));
  };
  const close = () => {
    for (const c of [dm, p1, p2]) c.close();
  };
  return { dm, p1, p2, token, during, close };
}

describe("map.teleportToken (FR-MAP-121)", () => {
  test("FR-MAP-121 the DM teleports a token; everyone gets its new cell", async () => {
    const t = await table();
    const m = t.token("Mira");
    const to = { col: m.col + 3, row: m.row + 1 };
    await ok(t.dm, I.teleportToken, { tokenId: m.id, ...to });
    await barrier(t.dm);
    await barrier(t.p1);
    expect(t.token("Mira")).toMatchObject(to);
    expect(t.p1.store.records.token?.[m.id]).toMatchObject(to);
    t.close();
  });

  test("FR-MAP-121 refused: a player, the token's own cell, off the map", async () => {
    const t = await table();
    const g = t.token("Goblin Sneak");
    const m = t.token("Mira");
    const asPlayer = await reply(t.p1, I.teleportToken, { tokenId: m.id, col: 1, row: 1 });
    expect(asPlayer.type).toBe("reject");
    const same = await reply(t.dm, I.teleportToken, { tokenId: g.id, col: g.col, row: g.row });
    expect(same.type).toBe("reject");
    if (same.type === "reject") expect(same.code).toBe("invalid");
    const off = await reply(t.dm, I.teleportToken, { tokenId: g.id, col: 900, row: 1 });
    expect(off.type).toBe("reject");
    if (off.type === "reject") expect(off.code).toBe("invalid");
    t.close();
  });
});

describe("a teleport in combat (FR-MAP-123)", () => {
  test("FR-MAP-123 adds no walked distance; a plain move still does", async () => {
    const t = await table();
    const m = t.token("Mira");
    const moved = () =>
      (Object.values(t.dm.store.records.combatant ?? {}) as CombatantRecord[]).find(
        (c) => c.tokenId === m.id && c.active,
      )?.movedFt as number;
    const start = moved();
    await ok(t.dm, I.teleportToken, { tokenId: m.id, col: m.col + 3, row: m.row });
    await barrier(t.dm);
    expect(moved()).toBe(start);
    await ok(t.dm, I.moveToken, { tokenId: m.id, col: m.col + 4, row: m.row });
    await barrier(t.dm);
    expect(moved()).toBe(start + 5);
    t.close();
  });
});

describe("vfx.poof routing (FR-MAP-122)", () => {
  test("FR-MAP-122 a party token: smoke at both ends for everyone, in one cue", async () => {
    const t = await table();
    const m = t.token("Mira");
    const to = { col: m.col + 1, row: m.row };
    const cues = await t.during(() => ok(t.dm, I.teleportToken, { tokenId: m.id, ...to }));
    for (const got of cues) {
      expect(got).toHaveLength(1);
      expect(got[0]?.sceneId).toBe(m.sceneId);
      expect(got[0]?.side).toBe(1);
      expect(got[0]?.cells).toEqual([{ col: m.col, row: m.row }, to]);
    }
    t.close();
  });

  test("FR-MAP-122 a plain move never smokes", async () => {
    const t = await table();
    const m = t.token("Mira");
    const cues = await t.during(() =>
      ok(t.dm, I.moveToken, { tokenId: m.id, col: m.col + 1, row: m.row }),
    );
    expect(cues.flat()).toEqual([]);
    t.close();
  });

  test("FR-MAP-122 a hidden token: smoke for the DM, nothing at all for players", async () => {
    const t = await table();
    const g = t.token("Goblin Sneak");
    await ok(t.dm, I.setTokenHidden, { tokenId: g.id, hidden: true });
    const [dm, p1, p2] = await t.during(() =>
      ok(t.dm, I.teleportToken, { tokenId: g.id, col: g.col + 1, row: g.row + 1 }),
    );
    expect(dm?.[0]?.cells).toHaveLength(2);
    expect(p1).toEqual([]);
    expect(p2).toEqual([]);
    await ok(t.dm, I.setTokenHidden, { tokenId: g.id, hidden: false });
    t.close();
  });

  test("FR-MAP-122 a player gets smoke exactly at the ends where they receive the token", async () => {
    const t = await table();
    const g = t.token("Goblin Sneak");
    const seenBy = (c: TestClient) => c.store.records.token?.[g.id] !== undefined;
    const shapes = new Set<string>();
    const scene = t.dm.store.records.scene?.[g.sceneId] as SceneRecord;
    const last = {
      col: Math.floor(scene.mapWidth / scene.gridCellSize) - 1,
      row: Math.floor(scene.mapHeight / scene.gridCellSize) - 1,
    };
    // Each corner and back beside the party: in and out of sight.
    const home = [t.token("Mira").col + 1, t.token("Mira").row] as const;
    const route = [
      home,
      [0, 0],
      home,
      [last.col, 0],
      [0, last.row],
      home,
      [last.col, last.row],
      home,
    ] as const;
    for (const [col, row] of route) {
      const now = t.token("Goblin Sneak");
      const from = { col: now.col, row: now.row };
      if (from.col === col && from.row === row) continue;
      const before = [t.p1, t.p2].map(seenBy);
      const [dm, ...players] = await t.during(() =>
        ok(t.dm, I.teleportToken, { tokenId: g.id, col, row }),
      );
      expect(dm?.[0]?.cells).toEqual([from, { col, row }]);
      [t.p1, t.p2].forEach((c, i) => {
        const want = [...(before[i] ? [from] : []), ...(seenBy(c) ? [{ col, row }] : [])];
        const got = players[i] ?? [];
        expect(got.flatMap((q) => q.cells)).toEqual(want);
        if (want.length === 0) expect(got).toEqual([]);
        shapes.add(`${before[i]}-${seenBy(c)}`);
      });
    }
    // The route must exercise one-ended cues both ways and a player seeing nothing at all.
    expect([...shapes]).toEqual(
      expect.arrayContaining(["false-false", "false-true", "true-false"]),
    );
    t.close();
  });

  test("FR-MAP-122 never replayed: a client connecting later gets no cue", async () => {
    const t = await table();
    const m = t.token("Mira");
    await ok(t.dm, I.teleportToken, { tokenId: m.id, col: m.col + 1, row: m.row });
    const late = await h.live(P("Player 1"));
    await barrier(late);
    expect(cuesOf(late)).toEqual([]);
    late.close();
    t.close();
  });
});
