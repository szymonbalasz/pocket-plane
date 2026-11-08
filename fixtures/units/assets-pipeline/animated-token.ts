import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

/**
 * ANIM §13 `animated-token`: one animated image, `tokens/animated-wisp.webm` (128 px, see-through
 * VP9, 1 s loop, CC0, made by `scripts/make-animated-fixture.ts`) with its still frame
 * `animated-wisp.svg`, tagged Tokens. Asset index 0.
 */
export default defineFixture({
  key: "animated-token",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "animated-tokens",
  assets: ["tokens/animated-wisp.webm", "tokens/animated-wisp.svg"],
  steps: [
    ingestStep("tokens/animated-wisp.webm", {
      name: "Wisp",
      poster: "tokens/animated-wisp.svg",
      tags: ["Tokens"],
    }),
  ],
});
