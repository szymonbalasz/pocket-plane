// Player Preferences (FR-SHELL-71, -72, -75): the registered window and sections, section owners
// against the specs' front matter.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyStore } from "@shared/protocol/store";
import {
  PREFS_KIND,
  sectionIdProblems,
  shownSections,
} from "@ui/features/play-shell/PreferencesWindow";
import { playerPrefSections } from "../../pref-sections";
import { playerWindows } from "../../windows";

/** Every spec's `prefix:` front matter, lowercased (FR-SHELL-75). */
function specPrefixes(): Set<string> {
  const dir = fileURLToPath(new URL("../../../../../docs/specs/", import.meta.url));
  const out = new Set<string>();
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith(".md")) continue;
    const m = /^prefix:\s*([A-Z]+)\s*$/m.exec(readFileSync(path.join(dir, f), "utf8"));
    if (m?.[1]) out.add(m[1].toLowerCase());
  }
  return out;
}

test("FR-SHELL-71 prefs window (player): shell.prefs registered with no launcher entry, restoreOpen false, S3 numbers", () => {
  const def = playerWindows.get(PREFS_KIND);
  expect(def).toMatchObject({
    title: "Preferences",
    defaultSize: { w: 360, h: 560 },
    minOpenH: 400,
    minSize: { w: 320, h: 280 },
    defaultPosition: { anchor: "top-right", dx: 12 },
    restoreOpen: false,
  });
  expect(def?.launcher).toBeUndefined();
  expect(def?.defaultOpen).toBeFalsy();
});

test("FR-SHELL-72 sections (player): Sound then Layout (colour and dice come with PF2); ids unique", () => {
  expect(shownSections(playerPrefSections, emptyStore()).map((s) => s.id)).toEqual([
    "shell.sound",
    "shell.layout",
  ]);
  const ids = playerPrefSections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("FR-SHELL-75 section owners (player): every id's prefix is a docs/specs front-matter prefix; no duplicate", () => {
  expect(sectionIdProblems(playerPrefSections, specPrefixes())).toEqual([]);
});
