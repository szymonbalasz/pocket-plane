// Character options from the 5etools import (compendium-expansion X5, FR-CMPX-30–33): feats,
// races with subraces, backgrounds, class options, over the invented 5etools-mini folder.
import { describe, expect, test } from "bun:test";
import { FIVE_ETOOLS_MINI_DIR } from "@fixtures/5etools-mini/prepare";
import { EntryDraft, type EntryDraftOf, entryLine } from "@shared/compendium/schemas";
import type { AdapterRecord } from "../open5e";
import { adaptBook, adaptBookData, srdIndexOf } from ".";
import { abilityText, optionType, prerequisiteText, speedText } from "./options";
import type { FolderData } from "./read";

const allExist = () => true;
const tb1 = adaptBook(FIVE_ETOOLS_MINI_DIR, "TB1", { exists: allExist });
const tb2 = adaptBook(FIVE_ETOOLS_MINI_DIR, "TB2", { exists: allExist });

function rec(key: string, list: readonly AdapterRecord[] = tb1.records) {
  const r = list.find((x) => x.sourceKey === key);
  if (!r) throw new Error(`No record ${key}`);
  return r;
}
function draft<K extends "feat" | "race" | "background" | "option">(
  kind: K,
  key: string,
  list?: readonly AdapterRecord[],
): EntryDraftOf<K> {
  const d = rec(key, list).data;
  if (d.kind !== kind) throw new Error(`${key} is not a ${kind}`);
  return d as EntryDraftOf<K>;
}

const emptyData = (over: Partial<FolderData>): FolderData => ({
  monsters: [],
  monsterTemplates: [],
  legendaryGroups: [],
  spells: [],
  spellClasses: {},
  items: [],
  itemGroups: [],
  baseItems: [],
  itemEntries: [],
  variants: [],
  feats: [],
  races: [],
  subraces: [],
  backgrounds: [],
  optionalFeatures: [],
  unreadable: [],
  ...over,
});
const env = { exists: allExist, srd: srdIndexOf([]) };

describe("FR-CMPX-30 character options", () => {
  test("FR-CMPX-30 every option record parses; no warnings on the mini folder", () => {
    const kinds = new Set(["feat", "race", "background", "option"]);
    const options = [...tb1.records, ...tb2.records].filter((r) => kinds.has(r.kind));
    expect(options).toHaveLength(13);
    for (const r of options) expect(EntryDraft.safeParse(r.data).success).toBe(true);
    const warned = [...tb1.warnings, ...tb2.warnings].filter((w) =>
      /^(feat|race|background|option)\//.test(w.sourceKey),
    );
    expect(warned).toEqual([]);
  });
});

describe("FR-CMPX-31 feats", () => {
  test("FR-CMPX-31 prerequisite, ability increase first, entries as markdown-lite", () => {
    const f = draft("feat", "feat/bolt-adept");
    expect(f.body.prerequisite).toBe("Dexterity 13 or higher");
    expect(f.body.text).toBe(
      [
        "**Ability Score Increase.** +1 to Str or Dex (to a maximum of 20).",
        "You have drilled with the test bow until it is second nature:",
        "- You ignore the loading property of bows you are proficient with.\n" +
          "- Once on each of your turns, you can reroll a 1d4 of bow damage.",
      ].join("\n\n"),
    );
    expect(entryLine(f)).toBe("Feat · Dexterity 13 or higher");
  });

  test("FR-CMPX-31 alternatives read 'or'; no prerequisite → plain Feat line", () => {
    expect(draft("feat", "feat/lucky-hand").body.prerequisite).toBe("Glimmerkin; or 4th level");
    const q = draft("feat", "feat/quick-draw");
    expect(q.body.prerequisite).toBeUndefined();
    expect(entryLine(q)).toBe("Feat");
  });

  test("FR-CMPX-13 a reprint replaces the older book's feat", () => {
    expect(rec("feat/quick-draw").replaces).toEqual(["5et-tb2:feat/quick-draw"]);
    expect(rec("feat/quick-draw", tb2.records).replaces).toBeUndefined();
  });
});

describe("FR-CMPX-32 races", () => {
  test("FR-CMPX-32 a race: abilities, size, speed facts; a nameless subrace folds in", () => {
    const r = draft("race", "race/glimmerkin");
    expect(r.facets).toEqual({});
    expect(r.body.abilities).toBe("Dex +2");
    expect(r.body.size).toBe("Small");
    expect(r.body.speed).toBe("25 ft., climb equal to your walking speed");
    expect(r.body.text).toContain("**Bright Eyes.** You see well in dim light.");
    expect(entryLine(r)).toBe("Small · 25 ft., climb equal to your walking speed");
  });

  test("FR-CMPX-32 a subrace merges with its race: 'Race (Sub)', scores add, overwrite in place", () => {
    const d = draft("race", "race/glimmerkin-deep");
    expect(d.name).toBe("Glimmerkin (Deep)");
    expect(d.facets).toEqual({ parent: "Glimmerkin" });
    expect(d.body.abilities).toBe("Dex +2, Wis +1");
    const traits = [...d.body.text.matchAll(/\*\*([^*]+)\.\*\*/g)].map((m) => m[1]);
    expect(traits).toEqual(["Age", "Glow", "Languages", "Bright Eyes", "Stone Sense"]);
    expect(d.body.text).toContain("**Glow.** Your glow is blue");
    expect(d.body.text).not.toContain("dim light in a 5-foot radius");
    expect(entryLine(d)).toBe("Subrace of Glimmerkin");
  });

  test("FR-CMPX-32 a subrace in another book than its race; its own speed wins", () => {
    const a = draft("race", "race/glimmerkin-ash", tb2.records);
    expect(a.body.abilities).toBe("Dex +2, Con +1");
    expect(a.body.speed).toBe("30 ft.");
    expect(a.body.text).toContain("**Ashen.**");
    expect(tb1.records.some((r) => r.sourceKey === "race/glimmerkin-ash")).toBe(false);
  });

  test("FR-CMPX-32 a copied race: _mod applied; a lineage reads as its rule", () => {
    const s = draft("race", "race/stonekin", tb2.records);
    expect(s.body.text).toContain("**Age.** Stonekin live for centuries.");
    expect(s.body.text).toContain("**Glow.**");
    expect(s.body.abilities).toBe("+2 to one score and +1 to another, or +1 to three scores");
    expect(s.body.size).toBe("Small or Medium");
  });

  test("FR-CMPX-32 a subrace whose race is missing, or a copied subrace: skipped with a warning", () => {
    const r = adaptBookData(
      emptyData({
        subraces: [
          { name: "Lost", source: "TB1", raceName: "Nowhere", raceSource: "TB9", entries: [] },
          {
            name: "Copy",
            source: "TB1",
            raceName: "Nowhere",
            raceSource: "TB9",
            _copy: { name: "Lost", source: "TB1" },
          },
        ],
      }),
      "TB1",
      env,
    );
    expect(r.records).toEqual([]);
    expect(r.skipped).toBe(2);
    expect(r.warnings.map((w) => w.sourceKey).sort()).toEqual([
      "race/nowhere-copy",
      "race/nowhere-lost",
    ]);
  });
});

