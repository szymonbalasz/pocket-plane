import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// FR-SHELL-30 / FR-CHAR-25: hover hints are the shared Tooltip. A native `title` can't be delayed
// or suppressed, so it may stay only on non-interactive truncated text.

const CLIENT = join(import.meta.dir, "../../..");
/** Tags that render a button or link. */
const INTERACTIVE = new Set(["button", "a", "Button", "RollButton", "ToggleGroupItem"]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

/** JSX opening tags: name + the attribute text outside `{…}` (string literals kept). */
function openingTags(src: string): { name: string; attrs: string; line: number }[] {
  const tags: { name: string; attrs: string; line: number }[] = [];
  const re = /<([A-Za-z][\w.]*)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (/[\w)\]]/.test(src[m.index - 1] ?? "")) continue; // generics, not JSX
    let depth = 0;
    let quote = "";
    let attrs = "";
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i] as string;
      if (quote) {
        if (depth === 0) attrs += ch;
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
      if (depth === 0) attrs += ch;
    }
    tags.push({ name: m[1] as string, attrs, line: src.slice(0, m.index).split("\n").length });
  }
  return tags;
}

test("FR-SHELL-30 no native title on interactive elements in src/client", () => {
  const bad: string[] = [];
  for (const file of tsxFiles(CLIENT)) {
    for (const t of openingTags(readFileSync(file, "utf8"))) {
      if (!/(^|\s)title=/.test(t.attrs)) continue;
      const intrinsic = /^[a-z]/.test(t.name);
      const interactive = INTERACTIVE.has(t.name) || /role="button"/.test(t.attrs);
      // Components' `title` props (dialog headings) aren't native titles.
      if (!intrinsic && !interactive) continue;
      if (interactive || !/\btruncate\b/.test(t.attrs)) {
        bad.push(`${relative(CLIENT, file)}:${t.line} <${t.name}>`);
      }
    }
  }
  expect(bad).toEqual([]);
}, 30_000); // scans every .tsx under src/client: over the 5 s default while other suites run

test("FR-CHAR-25 roll buttons carry no title; the hint is a Tooltip", () => {
  const src = readFileSync(
    join(CLIENT, "common/features/character-sheet/CharacterSheet.tsx"),
    "utf8",
  );
  const rollButtons = openingTags(src).filter((t) => t.name === "RollButton");
  expect(rollButtons.length).toBeGreaterThanOrEqual(2);
  for (const t of rollButtons) expect(t.attrs).not.toMatch(/(^|\s)title=/);
  // FR-DICEX-51: `RollButton` draws the Tooltip; the sheet passes its text as `hint`.
  expect(src).toContain("hint={ROLL_HINT}");
  expect(src).not.toMatch(/title=\{proficient/);
});
