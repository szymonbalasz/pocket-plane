// Animated tokens (ANIM §13): video sniffing and Range parsing, in-code bytes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WORKTREE_ROOT } from "../../config";
import { parseRange } from "./routes";
import { mp4Bytes } from "./testing";
import { sniffVideo } from "./video";

const WISP = readFileSync(path.join(WORKTREE_ROOT, "fixtures/assets/tokens/animated-wisp.webm"));

/** An EBML header with `docType`. */
function ebml(docType: string): Uint8Array {
  const dt = [...Buffer.from(docType)];
  const body = [0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x80 | dt.length, ...dt];
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length, ...body, 0, 0, 0]);
}

describe("FR-ANIM-02 sniff", () => {
  test("FR-ANIM-02 WebM (EBML DocType webm) → video/webm, the fixture too", () => {
    expect(sniffVideo(ebml("webm"))).toBe("video/webm");
    expect(sniffVideo(WISP)).toBe("video/webm");
  });

  test("FR-ANIM-02 MP4 (ftyp isom / mp42) → video/mp4", () => {
    expect(sniffVideo(mp4Bytes("isom"))).toBe("video/mp4");
    expect(sniffVideo(mp4Bytes("mp42"))).toBe("video/mp4");
  });

  test("FR-ANIM-02 QuickTime, audio-only MP4, Matroska, AVI, images → not a video we take", () => {
    expect(sniffVideo(mp4Bytes("qt  "))).toBeNull();
    expect(sniffVideo(mp4Bytes("M4A "))).toBeNull();
    expect(sniffVideo(ebml("matroska"))).toBeNull();
    const avi = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("AVI LIST")]);
    expect(sniffVideo(avi)).toBeNull();
    expect(sniffVideo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(sniffVideo(new Uint8Array([]))).toBeNull();
  });
});

describe("FR-ANIM-05 Range", () => {
  test("FR-ANIM-05 parseRange: a-b, a-, -n, clamped; bad → whole file; past the end → 416", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=990-5000", 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});
