import { IMPORT_RECORDED, type ImportRecordedInput } from "@server/features/compendium/import";
import { SRD_51_SOURCE } from "@server/features/compendium/sources/srd-5.1/source";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import type { z } from "zod";
import { rulesMini, SRD_MINI_VERSION, srdMini } from "../../srd/open5e";

const input: z.input<typeof ImportRecordedInput> = {
  source: { ...SRD_51_SOURCE },
  version: SRD_MINI_VERSION,
  responses: { ...srdMini, ...rulesMini },
};

/**
 * CMP §13.3 `cmp-rules-mini` (sprint 9, joins session-sim-13): the mini `sections` set (Actions in
 * Combat, Attacking, Cover, Damage and Healing, Movement; 47 rule cards) under `srd-5.1`. It
 * re-imports `cmp-srd-mini`'s records at the same version beside them, so those are `existing`
 * (nothing else written, FR-CMP-09) and the source row keeps version `mini` with full counts; only
 * `rule` rows are created. Global rows only.
 */
export default defineFixture({
  key: "cmp-rules-mini",
  kind: "setup",
  requires: ["cmp-srd-mini"],
  ownerSpec: "compendium",
  steps: [{ command: IMPORT_RECORDED, input }],
});
