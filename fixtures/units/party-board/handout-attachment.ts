import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { createHandout } from "@server/features/party-board/commands";

const FILE = "handouts/ransom-note.svg";

/** Strings the S5 leak tests and walkthrough look for (PARTY §13.1). */
export const HANDOUT_ATTACHMENT = {
  key: "handout-attachment",
  file: FILE,
  title: "Ransom Note",
  body: "PARTY-ATTACH-6",
} as const;

/**
 * PARTY §13.1 `handout-attachment` (patch: one asset + one handout): ingests `ransom-note` as an
 * **attachment** (`listed: false`, FR-ASSET-24; outside the library and every snapshot), then
 * creates h6 "Ransom Note" (body "PARTY-ATTACH-6") with that image, **unshared**. No
 * notification. h6 takes the attachment's id from the loader (`r.id`, which records an
 * attachment's `AssetIngested`).
 */
export default defineFixture({
  key: HANDOUT_ATTACHMENT.key,
  kind: "setup",
  requires: ["handouts-1"],
  ownerSpec: "party-board",
  assets: [FILE],
  steps: [
    ingestStep(FILE, { listed: false }),
    step(createHandout, (r) => ({
      title: HANDOUT_ATTACHMENT.title,
      body: HANDOUT_ATTACHMENT.body,
      imageAssetIds: [r.id(HANDOUT_ATTACHMENT.key, "asset")],
    })),
  ],
});
