// FR-SCN-52: the label's hover target (`templateUnder`): a template's true outline (+ 6 screen
// px) or its label pill, topmost in draw order, for every drawn template (no edit filter).
import { describe, expect, test } from "bun:test";
import type { TemplateRecordView } from "@shared/scene-tools/schemas";
import { keptView, type PillRect, templateAt, templateUnder } from "./templates";

const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };

const rec = (id: string, t: Partial<TemplateRecordView>): TemplateRecordView => ({
  id,
  sceneId: "s1",
  shape: "sphere",
  x: 0,
  y: 0,
  size: 10,
  width: null,
  angle: 0,
  label: id,
  placedByPlayerId: null,
  hidden: false,
  ...t,
});

// Draw order: later = on top.
const sphere = rec("sphere", { x: 5, y: 5, size: 10, placedByPlayerId: "p1" }); // r 140 px at (350, 350)
const cube = rec("cube", { shape: "cube", x: 4, y: 4, size: 20, placedByPlayerId: "p2" }); // 280..560
const cone = rec("cone", { shape: "cone", x: 10, y: 2, size: 30 }); // (700, 140) east, 420 px long
const glyph = rec("glyph", { shape: "cube", x: 14, y: 10, size: 10, hidden: true }); // 980..1120
const edge = rec("edge", { shape: "cylinder", x: 0, y: 0, size: 10 }); // off the map's edge
const kept = [sphere, cube, cone, glyph, edge];
const drawn = kept.map((r) => ({ id: r.id, template: keptView(r) }));
const under = (x: number, y: number, scale = 1, pills: Record<string, PillRect> = {}) =>
  templateUnder({ x, y }, drawn, scale, GRID, pills);

describe("FR-SCN-52 template label on hover", () => {
  test("FR-SCN-52 template label on hover: the area of any drawn template, not only editable ones", () => {
    expect(under(350, 220)).toBe("sphere");
    expect(under(900, 140)).toBe("cone"); // the DM's cone: a player hovers it too
    expect(under(1050, 770)).toBe("glyph"); // a hidden one while drawn (the DM's)
    expect(under(-30, -30)).toBe("edge"); // uncut: off the map
    // (525, 525) is only Player 2's cube: Player 1 can't edit it (templateAt → null) but hovers it.
    const p1 = {
      client: "player" as const,
      myPlayerId: "p1",
      dmOnlyOff: false,
      templatesOff: false,
      blind: false,
      scale: 1,
      grid: GRID,
    };
    expect(templateAt({ x: 525, y: 525 }, kept, p1)).toBeNull();
    expect(under(525, 525)).toBe("cube");
  });

  test("FR-SCN-52 template label on hover: within 6 screen px of the outline; outside → null", () => {
    expect(under(350, 350 - 140 - 5)).toBe("sphere");
    expect(under(350, 350 - 140 - 7)).toBeNull();
    // Scale 2: 6 screen px = 3 map px.
    expect(under(350, 350 - 140 - 2.5, 2)).toBe("sphere");
    expect(under(350, 350 - 140 - 4, 2)).toBeNull();
    expect(under(1500, 1500)).toBeNull();
  });

  test("FR-SCN-52 template label on hover: of several, the topmost in draw order", () => {
    // (350, 350): inside the sphere and the cube drawn above it.
    expect(under(350, 350)).toBe("cube");
    expect(templateUnder({ x: 350, y: 350 }, [...drawn].reverse(), 1, GRID)).toBe("sphere");
  });

  test("FR-SCN-52 template label on hover: the pill counts; the grown pill keeps the hover (no flicker)", () => {
    // The cone's pill at its origin (700, 140) + 8 px, outside every area: small, then grown.
    const small = { x: 1300, y: 300, width: 60, height: 18 };
    const grown = { ...small, width: 160 };
    expect(under(1320, 310)).toBeNull();
    expect(under(1320, 310, 1, { cone: small })).toBe("cone");
    // The pointer in the grown part (past the small pill's right edge): still hovered while grown…
    expect(under(1420, 310, 1, { cone: grown })).toBe("cone");
    // …and not as the small pill: hover only starts on what is drawn.
    expect(under(1420, 310, 1, { cone: small })).toBeNull();
    // Leaving both the area (+ 6 px) and the grown rect ends it.
    expect(under(1470, 310, 1, { cone: grown })).toBeNull();
  });
});