describe("FR-CMPX-33 backgrounds and class options", () => {
  test("FR-CMPX-33 a background: its list and feature as text; a copy's _mod applied", () => {
    const b = draft("background", "background/lamplighter");
    expect(b.body.text).toBe(
      [
        "- **Skill Proficiencies:** Perception, Stealth\n- **Equipment:** A lamp, a pole and 5 gp",
        "**Feature: Lamplight.** Watchmen know your face and let you pass after dark.",
      ].join("\n\n"),
    );
    expect(entryLine(b)).toBe("Background");
    const n = draft("background", "background/night-lamplighter", tb2.records);
    expect(n.body.text).toContain("**Feature: Night Watch.** You never get lost in the dark.");
    expect(n.body.text).not.toContain("Lamplight.**");
  });

  test("FR-CMPX-33 class options: types for the filter (one per kind), prerequisites", () => {
    const bolt = draft("option", "option/bolt-of-ruin");
    expect(bolt.facets.types).toEqual(["Eldritch Invocation"]);
    expect(bolt.body.prerequisite).toBe("Fire Bolt cantrip");
    expect(entryLine(bolt)).toBe("Eldritch Invocation · Fire Bolt cantrip");
    expect(draft("option", "option/steady-stance").facets.types).toEqual(["Fighting Style"]);
    const odd = draft("option", "option/odd-trick");
    expect(odd.facets.types).toEqual(["Other"]);
    expect(odd.body.prerequisite).toBe("5th-level Warlock, Pact of the Tome");
  });

  test("FR-CMPX-13 an srd flag on a character option looks for no SRD entry", () => {
    const r = adaptBookData(
      emptyData({
        optionalFeatures: [
          { name: "Shared", source: "TB1", srd: true, featureType: ["EI"], entries: ["x"] },
        ],
        feats: [{ name: "Grappler", source: "TB1", srd: true, entries: ["y"] }],
      }),
      "TB1",
      env,
    );
    expect(r.records).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });
});

describe("FR-CMPX-31–33 text helpers", () => {
  test("FR-CMPX-32 ability scores: fixed, choices, any, alternatives", () => {
    expect(abilityText([{ str: 2, cha: 1 }])).toBe("Str +2, Cha +1");
    expect(abilityText([{ choose: { from: ["str", "dex", "con"], count: 2 } }])).toBe(
      "+1 to two of Str, Dex, Con",
    );
    expect(
      abilityText([{ choose: { from: ["str", "dex", "con", "int", "wis", "cha"], amount: 1 } }]),
    ).toBe("+1 to any one");
    expect(abilityText([{ dex: 2 }, { str: 2 }])).toBe("Dex +2; or Str +2");
    expect(abilityText(undefined)).toBeUndefined();
  });

  test("FR-CMPX-31 prerequisites: ability, proficiency, feat, background, spellcasting, unknown", () => {
    const warns: string[] = [];
    const warn = (_f: string, m: string) => warns.push(m);
    expect(prerequisiteText([{ ability: [{ str: 13 }, { dex: 13 }] }], warn)).toBe(
      "Strength 13 or higher or Dexterity 13 or higher",
    );
    expect(prerequisiteText([{ proficiency: [{ armor: "medium" }] }], warn)).toBe(
      "Proficiency with medium armor",
    );
    expect(prerequisiteText([{ feat: ["test feat|tb1"] }], warn)).toBe("Test Feat feat");
    expect(prerequisiteText([{ background: [{ name: "Lamplighter" }] }], warn)).toBe(
      "Lamplighter background",
    );
    expect(prerequisiteText([{ spellcasting2020: true }], warn)).toBe(
      "The ability to cast at least one spell",
    );
    expect(prerequisiteText([{ mystery: 1 }], warn)).toBeUndefined();
    expect(warns).toEqual(['"mystery" not understood; left out']);
  });

  test("FR-CMPX-32 speed and option types", () => {
    expect(speedText({ walk: 30, fly: 50, swim: true })).toBe(
      "30 ft., fly 50 ft., swim equal to your walking speed",
    );
    expect(optionType("MV:B")).toBe("Maneuver");
    expect(optionType("FS:P")).toBe("Fighting Style");
    expect(optionType("MM")).toBe("Metamagic");
  });
});
