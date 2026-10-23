import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** CMP §13.3 E2E alias of `sp-rules` (`e2e/sp-rules.e2e.ts`; read-only, no new unit). */
export default defineBundle({
  name: "sp-rules-e2e",
  includes: ["sp-rules"],
  fixtures: [],
});
