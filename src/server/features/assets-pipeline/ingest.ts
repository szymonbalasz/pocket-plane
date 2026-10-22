// `assets.ingest {bytes, filename, name?}` (FR-ASSET-01) for REST and the fixture loader:
// async processing (no disk), then the synchronous `assets.ingest` command. *(Sprint 8)* A sniffed
// sound (FR-ASSET-52) is probed instead (FR-ASSET-53) and checked against the limits here.
import { createHash } from "node:crypto";
import { type AssetKind, AUDIO_MAX_BYTES, AUDIO_MAX_MS } from "@shared/assets-pipeline/audio";
import type { RunOptions } from "../../commands/commands";
import type { Services } from "../../services";
import { looksLikeAudio, probeAudio } from "./audio-probe";
import { INGEST, type IngestInput, type IngestResult } from "./commands";
import { IngestRejected, processImage, unsupported } from "./image";

export interface IngestRequest {
  bytes: Uint8Array;
  filename: string;
  name?: string;
  /** FR-ASSET-24 (S5): false = an attachment. Absent = listed. */
  listed?: boolean;
  /** FR-ASSET-41 (S6): the upload context's tags. Absent = none (`[]` on a new row). */
  tags?: string[];
  /** *(Sprint 8)* The kind the uploader expects (the Alert sounds section sends `audio`): any
   * other content → 415. Absent = either. */
  kind?: AssetKind;
}

/** FR-ASSET-52's refusals (the code stays `invalid`; the status carries the cause). */
export const soundTooLarge = () => new IngestRejected(413, "Too large (max 512 KB)");
export const soundTooLong = () => new IngestRejected(422, "Too long (max 5 s)");
export const notASound = () => new IngestRejected(415, "Not a sound (MP3, OGG or WAV)");

/** Async half of an ingest; the result is the `assets.ingest` command input. */
export async function prepareIngest(req: IngestRequest): Promise<IngestInput> {
  const rest = {
    filename: req.filename,
    ...(req.name !== undefined ? { name: req.name } : {}),
    ...(req.listed !== undefined ? { listed: req.listed } : {}),
    ...(req.tags !== undefined ? { tags: req.tags } : {}),
  };
  if (looksLikeAudio(req.bytes)) {
    if (req.kind === "image") throw unsupported();
    return { audio: probeSound(req.bytes), ...rest };
  }
  if (req.kind === "audio") throw notASound();
  return { image: await processImage(req.bytes), ...rest };
}

/** FR-ASSET-52, -53: ≤ 512 KB, a readable header, ≤ 5,000 ms; else 413 / 415 / 422. */
export function probeSound(bytes: Uint8Array): NonNullable<IngestInput["audio"]> {
  if (bytes.byteLength > AUDIO_MAX_BYTES) throw soundTooLarge();
  const probe = probeAudio(bytes);
  if (!probe) throw unsupported();
  if (probe.durationMs > AUDIO_MAX_MS) throw soundTooLong();
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    mime: probe.mime,
    durationMs: probe.durationMs,
    original: bytes,
  };
}

/** Throws `IngestRejected` (413/415/422) or `CommandError`; nothing written on rejection. */
export async function ingestAsset(
  s: Services,
  req: IngestRequest,
  opts: RunOptions,
): Promise<IngestResult> {
  const input = await prepareIngest(req);
  return s.commands.run(INGEST, input, opts) as IngestResult;
}
