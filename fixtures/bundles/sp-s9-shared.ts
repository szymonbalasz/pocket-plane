import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** RECAP §13 `sp-s9-shared`: `sp-s9` + `recap-share-note` (the fixture session shared, rolls left out). */
export default defineBundle({
  name: "sp-s9-shared",
  includes: ["sp-s9"],
  fixtures: ["recap-share-note"],
});
