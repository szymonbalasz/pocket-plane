// Kit parity K10 (K6 gaps 5, 8, 12): window titles at the kit's 17 px without a font-size change,
// the tool rail's 38 px buttons inside the rail's clear strip, and no native `<select>` left in
// the areas K10 converted to the shared Select. Read as source; the look is the K10 walkthrough.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RAIL_CLEAR } from "../features/play-shell/geometry";
import { RAIL_TOOL } from "../features/scenes-map/ToolRail";

const HERE = import.meta.dir;
const read = (p: string) => readFileSync(join(HERE, p), "utf8");
const GILT = read("gilt.css");
const FONTS = read("fonts.css");

describe("kit parity K10: chrome", () => {
  test("FR-KIT-07 FR-THEME-05 K10 window titles at the kit's 17 px: gilt draws the title face 17 / 14 larger by size-adjust (same file), the 32 px bar and its 14 px type unchanged", () => {
    const face = /@font-face\s*{[^}]*font-family: "Gilt Window Title";[^}]*}/.exec(GILT)?.[0] ?? "";
    const adjust = Number(/size-adjust: ([\d.]+)%/.exec(face)?.[1]);
    expect(Math.abs((adjust / 100) * 14 - 17)).toBeLessThan(0.01);
    const src = /src: (url\([^)]+\))/.exec(face)?.[1];
    expect(src).toBeDefined();
    expect(FONTS).toContain(`src: ${src}`);
    expect(GILT).toMatch(
      /\[data-testid="ui-window-title"\] {\s*font-family: "Gilt Window Title", var\(--font-title\);/,
    );
    const shell = read("../features/play-shell/ShellWindow.tsx");
    expect(shell).toMatch(/data-testid="ui-window-title"\s+className="flex h-8 [^"]*text-sm/);
  });

  test("FR-KIT-92 K10 tool rail at the kit's 38 px: every rail button 38 px with a 20 px icon, the rail (p-1, border, ml-2) inside RAIL_CLEAR with its 12 px gap", () => {
    expect(RAIL_TOOL.split(" ")).toEqual(["size-[38px]", "[&_svg]:size-5"]);
    const rail = read("../features/scenes-map/ToolRail.tsx");
    expect(rail).toContain('className="relative ml-2 flex flex-col gap-1 rounded-md border');
    expect(8 + 1 + 4 + 38 + 4 + 1 + 12).toBeLessThanOrEqual(RAIL_CLEAR);
    for (const f of [
      "../features/scenes-map/ToolRail.tsx",
      "../../dm/features/scenes-map/DmTools.tsx",
      "../../dm/features/scene-tools/layers-popover.tsx",
    ])
      expect([f, read(f).includes('"size-9"') || read(f).includes('"relative size-9"')]).toEqual([
        f,
        false,
      ]);
  });

  test("FR-KIT-03 K10 no native select: Roll requests, the dice tray, macros and reminders use the shared Select", () => {
    const left: string[] = [];
    for (const dir of ["../features/dice-extras", "../features/reminders"]) {
      for (const f of readdirSync(join(HERE, dir))) {
        if (!f.endsWith(".tsx") || f.includes(".test.")) continue;
        if (/<select\b/.test(read(`${dir}/${f}`))) left.push(`${dir}/${f}`);
      }
    }
    expect(left).toEqual([]);
  });
});
