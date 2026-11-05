// Token mirrors over a real socket (MIR §13): who gets what per mode (each shown mode foggable, #442), following the source token,
// and everything a mirror must never do. Bundle `token-mirrors`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import type { Credential } from "@shared/protocol/frames";
import { MAP_INTENTS as I, type TokenRecord } from "@shared/scenes-map/schemas";
import {
  MIR_INTENTS as M,
  MIRRORS_PER_SCENE_MAX,
  type MirrorMode,
  type PlayerTokenMirrorRecord,
  TOKEN_MIRROR_TYPE,
  type TokenMirrorRecord,
} from "@shared/token-mirrors/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db } from "../../db/client";
import { player, token, tokenMirror } from "../../db/schema";
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
  const loaded = await loadBundle("token-mirrors", { testMode: true, dmSecret: TEST_SECRET });
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
async function ok<T = unknown>(c: TestClient, name: string, payload: unknown) {
  const f = await reply(c, name, payload);
  if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f.result as T;
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};

async function table() {
  const dm = await h.live(DM);
  const p1 = await h.live(P("Player 1"));
  const p2 = await h.live(P("Player 2"));
  const token = (name: string) =>
    (Object.values(dm.store.records.token ?? {}) as TokenRecord[]).find(
      (x) => x.name === name,
    ) as TokenRecord;
  const settle = async () => {
    for (const c of [dm, p1, p2]) await barrier(c);
  };
  const mirror = (c: TestClient, id: string) =>
    c.store.records[TOKEN_MIRROR_TYPE]?.[id] as
      | (PlayerTokenMirrorRecord & Partial<TokenMirrorRecord>)
      | undefined;
  /** A fresh mirror of `tokenName`; the caller's `close` removes nothing, each test uses its own. */
  const create = async (tokenName: string, col: number, row: number, mode?: MirrorMode) => {
    const { mirrorId } = await ok<{ mirrorId: string }>(dm, M.create, {
      tokenId: token(tokenName).id,
      col,
      row,
      ...(mode ? { mode } : {}),
    });
    await settle();
    return mirrorId;
  };
  const close = () => {
    for (const c of [dm, p1, p2]) c.close();
  };
  return { dm, p1, p2, token, settle, mirror, create, close };
}

describe("creating and owning a mirror", () => {
  test("FR-MIR-01 the DM mirrors a token on its own map; players are refused", async () => {
    const t = await table();
    const g = t.token("Goblin");
    const id = await t.create("Goblin", 1, 1);
    expect(t.mirror(t.dm, id)).toMatchObject({
      col: 1,
      row: 1,
      mode: "visible",
      tokenId: g.id,
      name: "Goblin",
      suppressed: false,
    });
    for (const name of [M.create, M.move, M.setMode, M.delete]) {
      const f = await reply(t.p1, name, {
        ...(name === M.create ? { tokenId: g.id, col: 1, row: 1 } : { mirrorId: id }),
        ...(name === M.move ? { col: 1, row: 2 } : {}),
        ...(name === M.setMode ? { mode: "shadow" } : {}),
      });
      expect(f.type).toBe("reject");
    }
    t.close();
  });

  test("FR-MIR-02 as many mirrors of one token as the DM wants", async () => {
    const t = await table();
    const a = await t.create("Goblin", 2, 1);
    const b = await t.create("Goblin", 3, 1);
    expect(a).not.toBe(b);
    expect(t.mirror(t.dm, a)).toBeDefined();
    expect(t.mirror(t.dm, b)).toBeDefined();
    t.close();
  });

  test("FR-MIR-03 off the map is refused, and a mirror adds no token", async () => {
    const t = await table();
    const before = Object.keys(t.dm.store.records.token ?? {}).length;
    const f = await reply(t.dm, M.create, { tokenId: t.token("Goblin").id, col: 900, row: 1 });
    expect(f.type).toBe("reject");
    await t.create("Goblin", 4, 1);
    expect(Object.keys(t.dm.store.records.token ?? {}).length).toBe(before);
    t.close();
  });
});

