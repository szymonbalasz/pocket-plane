// FR-DICEX-28 parser budget: a 4,000-char note parses in < 1 ms. Run alone via `bun run bench`;
// the parser's matches stay in ./notation.test.ts.
import { describe, expect, test } from "bun:test";
import { bestOf, GATE_TIMEOUT } from "../bench-kit";
import { findNotation } from "./notation";

describe("FR-DICEX-28 notation parser", () => {
  test(
    "a 4,000-char note parses in < 1 ms",
    async () => {
      const chunk = "The ogre swings for 2d8 + 4 bludgeoning, then 1d6 more. ";
      const text = chunk.repeat(Math.ceil(4000 / chunk.length)).slice(0, 4000);
      // Mean ms per parse over a batch of 20; best batch (bench-kit `bestOf`).
      const runs = 20;
      const ms = await bestOf(
        () => {
          const t0 = performance.now();
          for (let i = 0; i < runs; i++) findNotation(text);
          return (performance.now() - t0) / runs;
        },
        1,
        5,
        1,
      );
      expect(ms).toBeLessThan(1);
    },
    GATE_TIMEOUT,
  );
});
