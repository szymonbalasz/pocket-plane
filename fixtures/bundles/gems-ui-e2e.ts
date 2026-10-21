import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * GM3 `gems-ui-e2e`: `gems-hidden` under its own name for `e2e/gems-ui.e2e.ts` (gems off, counts
 * kept); the e2e switches gems on in Campaign options, awards, spends and switches off, so it
 * changes state and gets a server of its own (seams S12).
 */
export default defineBundle({
  name: "gems-ui-e2e",
  includes: ["gems-hidden"],
  fixtures: [],
});
