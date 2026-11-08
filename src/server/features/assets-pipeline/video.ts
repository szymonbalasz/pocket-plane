// Animated tokens (ANIM, ADR-0080): video sniffing, the still frame, and the animated-ID set.
// Pure apart from the set: no disk, no ctx.
import { createHash } from "node:crypto";
import { VIDEO_MAX_BYTES, VIDEO_TOO_LARGE, type VideoMime } from "@shared/assets-pipeline/video";
import { IngestRejected, type ProcessedImage, processImage } from "./image";

export const videoTooLarge = () => new IngestRejected(413, VIDEO_TOO_LARGE);
export const posterMissing = () =>
  new IngestRejected(422, "A video needs its still frame (upload it from the picker)");
export const posterWithoutVideo = () => new IngestRejected(400, "A poster goes with a video only");

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const EBML_DOCTYPE_ID = [0x42, 0x82] as const;
/** FR-ANIM-02: `ftyp` major brands that are not a playable MP4 video. */
const NOT_MP4_BRANDS = new Set(["qt  ", "M4A ", "M4B ", "M4P "]);

const at = (b: Uint8Array, sig: readonly number[], i: number) =>
  b.length >= i + sig.length && sig.every((x, k) => b[i + k] === x);

/** Length of an EBML variable-size integer from its first byte (1–8), or 0 if invalid. */
function vintLength(first: number): number {
  for (let n = 1; n <= 8; n++) if (first & (0x80 >> (n - 1))) return n;
  return 0;
}

/** Value of the EBML vint at `i` (marker bit removed), with its length. */
function readVint(b: Uint8Array, i: number): { value: number; length: number } | null {
  const first = b[i];
  if (first === undefined) return null;
  const length = vintLength(first);
  if (length === 0 || i + length > b.length) return null;
  let value = first & (0xff >> length);
  for (let k = 1; k < length; k++) value = value * 256 + (b[i + k] as number);
  return { value, length };
}

/** WebM: an EBML header whose DocType element is `webm` (Matroska `matroska` → not ours). */
function isWebm(b: Uint8Array): boolean {
  if (!at(b, EBML_MAGIC, 0)) return false;
  const size = readVint(b, 4);
  if (!size) return false;
  const end = Math.min(b.length, 4 + size.length + size.value);
  for (let i = 4 + size.length; i < end - 2; i++) {
    if (!at(b, EBML_DOCTYPE_ID, i)) continue;
    const len = readVint(b, i + 2);
    if (!len) return false;
    const start = i + 2 + len.length;
    const docType = new TextDecoder().decode(b.subarray(start, start + len.value));
    return docType === "webm";
  }
  return false;
}

/** MP4: an `ftyp` box at offset 4 whose major brand isn't QuickTime or audio-only. */
function isMp4(b: Uint8Array): boolean {
  if (!at(b, [0x66, 0x74, 0x79, 0x70], 4) || b.length < 12) return false;
  const brand = String.fromCharCode(...b.subarray(8, 12));
  return !NOT_MP4_BRANDS.has(brand);
}

/** FR-ANIM-02: content sniffing only. Null = not a video we take (other formats → 415 later). */
export function sniffVideo(bytes: Uint8Array): VideoMime | null {
  if (isWebm(bytes)) return "video/webm";
  if (isMp4(bytes)) return "video/mp4";
  return null;
}

/**
 * FR-ANIM-03: the stored original is the video (hash, mime, bytes); sizes and derivatives come
 * from the poster under the image rules. Size first, before the poster is decoded (FR-ANIM-02).
 */
export async function processVideo(
  video: Uint8Array,
  mime: VideoMime,
  poster: Uint8Array | undefined,
): Promise<ProcessedImage> {
  if (video.byteLength > VIDEO_MAX_BYTES) throw videoTooLarge();
  if (!poster) throw posterMissing();
  const still = await processImage(poster);
  const hash = createHash("sha256").update(video).digest("hex");
  return { ...still, hash, sourceHash: hash, mime, original: video };
}
