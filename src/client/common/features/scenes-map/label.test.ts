import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { decorateToken } from "./decorations";
import {
  CROSS_OPACITY,
  crossGeometry,
  cutToWidth,
  ELLIPSIS,
  LABEL_MIN_SCREEN_FONT,
  LABEL_PILL_SHARE,
  labelMetrics,
  labelRow,
  type Measure,
  MORE_BADGE_ID,
} from "./label";
import { LAYER_ORDER, orderLayers } from "./layers";
import type { TokenOverlay, TokenOverlayView } from "./token-overlays";

/** Fixed-pitch fake: every code point is half the font size wide (bold a bit wider). */
const measure: Measure = (text, font, bold) => [...text].length * font * (bold ? 0.6 : 0.5);

describe("FR-MAP-42 label", () => {
  test("FR-MAP-42 label: y centred on the bottom grid line for 1×1 and 2×2, x centred", () => {
    for (const n of [1, 2]) {
      const side = 70 * n;
      const r = labelRow("Mira", [], side, 70, 2, measure);
      expect(r.name.y + r.name.height / 2).toBeCloseTo(side);
      expect(r.name.x + r.name.width / 2).toBeCloseTo(side / 2);
    }
  });

  test("FR-MAP-42 label: pill ≤ 20 % of a cell, font never < 11 screen px", () => {
    for (const scale of [0.1, 0.25, 0.5, 1, 2, 4]) {
      for (const cell of [8, 50, 70, 140, 512]) {
        const m = labelMetrics(cell, scale);
        expect(m.font * scale).toBeGreaterThanOrEqual(LABEL_MIN_SCREEN_FONT - 1e-9);
        // The 20 % cap holds whenever an 11 px font fits in it.
        const minPill = (LABEL_MIN_SCREEN_FONT / scale) * 1.2;
        if (minPill <= cell * LABEL_PILL_SHARE) {
          expect(m.pillH).toBeLessThanOrEqual(cell * LABEL_PILL_SHARE + 1e-9);
        }
      }
    }
    // Zoomed out, the 11 px minimum wins over the 20 % cap.
    expect(labelMetrics(70, 0.5).font).toBeCloseTo(22);
  });

  test("FR-MAP-42 label: names wider than 2 × the footprint are cut with …", () => {
    const side = 70;
    const scale = 1;
    const short = labelRow("Goblin", [], side, 70, scale, measure);
    expect(short.name.text).toBe("Goblin");
    const name = "Thorngrimmelbarovinskadottirwithoutspaces"; // no space at the cut (trimmed)
    const long = labelRow(name, [], side, 70, scale, measure);
    expect(long.name.text.endsWith(ELLIPSIS)).toBe(true);
    expect(long.name.width).toBeLessThanOrEqual(2 * side + 1e-9);
    // The longest prefix that fits: one more code point would not.
    const kept = [...long.name.text].length - 1;
    const pad = long.name.width - measure(long.name.text, long.font, false);
    const more = `${name.slice(0, kept + 1)}${ELLIPSIS}`;
    expect(measure(more, long.font, false) + pad).toBeGreaterThan(2 * side);
    // A 2×2 footprint has room for twice as much.
    expect([...labelRow(name, [], 140, 70, scale, measure).name.text].length).toBeGreaterThan(
      kept + 1,
    );
    // Code points, not UTF-16 units.
    expect(cutToWidth("🐺🐺🐺🐺", 3 * 5, 10, measure)).toBe(`🐺🐺${ELLIPSIS}`);
  });

  test("FR-MAP-43 BL-04 badges in a row above the name, same height, inside the footprint", () => {
    const r = labelRow(
      "Goblin",
      [
        { id: "cbt-token-out", label: "Out" },
        { id: "x-other", label: "Hex" },
      ],
      70,
      70,
      2,
      measure,
    );
    const [out, other] = r.badges;
    expect(out?.id).toBe("cbt-token-out");
    expect(out?.height).toBe(r.name.height);
    // One row (both fit 70 px), right above the name, in registry order, centred.
    const gap = r.font * 0.3;
    expect(out?.y).toBeCloseTo(r.name.y - r.name.height - gap);
    expect(other?.y).toBe(out?.y as number);
    expect(other?.x).toBeGreaterThan((out?.x ?? 0) + (out?.width ?? 0));
    expect(((out?.x ?? 0) + (other?.x ?? 0) + (other?.width ?? 0)) / 2).toBeCloseTo(35);
    for (const b of r.badges) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(70);
    }
    // The name stays centred on the footprint with badges present.
    expect(r.name.x + r.name.width / 2).toBeCloseTo(35);
  });

  /** Two pills (map px, relative to their own token) overlap once `dx` / `dy` apart. */
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
    dx: number,
    dy: number,
  ) =>
    a.x < b.x + dx + b.width &&
    b.x + dx < a.x + a.width &&
    a.y < b.y + dy + b.height &&
    b.y + dy < a.y + a.height;

  test("FR-MAP-43 BL-04 a Dying badge never covers an adjacent token's name (sim-6 Town: Thorn dying next to Mira)", () => {
    // Town at the 48 px fit floor: 70 px cells at scale 48 / 70.
    const scale = 48 / 70;
    const thorn = labelRow(
      "Thorn",
      [{ id: "cbtx-token-death", label: "Dying" }],
      70,
      70,
      scale,
      measure,
    );
    const mira = labelRow("Mira", [], 70, 70, scale, measure);
    const dying = thorn.badges[0];
    if (!dying) throw new Error("no badge");
    // Inside Thorn's own footprint.
    expect(dying.x).toBeGreaterThanOrEqual(0);
    expect(dying.x + dying.width).toBeLessThanOrEqual(70);
    expect(dying.y).toBeGreaterThanOrEqual(0);
    expect(dying.y + dying.height).toBeLessThanOrEqual(70);
    // Neighbours right, left, above, below and diagonal: their names stay uncovered.
    for (const [dx, dy] of [
      [70, 0],
      [-70, 0],
      [0, -70],
      [0, 70],
      [70, -70],
      [-70, -70],
    ] as const) {
      expect(overlaps(dying, mira.name, dx, dy) ? `covers the name at ${dx},${dy}` : "ok").toBe(
        "ok",
      );
    }
    // Nor Thorn's own name.
    expect(overlaps(dying, thorn.name, 0, 0)).toBe(false);
  });

  test("FR-MAP-43 BL-04 many badges wrap into rows upwards; a badge wider than the footprint is cut", () => {
    const r = labelRow(
      "Elite Goblin Warrior",
      [
        { id: "cbtx-token-death", label: "Dying" },
        { id: "fog-token-fogged", label: "Fog" },
        { id: "x-long", label: "Invisible and very long" },
      ],
      70,
      70,
      1,
      measure,
    );
    const ys = [...new Set(r.badges.map((b) => b.y))];
    expect(ys.length).toBeGreaterThan(1);
    // Rows stack upwards from just above the name.
    expect(Math.max(...ys)).toBeLessThan(r.name.y);
    for (const b of r.badges) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(70 + 1e-9);
    }
    const long = r.badges.find((b) => b.id === "x-long");
    expect(long?.text.endsWith(ELLIPSIS)).toBe(true);
    // Registry order kept.
    expect(r.badges.map((b) => b.id)).toEqual(["cbtx-token-death", "fog-token-fogged", "x-long"]);
  });

  test("FR-MAP-43 BL-04 at 48 px cells three badges never rise above the footprint: the rest collapses into '+N' (walkthrough F1)", () => {
    const scale = 48 / 70;
    const three = [
      { id: "cbt-token-out", label: "Out" },
      { id: "fog-token-fogged", label: "Fog" },
      { id: "vis-token-invisible", label: "Invisible" },
    ];
    const r = labelRow("Goblin 3", three, 70, 70, scale, measure);
    const above = labelRow("Goblin 5", [], 70, 70, scale, measure);
    for (const b of r.badges) {
      // Inside the footprint, and clear of the upper neighbour's name (one cell up).
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(70 + 1e-9);
      expect(overlaps(b, above.name, 0, -70) ? `${b.id} covers the name above` : "ok").toBe("ok");
      expect(overlaps(b, r.name, 0, 0)).toBe(false);
    }
    // Two rows fit: Out, then "+2" (Fog + "+1" is wider than the footprint), registry order.
    expect(r.badges.map((b) => b.id)).toEqual(["cbt-token-out", MORE_BADGE_ID]);
    const more = r.badges[1];
    expect(more?.text).toBe("+2");
    expect(more?.full).toBe("Fog, Invisible");
    expect(r.badges[0]?.full).toBeUndefined();
    // At 70 px cells (scale 1) the font is smaller: all three fit, no "+N".
    const big = labelRow("Goblin 3", three, 70, 70, 1, measure);
    expect(big.badges.some((b) => b.id === MORE_BADGE_ID)).toBe(false);
    for (const b of big.badges) expect(b.y).toBeGreaterThanOrEqual(big.font * 0.6);
  });

  test("FR-MAP-42 label: layer order map < grid < tokens < labels < pointers", () => {
    const C = () => null;
    const layers = orderLayers([
      { id: "pointers", order: LAYER_ORDER.pointers, layer: "top", component: C },
      { id: "labels", order: LAYER_ORDER.labels, layer: "objects", component: C },
      { id: "tokens", order: LAYER_ORDER.tokens, layer: "objects", component: C },
      { id: "grid", order: LAYER_ORDER.grid, layer: "base", component: C },
      { id: "map", order: LAYER_ORDER.map, layer: "base", component: C },
    ]);
    expect(layers.map((l) => l.id)).toEqual(["map", "grid", "tokens", "labels", "pointers"]);
    expect(LAYER_ORDER.labels).toBeGreaterThan(LAYER_ORDER.fog);
  });
});

