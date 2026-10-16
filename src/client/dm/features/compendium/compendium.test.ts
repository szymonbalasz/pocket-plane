// FR-CMP-18 DM registry + layout (seams S8): `cmp.compendium` default closed, launcher
// "Compendium", 440×560 (min 320×360); fits 1280×720 and keeps its size at 1600×900; opens at an
// edge on the default layout, clear of the default-open windows (or `minOpenH` on top at an edge).
// FR-CMP-22: the DM token menu has "Stat block" on monster tokens only.
import { expect, mock, test } from "bun:test";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { clampRect, type Rect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { touchedEdge } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");
const { menuFor } = await import("../scenes-map/token-menu");

const KIND = "cmp.compendium";
const SIZES = [
  { w: 1280, h: 720 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("FR-CMP-18 DM registers cmp.compendium: closed by default, launcher Compendium, 440×560, min 320×360", () => {
  const d = dmWindows.get(KIND);
  expect(d).toMatchObject({
    title: "Compendium",
    defaultSize: { w: 440, h: 560 },
    minSize: { w: 320, h: 360 },
  });
  expect(d?.defaultOpen).toBeFalsy();
  expect(d?.launcher?.label).toBe("Compendium");
});

test("FR-CMP-18 DM window fits 1280×720, keeps its size at 1600×900, opens at an edge clear of the default layout", () => {
  const d = dmWindows.get(KIND);
  if (!d) throw new Error("not registered");
  for (const vp of [SIZES[0], SIZES[2]] as { w: number; h: number }[]) {
    const r = fittedDefaultRect(d, vp);
    expect(r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= vp.w && r.y + r.h <= vp.h).toBe(true);
  }
  expect(fittedDefaultRect(d, { w: 1600, h: 900 })).toMatchObject(d.defaultSize);
  for (const vp of SIZES) {
    const ctx = {
      registry: dmWindows,
      viewport: vp,
      available: new Set(dmWindows.defs.map((x) => x.kind)),
    };
    const ws = [...reduce(defaultLayout(dmWindows, vp), { type: "open", kind: KIND }, ctx)];
    const rects = ws
      .filter((w) => w.state === "open")
      .map((w) => ({ kind: w.kind, ...clampRect(w, vp) }));
    const r = rects.find((w) => w.kind === KIND) as Rect & { kind: string };
    const hit = rects.filter((b) => b.kind !== KIND && overlaps(r, b));
    expect(touchedEdge(r, vp)).not.toBeNull();
    if (hit.length > 0) expect([vp.w, r.h]).toEqual([vp.w, 400]);
    else expect(r.h).toBeGreaterThanOrEqual(360);
  }
});

const token = (characterId: string | null): TokenRecord =>
  ({ id: "t1", definitionId: "d1", characterId }) as TokenRecord;

test("FR-CMP-22 DM token menu: Stat block on monster tokens, not on character tokens", () => {
  expect(menuFor(token(null)).map((e) => e.id)).toContain("cmp.statblock");
  expect(menuFor(token("c1")).map((e) => e.id)).not.toContain("cmp.statblock");
});
