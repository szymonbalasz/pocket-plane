import { IMPORT_RECORDED, type ImportRecordedInput } from "@server/features/compendium/import";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import type { z } from "zod";

/** Source `version` of both fake books (a label, FR-CMP-04 fixtures). */
export const CMPX_BOOKS_VERSION = "cmpx-books";
export const TB1_SOURCE = "5et-tb1";
export const TB2_SOURCE = "5et-tb2";

const book = (key: string, name: string) => ({
  key,
  name,
  licence: "User-supplied (5etools)",
  attribution: `${name}: invented fixture content.`,
});

const SECTIONS = { traits: [], bonusActions: [], reactions: [] };

function monster(name: string, sourceKey: string, ac: number, hpMax: number, cr: string) {
  return {
    kind: "monster" as const,
    sourceKey,
    data: {
      kind: "monster",
      name,
      facets: { cr, type: "fiend", size: "small" },
      body: {
        meta: {},
        ...SECTIONS,
        actions: [{ name: "Bite", text: `The ${name} snaps its invented jaws. *Hit:* 1d4 + 1.` }],
      },
    },
    definition: {
      name,
      statBlock: { size: "small", ac, hpMax, initBonus: 1, attacks: [], cr },
    },
  };
}

const tb1: z.input<typeof ImportRecordedInput> = {
  source: book(TB1_SOURCE, "Test Book One"),
  version: CMPX_BOOKS_VERSION,
  records: [
    {
      ...monster("Goblin", "monster/goblin", 12, 9, "1"),
      replaces: ["srd-5.1:monster/goblin"],
      artPath: "img/bestiary/tokens/TB1/Goblin.webp",
    },
    monster("Gnasher", "monster/gnasher", 11, 13, "1"),
    {
      kind: "spell",
      sourceKey: "spell/hunters-mark",
      replaces: ["srd-5.1:spell/hunters-mark"],
      data: {
        kind: "spell",
        name: "Hunter's Mark",
        facets: {
          level: 1,
          school: "divination",
          classes: ["Ranger"],
          concentration: true,
          ritual: false,
        },
        body: {
          castingTime: "1 bonus action",
          range: "90 feet",
          components: "V",
          duration: "Up to 1 hour",
          text: "Invented fixture words: a glowing tag follows your quarry.",
        },
      },
    },
    {
      kind: "spell",
      sourceKey: "spell/emberlash",
      data: {
        kind: "spell",
        name: "Emberlash",
        facets: {
          level: 1,
          school: "evocation",
          classes: ["Wizard"],
          concentration: false,
          ritual: false,
        },
        body: {
          castingTime: "1 action",
          range: "30 feet",
          components: "S",
          duration: "Instantaneous",
          text: "Invented fixture words: a whip of sparks, 2d6 fire.",
        },
      },
    },
    {
      kind: "item",
      sourceKey: "item/cinder-flask",
      data: {
        kind: "item",
        name: "Cinder Flask",
        facets: { category: "gear", attunement: false },
        body: { typeLine: "Adventuring gear", text: "Invented fixture words: warm to the touch." },
      },
    },
  ],
};

const tb2: z.input<typeof ImportRecordedInput> = {
  source: book(TB2_SOURCE, "Test Book Two"),
  version: CMPX_BOOKS_VERSION,
  records: [
    {
      ...monster("Gnasher", "monster/gnasher", 13, 22, "2"),
      replaces: [`${TB1_SOURCE}:monster/gnasher`],
    },
  ],
};

/**
 * Compendium-expansion §13: two hand-made books (invented names and words, nothing from 5etools,
 * ADR-0074) as adapter records. TB1's Goblin and Hunter's Mark replace the SRD's (FR-CMPX-13 a),
 * TB2's Gnasher replaces TB1's (b). Global, no campaign rows; import order doesn't matter.
 */
export default defineFixture({
  key: "cmpx-books",
  kind: "setup",
  requires: [],
  ownerSpec: "compendium-expansion",
  steps: [
    { command: IMPORT_RECORDED, input: tb1 },
    { command: IMPORT_RECORDED, input: tb2 },
  ],
});
