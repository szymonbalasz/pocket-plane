import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** The Scenes window's list (FR-MAP-116–120): `scenes` in its own server, so a drag can't shift another spec's rows. */
export default defineBundle({
  name: "scenes-list",
  includes: ["scenes"],
  fixtures: [],
});
