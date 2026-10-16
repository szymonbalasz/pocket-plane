// FR-CMP-18 player registry + layout (seams S8): `cmp.compendium` default closed, launcher
// "Compendium", 440×560 (min 320×360); fits 1280×720 and keeps its size at 1600×900; opens at an
// edge. FR-CMP-13: the player REST client sends `Authorization: Player <link token>`.
import { expect, test } from "bun:test";
import { clampRect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { touchedEdge } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { playerWindows } from "../../windows";
import { linkTokenFromPath } from "./compendium-window";

const KIND = "cmp.compendium";

test("FR-CMP-18 player registers cmp.compendium: closed by default, launcher Compendium, 440×560, min 320×360", () => {
  const d = playerWindows.get(KIND);
  expect(d).toMatchObject({ defaultSize: { w: 440, h: 560 }, minSize: { w: 320, h: 360 } });
  expect(d?.defaultOpen).toBeFalsy();
  expect(d?.launcher?.label).toBe("Compendium");
});

test("FR-CMP-18 player window fits 1280×720, keeps its size at 1600×900, opens at an edge", () => {
  const d = playerWindows.get(KIND);
  if (!d) throw new Error("not registered");
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1600, h: 900 },
  ]) {
    const r = fittedDefaultRect(d, vp);
    expect(r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= vp.w && r.y + r.h <= vp.h).toBe(true);
    const ctx = {
      registry: playerWindows,
      viewport: vp,
      available: new Set(playerWindows.defs.map((x) => x.kind)),
    };
    const ws = [...reduce(defaultLayout(playerWindows, vp), { type: "open", kind: KIND }, ctx)];
    const w = ws.find((x) => x.kind === KIND);
    if (!w) throw new Error("not opened");
    expect(touchedEdge(clampRect(w, vp), vp)).not.toBeNull();
  }
  expect(fittedDefaultRect(d, { w: 1600, h: 900 })).toMatchObject(d.defaultSize);
});

test("FR-CMP-13 player link token from /p/<token> for Authorization: Player", () => {
  expect(linkTokenFromPath("/p/abc%2Fdef")).toBe("abc/def");
  expect(linkTokenFromPath("/p/tok123/")).toBe("tok123");
  expect(linkTokenFromPath("/")).toBeNull();
});
