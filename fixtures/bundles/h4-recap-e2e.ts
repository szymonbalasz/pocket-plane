import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** Sprint 10 H4 E2E alias of `sp-s9` (`e2e/h4-recap.e2e.ts` changes state; no new unit). */
export default defineBundle({
  name: "h4-recap-e2e",
  includes: ["sp-s9"],
  fixtures: [],
});
