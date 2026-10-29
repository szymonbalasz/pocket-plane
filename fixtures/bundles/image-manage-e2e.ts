import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Rename / delete an image (ASSET §13.1, FR-ASSET-62–66, #386): `image-search` (maps, tokens,
 * handouts and homebrew images in use + 24 library images). Its own bundle: the e2e renames and
 * deletes images.
 */
export default defineBundle({
  name: "image-manage-e2e",
  includes: ["image-search"],
  fixtures: [],
});