describe("display modes (FR-MIR-06)", () => {
  test("FR-MIR-06 Hidden reaches no player; the DM still has it", async () => {
    const t = await table();
    const id = await t.create("Goblin", 5, 1, "hidden");
    expect(t.mirror(t.dm, id)?.mode).toBe("hidden");
    expect(t.mirror(t.p1, id)).toBeUndefined();
    expect(t.mirror(t.p2, id)).toBeUndefined();
    t.close();
  });

  test("FR-MIR-06 Transparent and Shadow are foggable too (#442): only players with sight get them", async () => {
    const t = await table();
    // Far from every PC and behind the map's walls: `fogged` says no player has sight there.
    const far = await t.create("Goblin", 18, 1, "transparent");
    // Both players' sight (columns 0-7, rows 2-12 of Goblin Ambush).
    const near = await t.create("Goblin", 3, 3, "transparent");
    expect(t.mirror(t.dm, far)?.fogged).toBe(true);
    for (const mode of ["transparent", "shadow"] as const) {
      await ok(t.dm, M.setMode, { mirrorId: far, mode });
      await ok(t.dm, M.setMode, { mirrorId: near, mode });
      await t.settle();
      for (const p of [t.p1, t.p2]) {
        expect(t.mirror(p, far)).toBeUndefined();
        expect(t.mirror(p, near)?.mode).toBe(mode);
      }
    }
    t.close();
  });

  test("FR-MIR-06 Visible follows sight, per player, like a token", async () => {
    const t = await table();
    const mira = t.token("Mira");
    const near = await t.create("Goblin", mira.col + 1, mira.row, "visible");
    const far = await t.create("Goblin", 18, 2, "visible");
    expect(t.mirror(t.p1, near)?.mode).toBe("visible");
    expect(t.mirror(t.dm, far)?.fogged).toBe(true);
    expect(t.mirror(t.p1, far)).toBeUndefined();
    expect(t.mirror(t.p2, far)).toBeUndefined();
    // Same cell, Transparent: still out of sight (#442).
    await ok(t.dm, M.setMode, { mirrorId: far, mode: "transparent" });
    await t.settle();
    expect(t.mirror(t.p1, far)).toBeUndefined();
    await ok(t.dm, M.setMode, { mirrorId: far, mode: "visible" });
    await t.settle();
    expect(t.mirror(t.p1, far)).toBeUndefined();
    // Mira walks next to it: her player sees it, then doesn't once she is back.
    await ok(t.dm, I.moveToken, { tokenId: mira.id, col: 17, row: 2 });
    await t.settle();
    expect(t.mirror(t.p1, far)?.mode).toBe("visible");
    await ok(t.dm, I.moveToken, { tokenId: mira.id, col: mira.col, row: mira.row });
    await t.settle();
    expect(t.mirror(t.p1, far)).toBeUndefined();
    t.close();
  });

  test("FR-MIR-07 a player's copy never names its token; a shadow has no name or art", async () => {
    const t = await table();
    const id = await t.create("Goblin", 3, 3, "transparent");
    const clear = t.mirror(t.p1, id) as Record<string, unknown>;
    expect(clear.name).toBe("Goblin");
    for (const k of ["tokenId", "seenBy", "fogged", "suppressed", "campaignId", "seq"]) {
      expect(k in clear).toBe(false);
    }
    await ok(t.dm, M.setMode, { mirrorId: id, mode: "shadow" });
    await t.settle();
    const dark = t.mirror(t.p1, id) as Record<string, unknown>;
    expect(dark.mode).toBe("shadow");
    for (const k of ["name", "imageAssetId", "creatureType", "tokenId"]) {
      expect(k in dark).toBe(false);
    }
    expect("seenBy" in (t.mirror(t.dm, id) as object)).toBe(false);
    // A fresh snapshot says the same.
    const fresh = await h.live(P("Player 1"));
    expect(fresh.store.records[TOKEN_MIRROR_TYPE]?.[id]).toEqual(dark);
    fresh.close();
    t.close();
  });
});

