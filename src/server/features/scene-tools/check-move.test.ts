// FR-SCN-38 / -40 (ADR-0042): scenes-map's `map.checkMove` dry run with the wall guard's hint
// (first crossing only, ≤ 0.5 cell either side), decimal walls (FR-SCN-07), FR-FOG-11 can't-see
// → `not_found` in `map.checkMove` / `map.moveToken` / `map.drag`, no write / log / event.
import { afterEach, describe, expect, test } from "bun:test";
import { FOG_INTENTS as F } from "@shared/fog-of-war/schemas";
import { SCN_INTENTS as S } from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, MAP_SIGNALS } from "@shared/scenes-map/schemas";
import { stateDigest } from "../../db/digest";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { dragAudience } from "../scenes-map/drag";
import { tokenMoveGuards } from "../scenes-map/move-guards";
import { scnSetup } from "./testing";

afterEach(() => tokenMoveGuards.unregister("test.hint"));

function setup() {
  const t = scnSetup();
  const sid = t.ambush.id;
  t.writeStructure(sid);
  t.run(I.activateScene, { sceneId: sid });
  const place = (definitionId: string, col: number, row: number, extra = {}) =>
    t.run<{ tokenId: string }>(I.placeToken, { sceneId: sid, definitionId, col, row, ...extra })
      .tokenId;
  const mira = place(t.miraId, 2, 7);
  const thorn = place(t.thornId, 2, 9);
  const goblin = place(t.h.goblinId, 12, 6);
  const wolf = place(t.h.wolfId, 14, 4, { hidden: true });
  const p1 = t.player(t.h.p1);
  const check = (tokenId: string, col: number, row: number, actor: Actor = p1) =>
    t.run<{ ok: boolean; hints: { guard: string; segments: number[][] }[] }>(
      I.checkMove,
      { tokenId, col, row },
      actor,
    );
  return { ...t, sid, mira, thorn, goblin, wolf, p1, check };
}

describe("FR-SCN-38 map.checkMove", () => {
  test("FR-SCN-38 Mira (2, 7) → (10, 7): {ok: false} with one piece [8, 7, 8, 8]; → (7, 5) ok", () => {
    const t = setup();
    expect(t.check(t.mira, 10, 7)).toEqual({
      ok: false,
      hints: [{ guard: "scene-tools.walls", segments: [[8, 7, 8, 8]] }],
    });
    expect(t.check(t.mira, 7, 5)).toEqual({ ok: true, hints: [] });
    // The DM is never checked (FR-SCN-13 draws its own hint).
    expect(t.check(t.mira, 10, 7, t.h.dm)).toEqual({ ok: true, hints: [] });
  });

  test("FR-SCN-38 several crossings → only the first from `from`: the freeform wall's piece", () => {
    const t = setup();
    t.run(S.addWalls, { sceneId: t.sid, segments: [[4.5, 3.25, 6.75, 5.5]] });
    const r = t.check(t.mira, 9, 1);
    expect(r.ok).toBe(false);
    expect(r.hints).toHaveLength(1);
    const [piece] = r.hints[0]?.segments ?? [];
    // A piece of the freeform wall (on its line, ≈ 1 cell long), never of x = 8.
    const [x1, y1, x2, y2] = piece as [number, number, number, number];
    for (const x of [x1, x2]) expect(x >= 4.5 && x <= 6.75).toBe(true);
    for (const y of [y1, y2]) expect(y >= 3.25 && y <= 5.5).toBe(true);
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThanOrEqual(1.02); // rounded to 0.01
    // FR-SCN-10 guard on the decimal wall: Mira (2, 7) → (6, 3) is refused.
    expect(t.err(() => t.run(I.moveToken, { tokenId: t.mira, col: 6, row: 3 }, t.p1)).code).toBe(
      "conflict",
    );
  });

  test("FR-SCN-38 read-only: no DB write, log row, event or seq", () => {
    const t = setup();
    const digest = stateDigest(t.s.db.$client).sha256;
    const events = t.events.length;
    const log = readEventLog(t.s.db).length;
    t.check(t.mira, 10, 7);
    t.check(t.mira, 3, 7);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.events.length).toBe(events);
    expect(readEventLog(t.s.db).length).toBe(log);
  });

  test("FR-SCN-40 a guard returning {refuse, hint} refuses the move with conflict and hints the dry run", () => {
    const t = setup();
    tokenMoveGuards.register("test.hint", () => ({
      refuse: "No",
      hint: { segments: [[1, 1, 2, 2]] },
    }));
    expect(t.check(t.mira, 3, 7).hints).toContainEqual({
      guard: "test.hint",
      segments: [[1, 1, 2, 2]],
    });
    const e = t.err(() => t.run(I.moveToken, { tokenId: t.mira, col: 3, row: 7 }, t.p1));
    expect([e.code, e.message]).toEqual(["conflict", "No"]);
  });
});

describe("FR-FOG-11 a token the player can't see → not_found (no existence oracle)", () => {
  test("FR-FOG-11 fog-hidden Goblin, hidden Wolf, unknown id: not_found in checkMove / moveToken / drag; visible not theirs: forbidden", () => {
    const t = setup();
    // Fog all, reveal the west part: Goblin (12, 6) is fog-hidden for both players.
    t.run(F.setAll, { sceneId: t.sid, fogged: true });
    t.run(F.edit, {
      sceneId: t.sid,
      op: "reveal",
      shape: { kind: "rect", c0: 0, r0: 0, c1: 7, r1: 13 },
    });
    const read = { db: t.s.db, activeSceneOf: (c: string) => t.s.records.activeSceneOf(c) };
    const sender = { role: "player" as const, playerId: t.h.p1.id, campaignId: t.h.campaignId };
    for (const id of [t.goblin, t.wolf, "no-such-token"]) {
      expect(t.err(() => t.check(id, 3, 7)).code).toBe("not_found");
      expect(t.err(() => t.run(I.moveToken, { tokenId: id, col: 3, row: 7 }, t.p1)).code).toBe(
        "not_found",
      );
      expect(() => dragAudience({ sceneId: t.sid, tokenId: id, x: 0, y: 0 }, sender, read)).toThrow(
        /not found/i,
      );
    }
    // Thorn (player-2's, visible to player-1): forbidden, as before.
    expect(t.err(() => t.check(t.thorn, 3, 9)).code).toBe("forbidden");
    expect(MAP_SIGNALS.drag).toBe("map.drag");
  });
});
