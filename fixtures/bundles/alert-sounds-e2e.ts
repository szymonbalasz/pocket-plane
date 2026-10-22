import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `alert-sounds` under its own name for `e2e/alert-sounds.e2e.ts` (it uploads and picks). */
export default defineBundle({
  name: "alert-sounds-e2e",
  includes: ["alert-sounds"],
  fixtures: [],
});
