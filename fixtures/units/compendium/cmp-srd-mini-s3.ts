import { IMPORT_RECORDED, type ImportRecordedInput } from "@server/features/compendium/import";
import { SRD_51_SOURCE } from "@server/features/compendium/sources/srd-5.1/source";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import type { z } from "zod";
import { srdMini } from "../../srd/open5e";

/** Source `version` of the sprint-3 mini set: differs from the bundled one, so **Update** shows. */
export const SRD_MINI_S3_VERSION = "mini-s3";

const input: z.input<typeof ImportRecordedInput> = {
  source: { ...SRD_51_SOURCE },
  version: SRD_MINI_S3_VERSION,
  responses: {
    ...srdMini,
    monsters: (srdMini.monsters ?? []).map((m) => {
      const { type: _type, ...rest } = m as Record<string, unknown>;
      return rest;
    }),
  },
};

/**
 * ENT §13 `cmp-srd-mini-s3` (review B37): like `cmp-srd-mini` (same records, source `srd-5.1`)
 * but each monster's Open5e `type` removed and version `mini-s3`: the definitions a sprint-3
 * database holds (no `type`, FR-ENT-26). The entries' type facet reads "unknown". Alternative to
 * `cmp-srd-mini`, never in the same bundle.
 */
export default defineFixture({
  key: "cmp-srd-mini-s3",
  kind: "setup",
  requires: [],
  ownerSpec: "compendium",
  steps: [{ command: IMPORT_RECORDED, input }],
});
