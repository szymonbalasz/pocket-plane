// Token mirrors' look and hit rules (MIR §7).
import { describe, expect, test } from "bun:test";
import type { MirrorView } from "@shared/token-mirrors/schemas";
import {
  dmLabel,
  drawsAsShadow,
  MODE_LABELS,
  mirrorAt,
  mirrorOpacity,
  mirrorTarget,
  offForPlayers,
  playerLabel,
  sceneMirrorsOf,
  shownMirrorsOf,
  withMirrorTargets,
} from "./mirror-store";

const m = (over: Partial<MirrorView> = {}): MirrorView => ({
  id: "m1",
  sceneId: "s1",
  col: 2,
  row: 3,
  mode: "visible",
  size: "medium",
  shape: "round",
  ...over,
});
const grid = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };

describe("FR-MIR-15 the look", () => {
  test("FR-MIR-15 opacity per mode; hidden or held back by its token is faint", () => {
    expect(mirrorOpacity(m())).toBe(1);
    expect(mirrorOpacity(m({ mode: "transparent" }))).toBe(0.45);
    expect(mirrorOpacity(m({ mode: "shadow" }))).toBe(0.6);
    expect(mirrorOpacity(m({ mode: "hidden" }))).toBe(0.3);
    expect(mirrorOpacity(m({ suppressed: true }))).toBe(0.3);
    expect(offForPlayers(m({ suppressed: true }))).toBe(true);
    expect(offForPlayers(m())).toBe(false);
  });

  test("FR-MIR-15 only a shadow draws as a dark shape", () => {
    expect(drawsAsShadow(m({ mode: "shadow" }))).toBe(true);
    expect(drawsAsShadow(m({ mode: "transparent" }))).toBe(false);
  });

  test("FR-MIR-15 the DM's label always says Mirror; a player's is the name or nothing", () => {
    expect(dmLabel(m({ name: "Goblin", mode: "transparent" }))).toBe(
      "Mirror · Goblin · Transparent",
    );
    expect(dmLabel(m({ name: "Goblin", suppressed: true }))).toBe(
      "Mirror · Goblin · Hidden with its token",
    );
    // #443: shown, but no player has sight to it.
    expect(dmLabel(m({ name: "Goblin", mode: "transparent", fogged: true }))).toBe(
      "Mirror · Goblin · Transparent · Fog",
    );
    expect(dmLabel(m({ name: "Goblin", mode: "hidden", fogged: true }))).toBe(
      "Mirror · Goblin · Hidden",
    );
    expect(playerLabel(m({ name: "Goblin" }))).toBe("Goblin");
    expect(playerLabel(m({ mode: "shadow" }))).toBeNull();
  });

  test("FR-MIR-16 the menu offers the four modes", () => {
    expect(MODE_LABELS.map(([mode]) => mode)).toEqual([
      "visible",
      "transparent",
      "shadow",
      "hidden",
    ]);
  });
});

describe("FR-MIR-16 the right-click's hit", () => {
  test("FR-MIR-16 only this scene's mirrors, oldest first", () => {
    const byId = {
      b: m({ id: "b", seq: 2 }),
      a: m({ id: "a", seq: 1 }),
      c: m({ id: "c", seq: 3, sceneId: "other" }),
    };
    expect(sceneMirrorsOf(byId, "s1").map((x) => x.id)).toEqual(["a", "b"]);
    expect(sceneMirrorsOf(undefined, "s1")).toEqual([]);
  });

  test("FR-MIR-16 the footprint is hit, the topmost first, and a big token's too", () => {
    const low = m({ id: "low" });
    const high = m({ id: "high" });
    expect(mirrorAt([low, high], grid, { x: 150, y: 220 })?.id).toBe("high");
    expect(mirrorAt([low], grid, { x: 139, y: 220 })).toBeNull();
    expect(mirrorAt([low], grid, { x: 210, y: 220 })).toBeNull();
    const big = m({ id: "big", size: "large" });
    expect(mirrorAt([big], grid, { x: 279, y: 349 })?.id).toBe("big");
  });
});

describe("FR-MIR-04 targeting through a mirror", () => {
  const goblin = { id: "t-gob", col: 8, row: 8, size: "medium" as const };
  const orc = { id: "t-orc", col: 0, row: 0, size: "medium" as const };
  // The box holds cells 2–3 × 3 (centres 175 / 245, 245): not the tokens' cells.
  const box = { x0: 140, y0: 210, x1: 290, y1: 280 };

  test("FR-MIR-04 a mirror stands for its drawn token; a player's copy (no tokenId) for none", () => {
    expect(mirrorTarget(m({ tokenId: "t-gob" }), [orc, goblin])).toBe(goblin);
    expect(mirrorTarget(m({ tokenId: "t-gone" }), [orc, goblin])).toBeNull();
    expect(mirrorTarget(m(), [orc, goblin])).toBeNull();
  });

  test("FR-MIR-04 a targeting box adds its mirrors' tokens, each once, after its own", () => {
    const mirrors = [
      m({ id: "a", tokenId: "t-gob" }),
      m({ id: "b", tokenId: "t-gob", col: 3 }),
      m({ id: "c", tokenId: "t-orc", col: 12 }),
    ];
    expect(withMirrorTargets([], mirrors, [orc, goblin], grid, box)).toEqual(["t-gob"]);
    expect(withMirrorTargets(["t-orc"], mirrors, [orc, goblin], grid, box)).toEqual([
      "t-orc",
      "t-gob",
    ]);
    expect(withMirrorTargets(["t-gob"], mirrors, [orc, goblin], grid, box)).toEqual(["t-gob"]);
    // A token the canvas doesn't draw (DM-only items off) is not picked through its mirror.
    expect(withMirrorTargets([], mirrors, [orc], grid, box)).toEqual([]);
    expect(withMirrorTargets(["t-orc"], [], [orc, goblin], grid, box)).toEqual(["t-orc"]);
  });

  test("FR-MIR-04 the DM-only items switch off drops mirrors players don't see", () => {
    const byId = {
      a: m({ id: "a", seq: 1 }),
      b: m({ id: "b", seq: 2, mode: "hidden" }),
      c: m({ id: "c", seq: 3, suppressed: true }),
    };
    expect(shownMirrorsOf(byId, "s1", false).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(shownMirrorsOf(byId, "s1", true).map((x) => x.id)).toEqual(["a"]);
  });
});
