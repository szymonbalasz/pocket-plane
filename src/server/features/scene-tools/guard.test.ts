// The wall move guard (FR-SCN-10, -11; ADR-0040) on Goblin Ambush with `scn-walls`: a player's
// move across a wall or a non-open door is `conflict` with no write, event, log entry, derive or
// token-changed hook (so no combat `movedFt`); open doors pass; the DM is never checked; the guard
// reads the committed structure at drop. Benchmark: ≤ 1 ms p95 per move at 2,000 segments.
import { afterEach, describe, expect, test } from "bun:test";
import { SCN_INTENTS as S, SEGMENTS_MAX, type Wall } from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { combatant, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { startCommand } from "../combat-tracker/lifecycle";
import { combatSetup } from "../combat-tracker/testing";
import { readToken } from "../scenes-map/rows";
import { tokenHooks } from "../scenes-map/token-hooks";
import { visibilityHooks } from "../scenes-map/visibility-hooks";
import { scnWallGuard, WALL_BLOCKED } from "./guard";
import { AMBUSH_DOORS, AMBUSH_WALLS, scnSetup } from "./testing";

afterEach(() => {
  visibilityHooks.unregister("test.derive");
  tokenHooks.unregister("test.spy");
});

function setup() {
  const t = scnSetup();
  const sid = t.ambush.id;
  t.writeStructure(sid);
  t.run(I.activateScene, { sceneId: sid });
  const place = (definitionId: string, col: number, row: number) =>
    t.run<{ tokenId: string }>(I.placeToken, { sceneId: sid, definitionId, col, row }).tokenId;
  const mira = place(t.miraId, 2, 7);
  const goblin = place(t.h.goblinId, 12, 6);
  const p1 = t.player(t.h.p1);
  const move = (tokenId: string, col: number, row: number, actor: Actor = p1) =>
    t.run(I.moveToken, { tokenId, col, row }, actor);
  const at = (id: string) => {
    const r = t.s.db.select().from(token).where(eq(token.id, id)).get();
    return [r?.col, r?.row];
  };
  const blocked = (fn: () => unknown) => {
    const e = t.err(fn);
    expect(e.code).toBe("conflict");
    expect(e.message).toBe(WALL_BLOCKED);
  };
  return { ...t, sid, mira, goblin, p1, move, at, blocked };
}

describe("FR-SCN-11 wall guard on map.moveToken", () => {
  test("FR-SCN-11 player-1 Mira (2, 7) → (10, 7) across the wall: conflict; nothing written, logged or emitted", () => {
    const t = setup();
    const events = t.events.length;
    const log = readEventLog(t.s.db).length;
    t.blocked(() => t.move(t.mira, 10, 7));
    expect(t.at(t.mira)).toEqual([2, 7]);
    expect(t.events.length).toBe(events);
    expect(readEventLog(t.s.db).length).toBe(log);
  });

  test("FR-SCN-10 via d1: closed blocks, open passes; d2 locked and closed block, open passes", () => {
    const t = setup();
    t.move(t.mira, 7, 5);
    t.blocked(() => t.move(t.mira, 9, 5));
    t.run(S.setDoor, { sceneId: t.sid, n: 4, state: 0 });
    t.move(t.mira, 9, 5);
    expect(t.at(t.mira)).toEqual([9, 5]);
    // d2 (8, 11)–(8, 12): locked, then closed, then open.
    t.move(t.mira, 9, 11);
    t.blocked(() => t.move(t.mira, 7, 11));
    t.run(S.setDoor, { sceneId: t.sid, n: 5, state: 1 });
    t.blocked(() => t.move(t.mira, 7, 11));
    t.run(S.setDoor, { sceneId: t.sid, n: 5, state: 0 });
    t.move(t.mira, 7, 11);
    expect(t.at(t.mira)).toEqual([7, 11]);
    // Closing reads the committed state at the next drop (SCN §11).
    t.run(S.setDoor, { sceneId: t.sid, n: 5, state: 1 });
    t.blocked(() => t.move(t.mira, 9, 11));
  });

  test("FR-SCN-10 the DM is never checked: Goblin (12, 6) → (4, 6) through the wall", () => {
    const t = setup();
    t.move(t.goblin, 4, 6, t.h.dm);
    expect(t.at(t.goblin)).toEqual([4, 6]);
    // The DM moves a player's token through too.
    t.move(t.mira, 10, 7, t.h.dm);
    expect(t.at(t.mira)).toEqual([10, 7]);
  });

  test("FR-SCN-11 a refused move runs no derive and no token-changed hook; an allowed one runs both", () => {
    const t = setup();
    const trace: string[] = [];
    visibilityHooks.register({
      name: "test.derive",
      derive: (_read, obj) => {
        trace.push(`derive ${obj.type}`);
        return {};
      },
    });
    tokenHooks.register("test.spy", () => {
      trace.push("hook");
      return [];
    });
    t.blocked(() => t.move(t.mira, 10, 7));
    expect(trace).toEqual([]);
    t.move(t.mira, 3, 7);
    expect(trace).toEqual(["derive token", "hook"]);
  });

  test("FR-SCN-10 no structure row, or a scene without walls on the path → moves unchanged", () => {
    const t = setup();
    const cellarMira = t.run<{ tokenId: string }>(I.placeToken, {
      sceneId: t.cellar.id,
      definitionId: t.miraId,
      col: 2,
      row: 7,
    }).tokenId;
    const tok = t.s.db.transaction((tx) => readToken(tx, cellarMira)) as TokenRecord;
    expect(() =>
      scnWallGuard.guard(
        { read: t.s.db, actor: t.p1 },
        tok,
        { col: 2, row: 7 },
        { col: 12, row: 7 },
      ),
    ).not.toThrow();
    t.move(t.mira, 2, 12);
    expect(t.at(t.mira)).toEqual([2, 12]);
  });
});

describe("FR-SCN-11 combat (OQ-SCN-17)", () => {
  test("FR-SCN-11 a blocked move leaves combat's movedFt unchanged; an allowed one adds it", () => {
    const t = combatSetup();
    t.run(I.activateScene, { sceneId: t.sceneId });
    for (const seg of AMBUSH_WALLS) {
      t.run(S.addWalls, { sceneId: t.sceneId, segments: [seg.slice(1)] });
    }
    for (const d of AMBUSH_DOORS) {
      t.run(S.addDoor, { sceneId: t.sceneId, segment: d.slice(1, 5), state: d[5] });
    }
    const enc = t.createAmbush();
    t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
    const moved = () =>
      t.s.db.select().from(combatant).where(eq(combatant.tokenId, t.tokens.mira)).get()?.movedFt;
    expect(moved()).toBe(0);
    const e = t.err(() =>
      t.run(I.moveToken, { tokenId: t.tokens.mira, col: 10, row: 7 }, t.player(t.h.p1)),
    );
    expect(e.message).toBe(WALL_BLOCKED);
    expect(moved()).toBe(0);
    t.run(I.moveToken, { tokenId: t.tokens.mira, col: 5, row: 7 }, t.player(t.h.p1));
    expect(moved()).toBe(15);
  });
});

describe("SCN §12 guard benchmark", () => {
  test("SCN §12 2,000 segments: the guard (row read + check) ≤ 1 ms p95 per move", () => {
    const t = setup();
    // 1,998 short walls away from the path plus the two Ambush doors.
    const walls = Array.from(
      { length: SEGMENTS_MAX - 2 },
      (_, i): Wall => [i + 10, 10 + (i % 10), 13 - (i % 3), 11 + (i % 10), 13 - (i % 3)],
    );
    t.s.db.$client.run(`DELETE FROM scene_structure WHERE scene_id = '${t.sid}'`);
    t.writeStructure(t.sid, walls, AMBUSH_DOORS);
    const tok = t.s.db.transaction((tx) => readToken(tx, t.mira)) as TokenRecord;
    const env = { read: t.s.db, actor: t.p1 };
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      scnWallGuard.guard(env, tok, { col: 2, row: 7 }, { col: 7, row: 2 + (i % 10) });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    expect(p95).toBeLessThan(1);
  });
});
