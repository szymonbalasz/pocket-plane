// live-sync §12 build time (#163): the DM snapshot of session-sim and of the "realistic heavy"
// session builds in < 200 ms (best of 5), and 300 more log rolls don't grow it (SQL windows). Run
// alone via `bun run bench`; the size ceilings and windows stay in ./snapshot-size.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { bestOf, GATE_TIMEOUT } from "@shared/bench-kit";
import { writeWorstPresents } from "../features/party-board/testing";
import { buildRealisticHeavy, dmBuildMs, servicesFromBundle } from "./testing/snapshot-size";

const BUILD_MS = 200;

describe("live-sync §12 DM snapshot build", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  /** One warm-up build, then one timed (`dmBuildMs` with 1 run). */
  const build = () => dmBuildMs(b.s, 1);
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
  }, 60_000);
  afterAll(() => b.cleanup());

  // The tests run in order on one scenario: session-sim, then realistic heavy on top, then rolls.
  test(
    "session-sim: DM build best of 5 < 200 ms",
    async () => {
      const ms = await bestOf(build, BUILD_MS, 5, 1);
      console.log(`live-sync §12 session-sim DM build: best of 5 ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(BUILD_MS);
    },
    GATE_TIMEOUT,
  );

  test(
    "CON-44 (#208) realistic heavy: DM build best of 5 < 200 ms",
    async () => {
      buildRealisticHeavy(b.s);
      const cid = b.s.db.$client
        .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
        .get()?.id as string;
      writeWorstPresents(b.s.db, cid);
      const ms = await bestOf(build, BUILD_MS, 5, 1);
      console.log(`live-sync §12 realistic heavy DM build: best of 5 ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(BUILD_MS);
    },
    GATE_TIMEOUT,
  );

  test(
    "SQL windows: 300 more rolls keep the DM build flat (< max(200 ms, 2 × before))",
    async () => {
      const before = await bestOf(build, BUILD_MS, 5, 1);
      const cid = b.s.db.$client
        .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
        .get()?.id;
      const dm = { role: "dm" as const, playerId: null, campaignId: cid as string };
      for (let i = 0; i < 300; i++) {
        b.s.commands.run(
          "dice.roll",
          { expression: "1d20", mode: "normal", category: "damage" },
          { actor: dm },
        );
      }
      const bound = Math.max(BUILD_MS, before * 2);
      const ms = await bestOf(build, bound, 5, 1);
      console.log(
        `live-sync §12 DM build after 300 rolls: best of 5 ${ms.toFixed(1)} ms (before ${before.toFixed(1)} ms)`,
      );
      expect(ms).toBeLessThan(bound);
    },
    GATE_TIMEOUT,
  );
});
