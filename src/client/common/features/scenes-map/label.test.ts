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

  test("FR-MAP-43 badges in the label row, after the name, same height", () => {
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
    expect(out?.y).toBe(r.name.y);
    expect(out?.height).toBe(r.name.height);
    expect(out?.x).toBeGreaterThan(r.name.x + r.name.width);
    expect(other?.x).toBeGreaterThan((out?.x ?? 0) + (out?.width ?? 0));
    // The name stays centred on the footprint with badges present.
    expect(r.name.x + r.name.width / 2).toBeCloseTo(35);
  });

  test("FR-MAP-42 label: layer order map < grid < tokens < labels < pointers", () => {
    const C = () => null;
    const layers = orderLayers([
      { id: "pointers", order: LAYER_ORDER.pointers, component: C },
      { id: "labels", order: LAYER_ORDER.labels, component: C },
      { id: "tokens", order: LAYER_ORDER.tokens, component: C },
      { id: "grid", order: LAYER_ORDER.grid, component: C },
      { id: "map", order: LAYER_ORDER.map, component: C },
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
