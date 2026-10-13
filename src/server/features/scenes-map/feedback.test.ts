// Feedback pass (MAP §13 "Integration (feedback)"): token shape and speed copies (FR-MAP-35/36)
// and token-changed hooks on moves (FR-MAP-38, ADR-0031).
import { describe, expect, test } from "bun:test";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { createEntity, UPDATE } from "../entities/commands";
import { captureLogger, wolfBlock } from "../entities/testing";
import { MAP_REST as R } from "./commands";
import { scenesSetup } from "./testing";
import { tokenHooksOf } from "./token-hooks";

function setup() {
  const t = scenesSetup(captureLogger().log);
  const newScene = (name = "Goblin Ambush") =>
    t.run<SceneRecord>(R.createScene, { name, mapAssetId: "map-battle" });
  const tokenRow = (id: string) =>
    t.s.db.select().from(token).where(eq(token.id, id)).get() as TokenRecord;
  const place = (sceneId: string, definitionId: string, col: number, row: number, extra = {}) =>
    tokenRow(
      t.run<{ tokenId: string }>(I.placeToken, { sceneId, definitionId, col, row, ...extra })
        .tokenId,
    );
  /** Cave Ogre (MAP §13 `scenes-extras`): large, speed 40, `tokenShape` none. */
  const caveOgre = () => {
    const ogre = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Cave Ogre",
      statBlock: { ...wolfBlock, size: "large", speed: 40 },
      tokenShape: "none",
    });
    return ogre.id;
  };
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, newScene, tokenRow, place, caveOgre, lastEvent };
}

describe("scenes-map feedback: shape + speed copies", () => {
  test("FR-MAP-35 / -36 place copies the definition's tokenShape and speed (Cave Ogre none, Goblin round)", () => {
    const t = setup();
    const s = t.newScene();
    const ogre = t.place(s.id, t.caveOgre(), 9, 10);
    expect(ogre).toMatchObject({ shape: "none", speed: 40, size: "large" });
    const goblin = t.place(s.id, t.h.goblinId, 1, 1);
    expect(goblin).toMatchObject({ shape: "round", speed: 30 });
    const { speed: _speed, ...noSpeed } = wolfBlock;
    const unknown = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Shade",
      statBlock: noSpeed,
    });
    expect(t.place(s.id, unknown.id, 4, 4)).toMatchObject({ shape: "round", speed: null });
    // Fixture override; never `speed` or `size`.
    expect(t.place(s.id, t.h.goblinId, 2, 2, { shape: "square" }).shape).toBe("square");
    expect(
      t.err(() =>
        t.run(I.placeToken, {
          sceneId: s.id,
          definitionId: t.h.goblinId,
          col: 3,
          row: 3,
          speed: 5,
        }),
      ).code,
    ).toBe("invalid");
    expect(
      t.err(() =>
        t.run(I.placeToken, {
          sceneId: s.id,
          definitionId: t.h.goblinId,
          col: 3,
          row: 3,
          shape: "hex",
        }),
      ).code,
    ).toBe("invalid");
  });

  test("FR-MAP-36 / -20 definition edit refreshes speed, never shape", () => {
    const t = setup();
    const s = t.newScene();
    const ogreId = t.caveOgre();
    const a = t.place(s.id, ogreId, 9, 10);
    const b = t.place(s.id, ogreId, 5, 10, { shape: "square" });
    t.run(UPDATE, {
      id: ogreId,
      name: "Cave Ogre",
      statBlock: { ...wolfBlock, size: "large", speed: 30 },
      tokenShape: "round",
    });
    expect(t.tokenRow(a.id)).toMatchObject({ speed: 30, shape: "none" });
    expect(t.tokenRow(b.id)).toMatchObject({ speed: 30, shape: "square" });
    const ev = t.lastEvent();
    expect(ev?.type).toBe("EntityUpdated");
    expect(ev?.changes.filter((c) => c.type === "token").map((c) => c.id)).toEqual([a.id, b.id]);
    // Speed removed → null; an unchanged speed writes nothing.
    const { speed: _speed, ...noSpeed } = wolfBlock;
    t.run(UPDATE, { id: ogreId, name: "Cave Ogre", statBlock: { ...noSpeed, size: "large" } });
    expect(t.tokenRow(a.id).speed).toBeNull();
    t.run(UPDATE, { id: ogreId, name: "Cave Ogre 2", statBlock: { ...noSpeed, size: "large" } });
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["entity"]);
  });

  test("FR-MAP-35 map.updateToken {shape}: TokenUpdated, logged; DM only; bad value invalid", () => {
    const t = setup();
    const s = t.newScene();
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    const n = readEventLog(t.s.db).length;
    t.run(I.updateToken, { tokenId: g.id, shape: "square" });
    expect(t.tokenRow(g.id)).toMatchObject({ shape: "square", name: "Goblin" });
    expect(t.lastEvent()?.type).toBe("TokenUpdated");
    expect(
      readEventLog(t.s.db)
        .slice(n)
        .map((l) => l.type),
    ).toEqual(["TokenUpdated"]);
    expect(t.err(() => t.run(I.updateToken, { tokenId: g.id, shape: "hex" })).code).toBe("invalid");
    expect(t.err(() => t.run(I.updateToken, { tokenId: g.id, speed: 60 })).code).toBe("invalid");
    expect(
      t.err(() => t.run(I.updateToken, { tokenId: g.id, shape: "none" }, t.player(t.h.p1))).code,
    ).toBe("forbidden");
    // A player sending `shape` or `speed` on a move → invalid (not in their schema).
    expect(
      t.err(() =>
        t.run(I.moveToken, { tokenId: g.id, col: 2, row: 2, shape: "none" }, t.player(t.h.p1)),
      ).code,
    ).toBe("invalid");
  });

  test("FR-MAP-17 / -04 duplicate token and scene copy shape and speed", () => {
    const t = setup();
    const s = t.newScene();
    const ogre = t.place(s.id, t.caveOgre(), 9, 10);
    t.run(I.updateToken, { tokenId: ogre.id, shape: "square" });
    const { tokenId } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: ogre.id });
    expect(t.tokenRow(tokenId)).toMatchObject({ shape: "square", speed: 40, name: "Cave Ogre 2" });
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: s.id });
    const copied = t.s.db.select().from(token).where(eq(token.sceneId, copy.id)).all();
    expect(copied.map((r) => [r.shape, r.speed])).toEqual([
      ["square", 40],
      ["square", 40],
    ]);
  });
});

