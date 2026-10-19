import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { decorateToken } from "./decorations";
import {
  CROSS_OPACITY,
  crossGeometry,
  cutToWidth,
  ELLIPSIS,
  hoverTarget,
  LABEL_GAP_PX,
  LABEL_MIN_SCREEN_FONT,
  LABEL_PILL_SHARE,
  type LabelBox,
  labelMetrics,
  labelRow,
  layoutLabels,
  type Measure,
  MORE_BADGE_ID,
  namePill,
  pillRect,
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

  test("FR-MAP-57 many badges wrap into rows upwards; a badge whose text doesn't fit is an icon chip, never cut text", () => {
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
    // An icon chip: 16 screen px square, no text, centred on its row; nothing is ever cut.
    expect(long).toMatchObject({ compact: true, text: "", width: 16, height: 16 });
    expect(r.badges.some((b) => b.text.endsWith(ELLIPSIS))).toBe(false);
    // Centred on a badge row: k rows (pill + gap each) above the name.
    const rowTop = (long?.y ?? 0) + (long?.height ?? 0) / 2 - r.name.height / 2;
    const k = (r.name.y - rowTop) / (r.name.height + r.font * 0.3);
    expect(k).toBeCloseTo(Math.round(k));
    expect(Math.round(k)).toBeGreaterThanOrEqual(1);
    // Registry order kept.
    expect(r.badges.map((b) => b.id)).toEqual(["cbtx-token-death", "fog-token-fogged", "x-long"]);
  });

  test("FR-MAP-43 BL-04 at 48 px cells badges never rise above the footprint: the rest collapses into '+N' (walkthrough F1; FR-MAP-57 chips)", () => {
    const scale = 48 / 70;
    const three = [
      { id: "cbt-token-out", label: "Out" },
      { id: "fog-token-fogged", label: "Fog" },
      { id: "vis-token-invisible", label: "Invisible" },
    ];
    // FR-MAP-57: Invisible is an icon chip now, so all three fit in two rows.
    const chips = labelRow("Goblin 3", three, 70, 70, scale, measure);
    expect(chips.badges.map((b) => [b.id, b.compact === true])).toEqual([
      ["cbt-token-out", false],
      ["fog-token-fogged", false],
      ["vis-token-invisible", true],
    ]);
    const four = [...three, { id: "x-hex", label: "Hex" }];
    const r = labelRow("Goblin 3", four, 70, 70, scale, measure);
    const above = labelRow("Goblin 5", [], 70, 70, scale, measure);
    for (const b of r.badges) {
      // Inside the footprint, and clear of the upper neighbour's name (one cell up).
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(70 + 1e-9);
      expect(overlaps(b, above.name, 0, -70) ? `${b.id} covers the name above` : "ok").toBe("ok");
      expect(overlaps(b, r.name, 0, 0)).toBe(false);
    }
    // Two rows fit: Out, then "+3" (Fog + "+1" is wider than the footprint), registry order.
    expect(r.badges.map((b) => b.id)).toEqual(["cbt-token-out", MORE_BADGE_ID]);
    const more = r.badges[1];
    expect(more?.text).toBe("+3");
    expect(more?.full).toBe("Fog, Invisible, Hex");
    expect(r.badges[0]?.full).toBeUndefined();
    // At 70 px cells (scale 1) the font is smaller: all four fit, no "+N".
    const big = labelRow("Goblin 3", four, 70, 70, 1, measure);
    expect(big.badges.some((b) => b.id === MORE_BADGE_ID)).toBe(false);
    for (const b of big.badges) expect(b.y).toBeGreaterThanOrEqual(big.font * 0.6);
  });

  test("FR-MAP-43 BL-35 below 48 px cells a token's badges squeeze into a chip + '+N' or a '+N', never vanish or cover a name", () => {
    const three = [
      { id: "fog-token-invisible", label: "Invisible" },
      { id: "cnd-poisoned", label: "Poisoned" },
      { id: "cnd-prone", label: "Prone" },
    ];
    const labels = three.map((b) => b.label);
    const shown = (px: number) => {
      const scale = px / 70;
      const r = labelRow("Goblin 3", three, 70, 70, scale, measure);
      const neighbour = labelRow("Goblin 5", [], 70, 70, scale, measure);
      for (const b of r.badges) {
        // Inside the footprint, clear of its own name and every neighbour's.
        expect(b.x).toBeGreaterThanOrEqual(-1e-9);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(70 + 1e-9);
        expect(overlaps(b, r.name, 0, 0) ? `${px}: ${b.id} covers its name` : "ok").toBe("ok");
        for (const [dx, dy] of [
          [70, 0],
          [-70, 0],
          [0, -70],
          [0, 70],
          [70, -70],
          [-70, -70],
          [70, 70],
          [-70, 70],
        ] as const) {
          const hit = overlaps(b, neighbour.name, dx, dy);
          expect(hit ? `${px}: ${b.id} covers the name at ${dx},${dy}` : "ok").toBe("ok");
        }
      }
      // Every badge is drawn or listed in the "+N"'s hover.
      const more = r.badges.find((b) => b.id === MORE_BADGE_ID);
      const drawn = r.badges.filter((b) => b.id !== MORE_BADGE_ID);
      const listed = more?.full?.split(", ") ?? [];
      expect(more?.text).toBe(`+${listed.length}`);
      expect([...drawn.map((b) => three.find((t) => t.id === b.id)?.label), ...listed]).toEqual(
        labels,
      );
      return r.badges.map((b) => [b.id, b.compact === true]);
    };
    // 44 px (the default fit with windows open): Invisible stays as an icon chip, "+2" for the rest.
    expect(shown(44)).toEqual([
      ["fog-token-invisible", true],
      [MORE_BADGE_ID, false],
    ]);
    // 40 px: the chip shrinks to the row's height so both still fit.
    expect(shown(40)).toEqual([
      ["fog-token-invisible", true],
      [MORE_BADGE_ID, false],
    ]);
    // 32 px: no room for both: one "+3" pill.
    expect(shown(32)).toEqual([[MORE_BADGE_ID, false]]);
    // 24 px (the fit floor): no full row fits between the names: a smaller "+3", centred.
    expect(shown(24)).toEqual([[MORE_BADGE_ID, false]]);
    const tiny = labelRow("Goblin 3", three, 70, 70, 24 / 70, measure);
    const more = tiny.badges[0];
    expect(more?.height).toBeLessThan(tiny.name.height);
    expect(more?.font).toBeCloseTo((more?.height ?? 0) / 1.2);
    expect((more?.y ?? 0) + (more?.height ?? 0) / 2).toBeCloseTo(35);
    expect((more?.x ?? 0) + (more?.width ?? 0) / 2).toBeCloseTo(35);
    // One badge at 24 px: its icon chip, no "+1".
    const one = labelRow("Goblin 3", three.slice(0, 1), 70, 70, 24 / 70, measure);
    expect(one.badges).toMatchObject([{ id: "fog-token-invisible", compact: true, text: "" }]);
    // Too small to read (a 6 px row): nothing, still never over a name.
    expect(labelRow("Goblin 3", three, 70, 70, 16 / 70, measure).badges).toEqual([]);
    // At 48 px and up the rows are unchanged: no squeeze, two rows.
    const big = labelRow("Goblin 3", three, 70, 70, 48 / 70, measure);
    expect(big.badges.some((b) => b.id === MORE_BADGE_ID || b.font !== undefined)).toBe(false);
    expect(new Set(big.badges.map((b) => b.y + b.height / 2)).size).toBe(2);
  });

  test("FR-MAP-43 BL-35 a '+N' hiding a Dying badge takes the danger tone (24–35 px and full rows)", () => {
    const dying = { id: "cbtx-token-death", label: "Dying", tone: "down" as const };
    const invisible = { id: "fog-token-invisible", label: "Invisible", tone: "neutral" as const };
    const more = (r: ReturnType<typeof labelRow>) => r.badges.find((b) => b.id === MORE_BADGE_ID);
    // A Dying PC with another badge, 24–35 px: one "+2" in Dying's tone, hover lists both.
    for (const px of [24, 28, 32, 35]) {
      const r = labelRow("Thorn", [dying, invisible], 70, 70, px / 70, measure);
      expect(r.badges.map((b) => [b.id, b.text, b.tone, b.full])).toEqual([
        [MORE_BADGE_ID, "+2", "down", "Dying, Invisible"],
      ]);
    }
    // Dying drawn as its own chip: the "+2" for the rest stays neutral.
    const poisoned = { id: "cnd-poisoned", label: "Poisoned", tone: "neutral" as const };
    const shown = labelRow("Thorn", [dying, invisible, poisoned], 70, 70, 40 / 70, measure);
    expect(shown.badges.map((b) => [b.id, b.compact === true, b.tone])).toEqual([
      ["cbtx-token-death", true, undefined],
      [MORE_BADGE_ID, false, undefined],
    ]);
    // Full rows (48 px): a Dying hidden in the "+N" colours it too; neutral-only stays neutral.
    const four = [
      { id: "cbt-token-out", label: "Out" },
      { id: "fog-token-fogged", label: "Fog" },
      invisible,
    ];
    const at48 = (b: typeof four) => more(labelRow("Thorn", b, 70, 70, 48 / 70, measure));
    expect(at48([...four, dying])).toMatchObject({ text: "+3", tone: "down" });
    expect(at48([...four, { id: "x-hex", label: "Hex" }])?.tone).toBeUndefined();
    // Bloodied ranks below down.
    const bloodied = { id: "x-b", label: "Bloodied", tone: "bloodied" as const };
    expect(at48([...four, bloodied])?.tone).toBe("bloodied");
    expect(at48([...four, bloodied, dying])?.tone).toBe("down");
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

describe("FR-MAP-56 label collisions", () => {
  // `mt-crowd` on the 70 px battlemap at the DM's 1440×900 fit (scale 0.72): Goblin Sneak (4, 9),
  // Goblin Sneak 2 (5, 9) side by side, Crypt Ogre (Large) at (4, 10) below them.
  const scale = 0.72;
  const cell = 70;
  const m = labelMetrics(cell, scale);
  const gap = LABEL_GAP_PX / scale;
  const box = (id: string, name: string, col: number, row: number, n = 1): LabelBox => ({
    id,
    x: col * cell,
    bottom: (row + n) * cell,
    side: n * cell,
    width: namePill(name, 2 * n * cell, m, measure).width,
  });
  const sneak = box("sneak", "Goblin Sneak", 4, 9);
  const sneak2 = box("sneak-2", "Goblin Sneak 2", 5, 9);
  const ogre = box("ogre", "Crypt Ogre", 4, 10, 2);
  const lurker = box("lurker", "Goblin Lurker the Long", 17, 11);
  const disjoint = (a: ReturnType<typeof pillRect>, b: ReturnType<typeof pillRect>) =>
    a.x + a.w + gap <= b.x + 1e-9 || b.x + b.w + gap <= a.x + 1e-9;

  test("FR-MAP-56 label layout: colliding neighbours are both cut to their footprint with …; the rest keep up to 2 × theirs", () => {
    // Both wider than a cell: at full width the pills overlap.
    expect(sneak.width).toBeGreaterThan(cell);
    expect(
      disjoint(pillRect(sneak, sneak.width, m.pillH), pillRect(sneak2, sneak2.width, m.pillH)),
    ).toBe(false);
    const fits = layoutLabels([lurker, ogre, sneak2, sneak], m.pillH, gap);
    expect(fits.get("sneak")).toEqual({ width: cell - gap, cut: true });
    expect(fits.get("sneak-2")).toEqual({ width: cell - gap, cut: true });
    // A row below (Crypt Ogre) and a lone label (wider than its cell) are not cut.
    expect(fits.get("ogre")).toEqual({ width: ogre.width, cut: false });
    expect(fits.get("lurker")).toEqual({ width: lurker.width, cut: false });
    expect(lurker.width).toBeGreaterThan(cell);
    // After the cut: the 4 px gap between them.
    const a = pillRect(sneak, fits.get("sneak")?.width ?? 0, m.pillH);
    const b = pillRect(sneak2, fits.get("sneak-2")?.width ?? 0, m.pillH);
    expect(disjoint(a, b)).toBe(true);
    expect(b.x - (a.x + a.w)).toBeCloseTo(gap);
    // Drawn at that width: the text ends with "…" and fits it.
    const row = labelRow("Goblin Sneak", [], cell, cell, scale, measure, cell - gap);
    expect(row.name.text.endsWith(ELLIPSIS)).toBe(true);
    expect(row.name.width).toBeLessThanOrEqual(cell - gap + 1e-9);
    // Input order doesn't matter (laid out by row, then column).
    expect([...layoutLabels([sneak, sneak2, ogre, lurker], m.pillH, gap)].sort()).toEqual(
      [...fits].sort(),
    );
  });

  test("FR-MAP-56 label layout: short neighbours (inside their footprints) and labels a row apart are never cut", () => {
    const mira = box("mira", "Mira", 2, 7);
    const thorn = box("thorn", "Thorn", 3, 7);
    const below = box("below", "Goblin Sneak 2", 2, 8);
    const fits = layoutLabels([mira, thorn, below], m.pillH, gap);
    for (const id of ["mira", "thorn", "below"]) expect(fits.get(id)?.cut).toBe(false);
    // One long label next to a short one: only a real overlap cuts.
    const long = box("long", "Goblin Sneak", 4, 7);
    const far = box("far", "Mira", 6, 7);
    expect(layoutLabels([long, far], m.pillH, gap).get("long")?.cut).toBe(false);
  });

  test("FR-MAP-56 hover: the label under the pointer (topmost first), else the token's footprint; drawn in full", () => {
    const fits = layoutLabels([sneak, sneak2, ogre], m.pillH, gap);
    const drawn = [sneak, sneak2, ogre].map((b) => ({ ...b, drawn: fits.get(b.id)?.width ?? 0 }));
    // On Goblin Sneak's (cut) pill, on the grid line between rows 9 and 10.
    expect(hoverTarget({ x: 4.5 * cell, y: 10 * cell }, drawn, m.pillH)).toBe("sneak");
    // Inside Goblin Sneak 2's footprint, above the pills.
    expect(hoverTarget({ x: 5.5 * cell, y: 9.4 * cell }, drawn, m.pillH)).toBe("sneak-2");
    // Inside Crypt Ogre's footprint (the Sneaks' pills reach into its top edge).
    expect(hoverTarget({ x: 5 * cell, y: 11 * cell }, drawn, m.pillH)).toBe("ogre");
    expect(hoverTarget({ x: 10, y: 10 }, drawn, m.pillH)).toBeNull();
    // Two full-width pills overlapping: the one drawn last (on top) wins.
    const full = [sneak, sneak2].map((b) => ({ ...b, drawn: b.width }));
    const overlap = { x: 5 * cell + 2, y: 10 * cell };
    expect(hoverTarget(overlap, full, m.pillH)).toBe("sneak-2");
    expect(hoverTarget(overlap, [...full].reverse(), m.pillH)).toBe("sneak");
    // Hovered: the whole name, never cut (not even at 2 × the footprint).
    const long = "Goblin Sneak the Unreasonably Long";
    expect(labelRow(long, [], cell, cell, scale, measure).name.text.endsWith(ELLIPSIS)).toBe(true);
    expect(labelRow(long, [], cell, cell, scale, measure, Number.POSITIVE_INFINITY).name.text).toBe(
      long,
    );
  });

  test("FR-MAP-56 labels (names and badge rows) draw above every token decoration: the labels Group follows the tokens in the objects layer", () => {
    expect(LAYER_ORDER.labels).toBeGreaterThan(LAYER_ORDER.tokens);
    expect(LAYER_ORDER.scnEdit).toBeGreaterThan(LAYER_ORDER.labels);
  });
});
