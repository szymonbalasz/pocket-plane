import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * ENT §13 `token-art-update` (S4, review B37) = `base` + `player-2` + `images` + `battlemap` +
 * `cmp-srd-mini-s3` + `art-update-tokens`: a sprint-3 database before its first **Update** (the
 * SRD definitions have no `type`; Goblin, Ogre, Wolf tokens null, Wolf set to Initials).
 */
export default defineBundle({
  name: "token-art-update",
  includes: ["base"],
  fixtures: ["player-2", "images", "battlemap", "cmp-srd-mini-s3", "art-update-tokens"],
});
