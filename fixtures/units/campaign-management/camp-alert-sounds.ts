import { setAlertSound } from "@server/features/campaign-management/alert-sounds";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { AUDIO_ASSET_TYPE } from "@shared/assets-pipeline/audio";

/**
 * Sprint 8 (dice-extras §13, FR-CAMP-48): the DM picked Chime for `request` and `pause`; `turn`
 * keeps the ping, `resume` stays silent (defaults, OQ-CAMP-36). Joins session-sim-12.
 */
export default defineFixture({
  key: "camp-alert-sounds",
  kind: "setup",
  requires: ["campaign", "audio-chime"],
  ownerSpec: "campaign-management",
  steps: (["request", "pause"] as const).map((alert) =>
    step(setAlertSound, (r) => ({ alert, sound: r.id("audio-chime", AUDIO_ASSET_TYPE) })),
  ),
});
