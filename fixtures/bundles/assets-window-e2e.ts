import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Assets window (ASSET §13.3, FR-ASSET-67–70, #394): `alert-sounds` (mid-combat's scenes and
 * tokens + Chime, picked for `request` and `pause`). Its own bundle: the e2e uploads, renames and
 * deletes.
 */
export default defineBundle({
  name: "assets-window-e2e",
  includes: ["alert-sounds"],
  fixtures: [],
});
