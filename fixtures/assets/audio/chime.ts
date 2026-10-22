// "Chime" (dice-extras §13, unit `audio-chime`): a generated 16-bit mono 22,050 Hz PCM WAV of
// 0.4 s = 17,684 B. Built in code, so no binary is committed; the same bytes on every load and
// machine (the seeded asset ID mixes in their hash, FR-ASSET-08).
import { wavFile } from "@server/features/assets-pipeline/audio-bytes";

export const CHIME_RATE = 22_050;
export const CHIME_MS = 400;

/** Two bell partials (E6 + B6) with a soft attack and an exponential decay. */
export function chimeWav(): Uint8Array {
  const frames = (CHIME_RATE * CHIME_MS) / 1000;
  const data = new Uint8Array(frames * 2);
  const v = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) {
    const t = i / CHIME_RATE;
    const attack = Math.min(1, t / 0.005);
    const env = attack * Math.exp(-t * 9);
    const s = 0.6 * Math.sin(2 * Math.PI * 1318.5 * t) + 0.3 * Math.sin(2 * Math.PI * 1975.5 * t);
    v.setInt16(i * 2, Math.round(s * env * 0.8 * 32_767), true);
  }
  return wavFile({ rate: CHIME_RATE, channels: 1, bits: 16, data });
}
