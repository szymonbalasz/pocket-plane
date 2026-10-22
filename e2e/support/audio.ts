// Upload-limit files for alert sounds (dice-extras §13 T13; not fixtures): `big.wav` (> 512 KB,
// 3.5 s), `long.wav` (6 s, small) and `fake.mp3` (text). Built in code; written on demand.
// Walkthroughs: `bun e2e/support/audio.ts <dir>` writes the three files into <dir>.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { silentWav } from "../../src/server/features/assets-pipeline/audio-bytes";

export const AUDIO_LIMIT_FILES = {
  /** 44.1 kHz stereo 16-bit, 3.5 s = 617,444 B → 413 "Too large (max 512 KB)". */
  "big.wav": () => silentWav(3500, { rate: 44_100, channels: 2 }),
  /** 8 kHz mono 8-bit, 6 s = 48,044 B → 422 "Too long (max 5 s)". */
  "long.wav": () => silentWav(6000, { rate: 8000, bits: 8 }),
  /** Text named .mp3 → 415 (sniffed, never the name). */
  "fake.mp3": () => new TextEncoder().encode("This is not a sound.\n".repeat(40)),
} as const;

export type AudioLimitFile = keyof typeof AUDIO_LIMIT_FILES;

/** Writes the three files into `dir`; returns their paths by name. */
export function writeAudioLimitFiles(dir: string): Record<AudioLimitFile, string> {
  mkdirSync(dir, { recursive: true });
  const out = {} as Record<AudioLimitFile, string>;
  for (const [name, bytes] of Object.entries(AUDIO_LIMIT_FILES)) {
    const file = path.join(dir, name);
    writeFileSync(file, bytes());
    out[name as AudioLimitFile] = file;
  }
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: bun e2e/support/audio.ts <dir>");
  for (const f of Object.values(writeAudioLimitFiles(dir))) console.log(f);
}
