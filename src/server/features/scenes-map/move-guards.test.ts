// ADR-0040 / FR-SCN-11 move guards: the registry ships empty; a test guard shows `map.moveToken`
// runs guards → derive → one write → token-changed hooks, and that a refusal writes nothing.
import { afterEach, describe, expect, test } from "bun:test";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { MAP_REST as R } from "./commands";
import { moveGuards, tokenMoveGuards } from "./move-guards";
import { scenesSetup } from "./testing";
import { tokenHooks } from "./token-hooks";
import { visibilityHooks } from "./visibility-hooks";

const trace: string[] = [];

afterEach(() => {
  tokenMoveGuards.unregister("test.guard");
  tokenMoveGuards.unregister("test.second");
  visibilityHooks.unregister("test.derive");
  tokenHooks.unregister("test.spy");
  trace.length = 0;
});

function setup() {
  const t = scenesSetup();
  const s = t.run<SceneRecord>(R.createScene, { name: "Goblin Ambush", mapAssetId: "map-battle" });
  t.run(I.activateScene, { sceneId: s.id });
  const place = (definitionId: string, col: number, row: number, ownerPlayerId?: string) =>
    t.run<{ tokenId: string }>(I.placeToken, {
      sceneId: s.id,
      definitionId,
      col,
      row,
      ...(ownerPlayerId ? { ownerPlayerId } : {}),
    }).tokenId;
  const at = (id: string) => {
    const r = t.s.db.select().from(token).where(eq(token.id, id)).get();
    return { col: r?.col, row: r?.row };
  };
  const spy = () => {
    visibilityHooks.register({
      name: "test.derive",
      derive(read, obj) {
        const rows = read.select().from(token).all();
        trace.push(`derive ${JSON.stringify(obj.cells)} rows=${rows.length}`);
        return {};
      },
    });
    tokenHooks.register("test.spy", (_env, before, after) => {
      trace.push(`hook ${before.col},${before.row}→${after?.col},${after?.row}`);
      return [];
    });
  };
  return { ...t, scene: s, place, at, spy };
}

describe("ADR-0040 move guards", () => {
  test("ADR-0040 the registry ships empty: moves are unchanged", () => {
    expect(moveGuards).toEqual([]);
    const t = setup();
    const g = t.place(t.h.goblinId, 2, 2);
    t.run(I.moveToken, { tokenId: g, col: 9, row: 2 });
    expect(t.at(g)).toEqual({ col: 9, row: 2 });
  });

  test("FR-SCN-11 order: guards (committed state) → derive → one write → token-changed hooks", () => {
    const t = setup();
    const g = t.place(t.h.goblinId, 2, 2);
    t.spy();
    tokenMoveGuards.register("test.guard", (env, tok, from, to) => {
      const row = env.read.select().from(token).where(eq(token.id, tok.id)).get();
      trace.push(`guard ${from.col},${from.row}→${to.col},${to.row} db=${row?.col},${row?.row}`);
      expect(Object.keys(env).sort()).toEqual(["actor", "read"]);
      expect(env.actor.role).toBe("dm");
    });
    t.run(I.moveToken, { tokenId: g, col: 5, row: 6 });
    expect(trace).toEqual([
      "guard 2,2→5,6 db=2,2",
      'derive {"col":5,"row":6,"w":1,"h":1} rows=1',
      "hook 2,2→5,6",
    ]);
    expect(t.at(g)).toEqual({ col: 5, row: 6 });
  });

  test("FR-SCN-11 a refusal: conflict, no write, no derive, no hook, no event, no log entry", () => {
    const t = setup();
    const mira = t.place(t.miraId, 2, 7, t.h.p1.id);
    t.spy();
    tokenMoveGuards.register("test.guard", (env, _tok, _from, to) => {
      trace.push(`guard ${env.actor.role}`);
      if (env.actor.role === "player" && to.col >= 8) throw conflict("Blocked by a wall or door");
    });
    const events = t.events.length;
    const log = readEventLog(t.s.db).length;
    const e = t.err(() => t.run(I.moveToken, { tokenId: mira, col: 10, row: 7 }, t.player(t.h.p1)));
    expect(e.code).toBe("conflict");
    expect(e.message).toBe("Blocked by a wall or door");
    expect(trace).toEqual(["guard player"]);
    expect(t.at(mira)).toEqual({ col: 2, row: 7 });
    expect(t.events.length).toBe(events);
    expect(readEventLog(t.s.db).length).toBe(log);
    // Each guard decides whom it checks: the DM's move passes this one.
    t.run(I.moveToken, { tokenId: mira, col: 10, row: 7 });
    expect(t.at(mira)).toEqual({ col: 10, row: 7 });
  });

  test("ADR-0040 guards run in list order; the first throw stops the rest", () => {
    const t = setup();
    const g = t.place(t.h.goblinId, 2, 2);
    tokenMoveGuards.register("test.guard", () => {
      trace.push("first");
      throw conflict("no");
    });
    tokenMoveGuards.register("test.second", () => trace.push("second"));
    expect(t.err(() => t.run(I.moveToken, { tokenId: g, col: 3, row: 2 })).code).toBe("conflict");
    expect(trace).toEqual(["first"]);
    expect(() => tokenMoveGuards.register("test.guard", () => {})).toThrow(/twice/);
  });

  test("ADR-0040 placement, duplicate and scene copy run no guard", () => {
    const t = setup();
    tokenMoveGuards.register("test.guard", () => {
      trace.push("guard");
      throw conflict("no");
    });
    const g = t.place(t.h.goblinId, 2, 2);
    t.run(I.duplicateToken, { tokenId: g });
    t.run(R.duplicateScene, { id: t.scene.id });
    expect(trace).toEqual([]);
  });
});
