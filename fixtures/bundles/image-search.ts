import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * assets-pipeline §13.1, walkthrough IM and the IM e2e: `session-sim-9` (scenes, tokens, props,
 * handouts, homebrew items and customs for every picker) + `image-tags` (24 tagged library images,
 * 2 attachments). The state-changing bundle of IM's walkthrough and e2e (seams S12).
 */
export default defineBundle({
  name: "image-search",
  includes: ["session-sim-9"],
  fixtures: ["image-tags"],
});
