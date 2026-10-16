// FR-CMP-16 boundary: `imported-entity` is lazy (FR-CMP-15), so a store read of it outside
// `useDefinitions` sees nothing until something loaded it. No client file but `definitions.ts`
// may name the type (its constant or its string); tests are exempt (they build fake stores).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../../..");
const CLIENT = "src/client";
const OWNER = "src/client/common/features/compendium/definitions.ts";
/**
 * Call sites not switched yet (compendium §14: after R7 merges; the sheet under the sheet lock).
 * Must shrink to empty in C2; a listed file that no longer reads the type fails the test too.
 */
const PENDING: readonly string[] = [
  "src/client/common/features/character-sheet/CharacterSheet.tsx",
  "src/client/common/features/combat-extras/concentration.tsx",
  "src/client/common/features/effect-modifiers/trigger-owner.ts",
  "src/client/dm/features/combat-extras/add-dialog.tsx",
  "src/client/dm/features/combat-tracker/data.ts",
  "src/client/dm/features/combat-tracker/encounters-window.tsx",
  "src/client/dm/features/effect-modifiers/triggers-dialog.tsx",
  "src/client/dm/features/entities/creatures-window.tsx",
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...files(rel));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Code without comments names the type: the constant, or the string in any quotes. */
function readsImportedEntity(src: string): boolean {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return /\bIMPORTED_ENTITY_TYPE\b|["'`]imported-entity["'`]/.test(code);
}

describe("FR-CMP-16 boundary", () => {
  test("FR-CMP-16 boundary: no imported-entity store read outside useDefinitions", () => {
    const offenders = files(CLIENT).filter(
      (f) => f !== OWNER && readsImportedEntity(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(offenders.filter((f) => !PENDING.includes(f))).toEqual([]);
    // A pending entry that was switched must leave the list (it only ever shrinks).
    expect(PENDING.filter((f) => !offenders.includes(f))).toEqual([]);
    expect(readsImportedEntity(readFileSync(path.join(ROOT, OWNER), "utf8"))).toBe(true);
  });

  test("FR-CMP-16 boundary: the checker catches the constant and the string, not comments", () => {
    expect(readsImportedEntity('useRecords("imported-entity")')).toBe(true);
    expect(readsImportedEntity("s.store.records[IMPORTED_ENTITY_TYPE]")).toBe(true);
    expect(readsImportedEntity("const t = `imported-entity`;")).toBe(true);
    expect(readsImportedEntity("// `imported-entity` via useDefinitions")).toBe(false);
    expect(readsImportedEntity("/* IMPORTED_ENTITY_TYPE */ const x = 1;")).toBe(false);
    expect(readsImportedEntity('const url = "http://x"; // "imported-entity"')).toBe(false);
  });
});
