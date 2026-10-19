// FOG §12 size gates on the benchmark scenes (./vision-bench-kit): the V0 `vision` record at
// 1 / 4 sources and the sprint-4 own + shared records. Deterministic, so they stay in `bun test`;
// the ms gates on the same scenes run via `bun run bench` (BL-32).
import { describe, expect, test } from "bun:test";
import { playerVision, prepareScene, type VisionSource } from "./vision";
import { buildScene, sprint4Scene, V0_KINDS } from "./vision-bench-kit";

describe("FOG §12 V0 benchmark sizes", () => {
  for (const [kind] of V0_KINDS) {
    test(`FOG §12 ${kind}: the vision record at ${kind === "typical" ? 1 : 4} source(s) ≤ 48 KiB`, () => {
      const s = buildScene(kind);
      const scene = prepareScene(s.walls, s.darkness);
      let max = 0;
      for (const srcs of s.players) {
        const v = playerVision(scene, srcs);
        const rec = {
          id: "scene-0123456789:player-0123456789",
          sceneId: "scene-0123456789",
          playerId: "player-0123456789",
          blind: v.blind,
          see: v.see,
          dark: v.dark,
          ...(v.inv.length > 0 ? { inv: v.inv } : {}),
        };
        max = Math.max(max, Buffer.byteLength(JSON.stringify(rec), "utf8"));
      }
      expect(max).toBeLessThanOrEqual(48 * 1024);
    });
  }
});

describe("FOG §12 sprint-4 benchmark sizes (r 199.8)", () => {
  test("FR-FOG-39 one player's `vision` at 4 sources (caps) ≤ 48 KiB; 12 shared records measured", () => {
    const { players, scene, counted } = sprint4Scene();
    let own = 0;
    let all = 0;
    for (const [i, srcs] of players.entries()) {
      const v = playerVision(scene, srcs);
      const rec = {
        id: "scene-0123456789-0123456789-0123:player-0123456789-0123456789-01",
        sceneId: "scene-0123456789-0123456789-0123",
        playerId: "player-0123456789-0123456789-01",
        blind: v.blind,
        see: v.see,
        dark: v.dark,
        src: v.src,
      };
      const bytes = Buffer.byteLength(JSON.stringify(rec), "utf8");
      own = Math.max(own, bytes);
      const c = playerVision(scene, counted[i] as VisionSource[]);
      all += Buffer.byteLength(JSON.stringify({ ...rec, see: c.see, dark: c.dark, src: c.src }));
    }
    expect(own).toBeLessThanOrEqual(48 * 1024);
    expect(all).toBeLessThanOrEqual(192 * 1024);
  });
});
