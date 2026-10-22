// FR-ASSET-53: the hand-rolled audio probe on byte-built WAV / MP3 / OGG files.
import { describe, expect, test } from "bun:test";
import {
  concat,
  MP3_FRAME_BYTES,
  MP3_FRAME_MS,
  mp3File,
  oggFile,
  silentWav,
  wavFile,
} from "./audio-bytes";
import { crossCheck, looksLikeAudio, probeAudio } from "./audio-probe";

describe("FR-ASSET-53 audio probe", () => {
  test("FR-ASSET-53 audio probe: WAV PCM / float, length = data bytes ÷ byte rate", () => {
    expect(probeAudio(silentWav(400))).toEqual({ mime: "audio/wav", durationMs: 400 });
    expect(probeAudio(silentWav(2500, { rate: 44_100, channels: 2 }))).toEqual({
      mime: "audio/wav",
      durationMs: 2500,
    });
    expect(probeAudio(silentWav(1000, { bits: 32, format: 3 }))?.durationMs).toBe(1000);
    // 5,001 ms is measured as such (the route refuses it, FR-ASSET-52).
    expect(probeAudio(silentWav(5001))?.durationMs).toBe(5001);
    // Not PCM / float (e.g. ADPCM) → unsupported.
    expect(probeAudio(silentWav(400, { format: 2 }))).toBeNull();
  });

  test("FR-ASSET-53 audio probe: WAV cross-check, a lying header never shortens a sound", () => {
    // Byte rate claims 10× the real one: header 0.3 s, bytes 3 s → the larger counts.
    const lying = silentWav(3000, { byteRate: 441_000 });
    expect(probeAudio(lying)?.durationMs).toBe(3000);
    // Truncated: `data` claims 6 s, 1 s present → the header (larger) counts.
    const cut = silentWav(1000, { dataSize: 22_050 * 2 * 6 });
    expect(probeAudio(cut)?.durationMs).toBe(6000);
    // A streamed WAV (size 0xFFFFFFFF) → the bytes decide.
    expect(probeAudio(silentWav(800, { dataSize: 0xffffffff }))?.durationMs).toBe(800);
    // Header cut before `data` → unsupported.
    expect(probeAudio(silentWav(400).subarray(0, 30))).toBeNull();
  });

  test("FR-ASSET-53 audio probe: MP3 Layer III, frame walk, Xing / Info, VBRI, ID3v2", () => {
    const walk = probeAudio(mp3File({ frames: 100 }));
    expect(walk).toEqual({ mime: "audio/mpeg", durationMs: Math.round(100 * MP3_FRAME_MS) });
    expect(probeAudio(mp3File({ frames: 100, id3: 2000 }))?.durationMs).toBe(walk?.durationMs);
    const xing = probeAudio(mp3File({ frames: 100, xingFrames: 100 }));
    expect(xing?.durationMs).toBe(Math.round(100 * MP3_FRAME_MS));
    const vbri = probeAudio(mp3File({ frames: 100, vbriFrames: 100 }));
    expect(vbri?.durationMs).toBe(Math.round(100 * MP3_FRAME_MS));
    // A truncated last frame is not counted.
    const cut = mp3File({ frames: 10 }).subarray(0, 10 * MP3_FRAME_BYTES - 100);
    expect(probeAudio(cut)?.durationMs).toBe(Math.round(9 * MP3_FRAME_MS));
  });

  test("FR-ASSET-53 audio probe: MP3 cross-check (Xing frames vs bytes ÷ bitrate)", () => {
    // Xing claims 10 frames, 200 are there: bytes ÷ 128 kbit/s wins.
    const lying = probeAudio(mp3File({ frames: 200, xingFrames: 10 }));
    expect(lying?.durationMs).toBeGreaterThan(5000);
    // Xing with a byte count: 2,000 frames declared over the bytes present → header counts.
    const vbr = probeAudio(
      mp3File({ frames: 100, xingFrames: 100, xingBytes: 101 * MP3_FRAME_BYTES }),
    );
    expect(vbr?.durationMs).toBe(Math.round(100 * MP3_FRAME_MS));
  });

  test("FR-ASSET-53 audio probe: OGG Vorbis / Opus, last granule ÷ rate, Opus pre-skip", () => {
    expect(
      probeAudio(oggFile({ codec: "vorbis", rate: 44_100, granules: [44_100, 88_200] })),
    ).toEqual({ mime: "audio/ogg", durationMs: 2000 });
    expect(
      probeAudio(oggFile({ codec: "opus", preSkip: 312, granules: [48_312, 96_312, 144_312] })),
    ).toEqual({ mime: "audio/ogg", durationMs: 3000 });
    // One audio page: nothing to cross-check against.
    expect(probeAudio(oggFile({ codec: "vorbis", granules: [22_050] }))?.durationMs).toBe(500);
    // A lying last granule (claims 0.1 s over 3 pages of 1 s each) → the pages' rate wins.
    const lying = oggFile({ codec: "vorbis", rate: 1000, granules: [1000, 2000, 100] });
    expect(probeAudio(lying)?.durationMs).toBe(3000);
    // Truncated: the cut page is not counted.
    const whole = oggFile({ codec: "vorbis", rate: 1000, granules: [1000, 2000, 3000] });
    expect(probeAudio(whole.subarray(0, whole.length - 10))?.durationMs).toBe(2000);
    // Neither Vorbis nor Opus (e.g. FLAC in Ogg) → unsupported.
    const flac = oggFile({ codec: "vorbis", granules: [1000] });
    flac.set([0x7f, 0x46, 0x4c, 0x41, 0x43], 28);
    expect(probeAudio(flac)).toBeNull();
  });

  test("FR-ASSET-53 audio probe: not a sound → null; images and text never sniff as audio", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = concat([new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "), new Uint8Array(40)]);
    const text = new TextEncoder().encode("This is not an MP3 file at all.\n".repeat(20));
    for (const b of [png, webp, text, new Uint8Array(0), new Uint8Array([0xff, 0xfb])]) {
      expect(probeAudio(b)).toBeNull();
      expect(looksLikeAudio(b)).toBe(false);
    }
    expect(looksLikeAudio(silentWav(10))).toBe(true);
    expect(looksLikeAudio(mp3File({ frames: 1, id3: 10 }))).toBe(true);
    // Zero-length audio is not a sound.
    expect(probeAudio(wavFile({ data: new Uint8Array(0) }))).toBeNull();
  });

  test("FR-ASSET-53 cross-check: within 20 % the header counts, else the larger", () => {
    expect(crossCheck(1000, 1150)).toBe(1000);
    expect(crossCheck(1000, 1300)).toBe(1300);
    expect(crossCheck(4000, 1000)).toBe(4000);
    expect(crossCheck(1000, null)).toBe(1000);
  });
});