describe("scenes-map feedback: move hooks (FR-MAP-38, ADR-0031)", () => {
  test("FR-MAP-38 move runs a test-registered hook (DM and player actor); rows in TokenMoved.changes; no log row", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.activateScene, { sceneId: s.id });
    const mira = t.place(s.id, t.miraId, 2, 7);
    const roles: string[] = [];
    tokenHooksOf(t.s).register("test.move", (env, before, after) => {
      roles.push(env.actor.role);
      const moved = after !== null && (before.col !== after.col || before.row !== after.row);
      return moved
        ? [{ type: "probe-row", id: `moved-${before.id}`, before: null, after: {} }]
        : [];
    });
    try {
      const n = readEventLog(t.s.db).length;
      t.run(I.moveToken, { tokenId: mira.id, col: 5, row: 7 });
      t.run(I.moveToken, { tokenId: mira.id, col: 6, row: 7 }, t.player(t.h.p1));
      expect(roles).toEqual(["dm", "player"]);
      const ev = t.lastEvent();
      expect(ev?.type).toBe("TokenMoved");
      expect(ev?.payload).toEqual({ tokenId: mira.id, sceneId: s.id, col: 6, row: 7 });
      expect(ev?.changes.map((c) => [c.type, c.id])).toEqual([
        ["token", mira.id],
        ["probe-row", `moved-${mira.id}`],
      ]);
      expect(readEventLog(t.s.db).length).toBe(n);
      // Place and duplicate still run none.
      const before = roles.length;
      const g = t.place(s.id, t.h.goblinId, 12, 6);
      t.run(I.duplicateToken, { tokenId: g.id });
      expect(roles.length).toBe(before);
    } finally {
      tokenHooksOf(t.s).unregister("test.move");
    }
  });

  test("FR-MAP-38 a throwing move hook rolls the move back (internal)", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.activateScene, { sceneId: s.id });
    const mira = t.place(s.id, t.miraId, 2, 7);
    tokenHooksOf(t.s).register("test.boom", (env) => {
      env.tx.update(token).set({ name: "Scribbled" }).where(eq(token.id, mira.id)).run();
      throw new Error("boom");
    });
    try {
      const events = t.events.length;
      for (const actor of [t.h.dm, t.player(t.h.p1)] as Actor[]) {
        const e = t.err(() => t.run(I.moveToken, { tokenId: mira.id, col: 5, row: 7 }, actor));
        expect(e.code).toBe("internal");
      }
      expect(t.tokenRow(mira.id)).toMatchObject({ col: 2, row: 7, name: "Mira" });
      expect(t.events.length).toBe(events);
    } finally {
      tokenHooksOf(t.s).unregister("test.boom");
    }
    t.run(I.moveToken, { tokenId: mira.id, col: 5, row: 7 }, t.player(t.h.p1));
    expect(t.tokenRow(mira.id)).toMatchObject({ col: 5, row: 7 });
  });
});
