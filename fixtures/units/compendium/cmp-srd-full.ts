import { IMPORT_RECORDED, type ImportRecordedInput } from "@server/features/compendium/import";
import { loadSrd51 } from "@server/features/compendium/sources/srd-5.1";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import type { z } from "zod";

/**
 * CMP §13 `cmp-srd-full` (S4): the **bundled** `srd-5.1` source at its bundled version, through
 * `cmp.importRecorded` (no encounter check): the mini entries are `existing` (or `updated`), the
 * rest created; 1,150 entries. Global rows only (seams S10).
 */
export default defineFixture({
  key: "cmp-srd-full",
  kind: "setup",
  requires: ["cmp-srd-mini"],
  ownerSpec: "compendium",
  steps: [
    {
      command: IMPORT_RECORDED,
      input: (): z.input<typeof ImportRecordedInput> => {
        const b = loadSrd51();
        return { source: { ...b.source }, version: b.version, responses: b.responses };
      },
    },
  ],
});
