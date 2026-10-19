// SCN §12 guard benchmark: the wall move guard (row read + check) at 2,000 segments, p95 ≤ 1 ms
// per move. Run alone via `bun run bench`; the guard's behaviour stays in ./guard.test.ts.
import { describe, expect, test } from "bun:test";
import { bestOf, GATE_TIMEOUT, p95 } from "@shared/bench-kit";
import { SEGMENTS_MAX, type Wall } from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, type TokenRecord } from "@shared/scenes-map/schemas";
import { readToken } from "../scenes-map/rows";
import { scnWallGuard } from "./guard";
import { AMBUSH_DOORS, scnSetup } from "./testing";

describe("SCN §12 guard benchmark", () => {
  test(
    "SCN §12 2,000 segments: the guard (row read + check) ≤ 1 ms p95 per move",
    async () => {
      const t = scnSetup();
      const sid = t.ambush.id;
      // 1,998 short walls away from the path plus the two Ambush doors.
      const walls = Array.from(
        { length: SEGMENTS_MAX - 2 },
        (_, i): Wall => [i + 10, 10 + (i % 10), 13 - (i % 3), 11 + (i % 10), 13 - (i % 3)],
      );
      t.writeStructure(sid, walls, AMBUSH_DOORS);
      t.run(I.activateScene, { sceneId: sid });
      const mira = t.run<{ tokenId: string }>(I.placeToken, {
        sceneId: sid,
        definitionId: t.miraId,
        col: 2,
        row: 7,
      }).tokenId;
      const tok = t.s.db.transaction((tx) => readToken(tx, mira)) as TokenRecord;
      const env = { read: t.s.db, actor: t.player(t.h.p1) };
      // Best batch of 300 moves (bench-kit `bestOf`).
      const ms = await bestOf(
        p95((i) => {
          scnWallGuard.guard(env, tok, { col: 2, row: 7 }, { col: 7, row: 2 + (i % 10) });
        }, 300),
        1,
        5,
        1,
      );
      expect(ms).toBeLessThan(1);
    },
    GATE_TIMEOUT,
  );
});
