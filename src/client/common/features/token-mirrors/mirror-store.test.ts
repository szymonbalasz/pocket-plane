// Token mirrors' look and hit rules (MIR §7).
import { describe, expect, test } from "bun:test";
import type { MirrorView } from "@shared/token-mirrors/schemas";
import {
  dmLabel,
  drawsAsShadow,
  MODE_LABELS,
  mirrorAt,
  mirrorOpacity,
  offForPlayers,
  playerLabel,
  sceneMirrorsOf,
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
