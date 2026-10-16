import { IMPORT_RECORDED, type ImportRecordedInput } from "@server/features/compendium/import";
import { SRD_51_SOURCE } from "@server/features/compendium/sources/srd-5.1/source";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import type { z } from "zod";
import { SRD_MINI_VERSION, srdMini } from "../../srd/open5e";

const input: z.input<typeof ImportRecordedInput> = {
  source: { ...SRD_51_SOURCE },
  version: SRD_MINI_VERSION,
  responses: srdMini,
};

/**
 * CMP §13 `cmp-srd-mini`: the mini recorded Open5e set (`wotc-srd` only) as source `srd-5.1`,
 * version `mini` (the bundled version differs, so the DM sees **Update**). Global: compendium
 * entries + the monsters' imported definitions; no campaign rows (seams S10).
 */
export default defineFixture({
  key: "cmp-srd-mini",
  kind: "setup",
  requires: [],
  ownerSpec: "compendium",
  steps: [{ command: IMPORT_RECORDED, input }],
});