describe("FR-MAP-43 cross", () => {
  const view: TokenOverlayView = { client: "player", selected: false, targeting: false };
  const t = { id: "goblin", col: 1, row: 1, size: "medium" } as TokenView;

  test("FR-MAP-43 cross geometry: corner to corner, inset 15 %, stroke 12 %, opacity 0.6", () => {
    const g = crossGeometry(100);
    expect(g.segments).toEqual([
      [15, 15, 85, 85],
      [85, 15, 15, 85],
    ]);
    expect(g.strokeWidth).toBeCloseTo(12);
    expect(CROSS_OPACITY).toBe(0.6);
    const big = crossGeometry(140);
    expect(big.segments[0]).toEqual([21, 21, 119, 119]);
  });

  test("FR-MAP-43 cross render merge: first non-null wins; a throw is ignored; dim kept", () => {
    const errors: string[] = [];
    const overlays: TokenOverlay[] = [
      {
        id: "boom",
        decorate: () => {
          throw new Error("boom");
        },
      },
      { id: "plain", decorate: () => ({ dim: true }) },
      { id: "test-down", decorate: () => ({ cross: { id: "test-cross", tone: "down" } }) },
      { id: "later", decorate: () => ({ cross: { id: "later-cross", tone: "neutral" } }) },
    ];
    const d = decorateToken(overlays, t, emptyStore(), view, (id) => errors.push(id));
    expect(d.cross).toEqual({ id: "test-cross", tone: "down" });
    expect(d.dim).toBe(true);
    expect(errors).toEqual(["boom"]);
    expect(decorateToken([], t, emptyStore(), view).cross).toBeNull();
  });
});
