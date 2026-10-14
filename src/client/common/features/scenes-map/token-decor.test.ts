// Overlay contract `bar` + `icons` (OQ-CBTX-21, FR-CBTX-28/29): merge and renderer geometry.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { decorateToken } from "./decorations";
import { BAR_INSET, barGeometry, ICONS_MAX, iconRow, iconText } from "./token-decor";
import type { TokenIcon, TokenOverlay, TokenOverlayView } from "./token-overlays";

const view: TokenOverlayView = { client: "player", selected: false, targeting: false };
const t = { id: "goblin", col: 1, row: 1, size: "medium" } as TokenView;
const icon = (value: string, label = value): TokenIcon => ({
  id: "test-token-effect",
  icon: "circle",
  tone: "neutral",
  label,
  value,
});

describe("OQ-CBTX-21 token overlay bar + icons", () => {
  test("FR-CBTX-28/29 merge: first non-null bar wins; icons concatenate in registry order; throw ignored", () => {
    const errors: string[] = [];
    const overlays: TokenOverlay[] = [
      { id: "none", decorate: () => null },
      {
        id: "a",
        decorate: () => ({
          bar: { id: "a-bar", fraction: 0.5, tone: "bloodied" },
          icons: [icon("prone")],
        }),
      },
      {
        id: "boom",
        decorate: () => {
          throw new Error("boom");
        },
      },
      {
        id: "b",
        decorate: () => ({
          bar: { id: "b-bar", fraction: null, tone: "full" },
          icons: [icon("poisoned"), icon("custom", "Bless")],
        }),
      },
    ];
    const d = decorateToken(overlays, t, emptyStore(), view, (id) => errors.push(id));
    expect(d.bar).toEqual({ id: "a-bar", fraction: 0.5, tone: "bloodied" });
    expect(d.icons.map((i) => i.value)).toEqual(["prone", "poisoned", "custom"]);
    expect(errors).toEqual(["boom"]);
    const plain = decorateToken([], t, emptyStore(), view);
    expect(plain.bar).toBeNull();
    expect(plain.icons).toEqual([]);
  });

  test("FR-CBTX-28 bar fraction null: band tone at full width, no track (no proportion)", () => {
    const g = barGeometry(100, { id: "b", fraction: null, tone: "bloodied" });
    expect(g.track).toBe(false);
    expect(g.fill).toEqual({ x: 100 * BAR_INSET, width: g.width });
    expect(g.width).toBeCloseTo(80);
    expect(g.temp).toBeNull();
    // Temp HP never shows on a no-proportion bar.
    expect(barGeometry(100, { id: "b", fraction: null, temp: 0.5, tone: "full" }).temp).toBeNull();
  });

  test("FR-CBTX-28 bar fraction: fill over a track, temp as a segment after it, total ≤ 100 %", () => {
    const g = barGeometry(100, { id: "b", fraction: 0.5, temp: 0.25, tone: "full" });
    expect(g.track).toBe(true);
    expect(g.fill?.x).toBeCloseTo(10);
    expect(g.fill?.width).toBeCloseTo(40);
    expect(g.temp?.x).toBeCloseTo(50);
    expect(g.temp?.width).toBeCloseTo(20);
    const capped = barGeometry(100, { id: "b", fraction: 0.75, temp: 0.5, tone: "full" });
    expect((capped.fill?.width ?? 0) + (capped.temp?.width ?? 0)).toBeCloseTo(80);
    const full = barGeometry(100, { id: "b", fraction: 1, temp: 0.3, tone: "full" });
    expect(full.temp).toBeNull();
    const out = barGeometry(100, { id: "b", fraction: 1.7, tone: "full" });
    expect(out.fill?.width).toBeCloseTo(80);
    const empty = barGeometry(100, { id: "b", fraction: 0, temp: 0.1, tone: "bloodied" });
    expect(empty.fill).toBeNull();
    expect(empty.temp?.x).toBeCloseTo(10);
    // On the top edge, inside the footprint.
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.y + g.height).toBeLessThan(20);
  });

  test("FR-CBTX-29 icons: max 4 left to right below the bar, then +N", () => {
    const four = iconRow(
      100,
      ["a", "b", "c", "d"].map((v) => icon(v)),
    );
    expect(four.items).toHaveLength(4);
    expect(four.more).toBeNull();
    const seven = iconRow(
      100,
      ["a", "b", "c", "d", "e", "f", "g"].map((v) => icon(v)),
    );
    expect(ICONS_MAX).toBe(4);
    expect(seven.items.map((c) => c.icon.value)).toEqual(["a", "b", "c", "d"]);
    expect(seven.more).toMatchObject({ text: "+3", count: 3 });
    const xs = [...seven.items.map((c) => c.x), seven.more?.x ?? 0];
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // The whole row fits the footprint, below the bar.
    const last = seven.more;
    expect((last?.x ?? 0) + (last?.size ?? 0)).toBeLessThanOrEqual(100);
    const bar = barGeometry(100, { id: "b", fraction: 1, tone: "full" });
    expect(seven.items[0]?.y).toBeGreaterThan(bar.y + bar.height);
    expect(iconRow(100, []).items).toEqual([]);
  });

  test("FR-CBTX-29 icon initials: condition, custom, exhaustion with level", () => {
    expect(iconText("Prone")).toBe("Pr");
    expect(iconText("Exhaustion 2")).toBe("E2");
    expect(iconText("bless")).toBe("Bl");
    expect(iconText("X")).toBe("X");
    expect(iconText("  ")).toBe("?");
  });
});
