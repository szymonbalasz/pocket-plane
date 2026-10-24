import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** Sprint 10 H4 E2E alias of `sp-rules` (`e2e/h4-rules.e2e.ts`; read-only, no new unit). */
export default defineBundle({
  name: "h4-rules-e2e",
  includes: ["sp-rules"],
  fixtures: [],
});