describe("following the token", () => {
  test("FR-MIR-08 a move steps every mirror by the same amount; a rename follows", async () => {
    const t = await table();
    const g = t.token("Goblin Sneak 2");
    const a = await t.create("Goblin Sneak 2", 3, 5, "transparent");
    const b = await t.create("Goblin Sneak 2", 4, 6, "transparent");
    await ok(t.dm, I.moveToken, { tokenId: g.id, col: g.col + 2, row: g.row - 1 });
    await t.settle();
    expect(t.mirror(t.p1, a)).toMatchObject({ col: 5, row: 4 });
    expect(t.mirror(t.dm, b)).toMatchObject({ col: 6, row: 5 });
    await ok(t.dm, I.updateToken, { tokenId: g.id, name: "Lookout" });
    await t.settle();
    expect(t.mirror(t.p1, a)?.name).toBe("Lookout");
    t.close();
  });

  test("FR-MIR-09 a hidden or Invisible token's mirrors stop showing, and come back", async () => {
    const t = await table();
    const g = t.token("Crypt Ogre");
    const id = await t.create("Crypt Ogre", 3, 4, "transparent");
    expect(t.mirror(t.p1, id)).toBeDefined();
    await ok(t.dm, I.setTokenHidden, { tokenId: g.id, hidden: true });
    await t.settle();
    expect(t.mirror(t.p1, id)).toBeUndefined();
    expect(t.mirror(t.dm, id)?.suppressed).toBe(true);
    expect(t.mirror(t.dm, id)?.mode).toBe("transparent");
    await ok(t.dm, I.setTokenHidden, { tokenId: g.id, hidden: false });
    await t.settle();
    expect(t.mirror(t.p1, id)?.mode).toBe("transparent");
    await ok(t.dm, FOG_INTENTS.setInvisible, { tokenId: g.id, invisible: true });
    await t.settle();
    expect(t.mirror(t.p1, id)).toBeUndefined();
    await ok(t.dm, FOG_INTENTS.setInvisible, { tokenId: g.id, invisible: false });
    await t.settle();
    expect(t.mirror(t.p1, id)).toBeDefined();
    t.close();
  });

  test("FR-MIR-09 a step that takes a mirror off the map hides it; a step back shows it", async () => {
    const t = await table();
    const g = t.token("Crypt Ogre");
    // A mirror on the first column (in sight) leaves the map with a step left.
    const id = await t.create("Crypt Ogre", 0, 6, "transparent");
    expect(t.mirror(t.p1, id)).toBeDefined();
    await ok(t.dm, I.moveToken, { tokenId: g.id, col: g.col - 3, row: g.row });
    await t.settle();
    expect(t.mirror(t.dm, id)?.suppressed).toBe(true);
    expect(t.mirror(t.p1, id)).toBeUndefined();
    await ok(t.dm, I.moveToken, { tokenId: g.id, col: g.col, row: g.row });
    await t.settle();
    expect(t.mirror(t.dm, id)).toMatchObject({ col: 0, suppressed: false });
    expect(t.mirror(t.p1, id)).toBeDefined();
    t.close();
  });

  test("FR-MIR-10 a teleport sets the mirrors to Hidden and leaves them where they are", async () => {
    const t = await table();
    const g = t.token("Goblin Sneak");
    const id = await t.create("Goblin Sneak", 6, 5, "transparent");
    expect(t.mirror(t.p1, id)).toBeDefined();
    await ok(t.dm, I.teleportToken, { tokenId: g.id, col: g.col + 4, row: g.row });
    await t.settle();
    expect(t.mirror(t.dm, id)).toMatchObject({ col: 6, row: 5, mode: "hidden" });
    expect(t.mirror(t.p1, id)).toBeUndefined();
    t.close();
  });

  test("FR-MIR-11 a deleted token takes its mirrors with it", async () => {
    const t = await table();
    const { tokenId } = await ok<{ tokenId: string }>(t.dm, I.duplicateToken, {
      tokenId: t.token("Goblin").id,
    });
    await t.settle();
    const { mirrorId } = await ok<{ mirrorId: string }>(t.dm, M.create, {
      tokenId,
      col: 5,
      row: 5,
      mode: "transparent",
    });
    await t.settle();
    expect(t.mirror(t.p1, mirrorId)).toBeDefined();
    await ok(t.dm, I.deleteToken, { tokenId });
    await t.settle();
    expect(t.mirror(t.dm, mirrorId)).toBeUndefined();
    expect(t.mirror(t.p1, mirrorId)).toBeUndefined();
    t.close();
  });
});

