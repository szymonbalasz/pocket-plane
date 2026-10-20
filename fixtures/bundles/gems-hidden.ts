import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** GEM §13 `gems-hidden`: `gems` switched off again (counts kept, nothing sent, FR-GEM-04). */
export default defineBundle({
  name: "gems-hidden",
  includes: ["gems"],
  fixtures: ["gems-hidden"],
});
