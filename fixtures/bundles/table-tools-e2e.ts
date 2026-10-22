import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `table-tools` under its own name for `e2e/tt-macros.e2e.ts` and `e2e/tt-requests.e2e.ts`. */
export default defineBundle({
  name: "table-tools-e2e",
  includes: ["table-tools"],
  fixtures: [],
});