describe("the DM's hands", () => {
  test("FR-MIR-12 dragging a mirror sets a new distance to its token", async () => {
    const t = await table();
    const g = t.token("Goblin");
    const id = await t.create("Goblin", 1, 4, "transparent");
    await ok(t.dm, M.move, { mirrorId: id, col: 3, row: 4 });
    await t.settle();
    expect(t.mirror(t.p1, id)).toMatchObject({ col: 3, row: 4 });
    await ok(t.dm, I.moveToken, { tokenId: g.id, col: g.col + 1, row: g.row });
    await t.settle();
    expect(t.mirror(t.p1, id)).toMatchObject({ col: 4, row: 4 });
    const off = await reply(t.dm, M.move, { mirrorId: id, col: 900, row: 4 });
    expect(off.type).toBe("reject");
    t.close();
  });

  test("FR-MIR-13 Delete removes one mirror, the token stays", async () => {
    const t = await table();
    const g = t.token("Goblin");
    const id = await t.create("Goblin", 11, 5, "transparent");
    await ok(t.dm, M.delete, { mirrorId: id });
    await t.settle();
    expect(t.mirror(t.dm, id)).toBeUndefined();
    expect(t.mirror(t.p1, id)).toBeUndefined();
    expect(t.token("Goblin").id).toBe(g.id);
    const again = await reply(t.dm, M.delete, { mirrorId: id });
    expect(again.type).toBe("reject");
    t.close();
  });

  test("FR-MIR-04 a mirror does nothing: no vision, no combat, a player can't move it", async () => {
    const t = await table();
    const mira = t.token("Mira");
    const id = await t.create("Mira", 17, 12, "visible");
    // Mira's mirror is no source: the far corner stays out of her player's sight.
    expect(t.mirror(t.dm, id)?.fogged).toBe(true);
    expect(t.mirror(t.p1, id)).toBeUndefined();
    const f = await reply(t.p1, I.moveToken, { tokenId: id, col: 1, row: 1 });
    expect(f.type).toBe("reject");
    expect(t.token("Mira").id).toBe(mira.id);
    t.close();
  });

  test("FR-MIR-14 a scene copy keeps its mirrors, on the copied tokens; deleting it takes them", async () => {
    const t = await table();
    const source = t.token("Goblin");
    const id = await t.create("Goblin", 13, 5, "shadow");
    const api = (method: string, path: string) =>
      fetch(`${h.http}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
    const dup = await api("POST", `/scenes/${source.sceneId}/duplicate`);
    expect(dup.status).toBe(201);
    const copy = ((await dup.json()) as { scene: { id: string } }).scene;
    const rows = db.select().from(tokenMirror).where(eq(tokenMirror.sceneId, copy.id)).all();
    const mine = rows.find((r) => r.col === 13 && r.row === 5);
    expect(mine).toMatchObject({ mode: "shadow", name: "Goblin" });
    expect(mine?.id).not.toBe(id);
    expect(mine?.tokenId).not.toBe(source.id);
    const copied = db
      .select()
      .from(token)
      .where(eq(token.id, mine?.tokenId as string))
      .get();
    expect(copied?.sceneId).toBe(copy.id);
    expect((await api("DELETE", `/scenes/${copy.id}`)).status).toBe(204);
    expect(db.select().from(tokenMirror).where(eq(tokenMirror.sceneId, copy.id)).all()).toEqual([]);
    t.close();
  });

  test("FR-MIR-05 a scene holds at most 200 mirrors", async () => {
    const t = await table();
    const g = t.token("Goblin");
    const held = db
      .select()
      .from(tokenMirror)
      .where(eq(tokenMirror.sceneId, g.sceneId))
      .all().length;
    for (let i = held; i < MIRRORS_PER_SCENE_MAX; i++) {
      await ok(t.dm, M.create, { tokenId: g.id, col: i % 20, row: i % 14, mode: "hidden" });
    }
    const f = await reply(t.dm, M.create, { tokenId: g.id, col: 1, row: 1 });
    expect(f.type).toBe("reject");
    t.close();
  });
});
