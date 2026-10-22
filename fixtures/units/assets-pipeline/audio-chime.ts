import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { chimeWav } from "../../assets/audio/chime";

/**
 * Sprint 8 (dice-extras §13, FR-ASSET-52–58): "Chime", the campaign's one sound: a generated PCM
 * WAV, 16-bit mono 22,050 Hz, 0.4 s = 17,684 B (`fixtures/assets/audio/chime.ts`, no binary).
 * Manifest `audio-asset` 0 = its ID. Joins session-sim-12.
 */
export default defineFixture({
  key: "audio-chime",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "assets-pipeline",
  steps: [ingestStep({ bytes: chimeWav, filename: "chime.wav" }, "Chime")],
});
