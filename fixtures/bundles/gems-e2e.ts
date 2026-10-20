import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * GEM §13 `gems-e2e`: `gems-hidden` under its own name for `e2e/gems-core.e2e.ts`; the e2e
 * switches gems on, awards, spends and switches off, so it changes state (seams S12).
 */
export default defineBundle({
  name: "gems-e2e",
  includes: ["gems-hidden"],
  fixtures: [],
});
