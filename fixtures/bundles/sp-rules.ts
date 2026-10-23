import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CMP §13.3 `sp-rules` (sprint 9 SP2, walkthrough R1–R8): `session-sim-12` + the rules units:
 * `cmp-rules-mini` (47 rule cards beside the SRD mini) and `cmp-rule-house` ("Flanking" shared,
 * "Critical fumbles" DM only). The same two join `sp-s9` when SP3's bundle is on `main`.
 */
export default defineBundle({
  name: "sp-rules",
  includes: ["session-sim-12"],
  fixtures: ["cmp-rules-mini", "cmp-rule-house"],
});
