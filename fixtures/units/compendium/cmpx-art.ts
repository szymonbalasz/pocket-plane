import { IMPORT_RECORDED, type ImportRecordedInput } from "@server/features/compendium/import";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import type { z } from "zod";
import { CMPX_BOOKS_VERSION, TB1_SOURCE } from "./cmpx-books";

/** The batch's three monsters: two files in the prepared `5etools-mini`, one that isn't there. */
export const CMPX_ART = {
  goblin: { sourceKey: "monster/goblin", name: "Goblin", file: "Goblin" },
  gnasher: { sourceKey: "monster/gnasher", name: "Gnasher", file: "Gnasher" },
  missing: { sourceKey: "monster/art-less-wisp", name: "Art-less Wisp", file: "Art-less Wisp" },
};

const monster = ({ sourceKey, name, file }: (typeof CMPX_ART)["goblin"]) => ({
  kind: "monster" as const,
  sourceKey,
  artPath: `img/bestiary/tokens/TB1/${file}.webp`,
  data: {
    kind: "monster",
    name,
    facets: { cr: "1", type: "fiend", size: "small" },
    body: {
      meta: {},
      traits: [],
      bonusActions: [],
      reactions: [],
      actions: [{ name: "Bite", text: `The ${name} snaps its invented jaws. *Hit:* 1d4 + 1.` }],
    },
  },
  definition: {
    name,
    statBlock: { size: "small", ac: 12, hpMax: 9, initBonus: 1, attacks: [], cr: "1" },
  },
});

const batch: z.input<typeof ImportRecordedInput> = {
  source: {
    key: TB1_SOURCE,
    name: "Test Book One",
    licence: "User-supplied (5etools)",
    attribution: "Test Book One: invented fixture content.",
  },
  version: CMPX_BOOKS_VERSION,
  records: [monster(CMPX_ART.goblin), monster(CMPX_ART.gnasher), monster(CMPX_ART.missing)],
};

/**
 * Compendium-expansion X3: a small book of invented monsters with `artPath`s (nothing from 5etools,
 * ADR-0074). The token files come from the folder: `bun fixtures/5etools-mini/prepare.ts <dir>`,
 * then `PP_5ETOOLS_DIR=<dir>`.
 */
export default defineFixture({
  key: "cmpx-art-batch",
  kind: "setup",
  requires: [],
  ownerSpec: "compendium-expansion",
  steps: [{ command: IMPORT_RECORDED, input: batch }],
});
