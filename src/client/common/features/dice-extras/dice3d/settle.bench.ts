// FR-DICEX-15 / -34 precompute budget: 20 dice settle headless in ≤ 50 ms, default arena and every
// DICEX §13 arena. Run alone via `bun run bench`; the step / rest / face asserts on the same throws
// stay in ./settle.test.ts.
import { describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT } from "@shared/bench-kit";
import type { DieShape } from "@shared/dice-extras/throw";
import { type Arena, arenaOf, screenArena } from "../arena";
import { seedOf, simulate } from "./settle";

const SHAPES: DieShape[] = ["d4", "d6", "d8", "d10", "d12", "d20"];
const dice = Array.from({ length: 20 }, (_, i) => {
  const s = SHAPES[i % SHAPES.length] as DieShape;
  return { shape: s, kind: s };
});

/** Fastest settle over three seeds in rotation. */
function settleMs(prefix: string, arena?: Arena): Promise<number> {
  let k = 0;
  return best(
    () => {
      simulate(dice, seedOf(`${prefix}-${k++ % 3}`), arena);
    },
    50,
    9,
    3,
  );
}

describe("FR-DICEX-15 headless settle", () => {
  test(
    "FR-DICEX-15 20 dice: precompute ≤ 50 ms",
    async () => {
      expect(await settleMs("twenty")).toBeLessThanOrEqual(50);
    },
    GATE_TIMEOUT,
  );
});

const ARENAS: [string, Arena][] = [
  ["1280×720", screenArena({ w: 1280, h: 720 })],
  ["1440×900", screenArena({ w: 1440, h: 900 })],
  ["1920×1080", screenArena({ w: 1920, h: 1080 })],
  ["390×844", screenArena({ w: 390, h: 844 })],
  ["PiP 260×96", arenaOf({ w: 260, h: 96 }, 24)],
];

describe("FR-DICEX-34 animation lands on the server's faces", () => {
  test.each(ARENAS)(
    "FR-DICEX-34 %s: 20 dice ≤ 50 ms",
    async (_, arena) => {
      expect(await settleMs("arena-twenty", arena)).toBeLessThanOrEqual(50);
    },
    GATE_TIMEOUT,
  );
});
