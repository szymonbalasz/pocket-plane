import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `table-tools-paused` under its own name for `e2e/tt-pause.e2e.ts` (it resumes and pauses). */
export default defineBundle({
  name: "table-tools-paused-e2e",
  includes: ["table-tools-paused"],
  fixtures: [],
});
