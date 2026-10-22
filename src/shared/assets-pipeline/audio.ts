// Audio assets (ASSET sprint 8, FR-ASSET-52–61): DM-added alert sounds stored as `asset` rows of
// kind `audio`, synced only as the lazy DM-only type `audio-asset` (never in `asset`). The probe,
// upload and serve route are TT3's; TT0 holds the row kind, the record and the limits.
import { z } from "zod";

/** FR-ASSET-54: an `asset` row's kind (default `image`). */
export const ASSET_KINDS = ["image", "audio"] as const;
export const AssetKind = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKind>;

export const AUDIO_ASSET_TYPE = "audio-asset";

/** FR-ASSET-52 (OQ-ASSET-27): accepted sound types, sniffed (MIME headers ignored). */
export const AUDIO_MIMES = ["audio/mpeg", "audio/ogg", "audio/wav"] as const;
export const AudioMime = z.enum(AUDIO_MIMES);
export type AudioMime = z.infer<typeof AudioMime>;

/** FR-ASSET-52 (OQ-ASSET-28): ≤ 512 KB and ≤ 5 s. */
export const AUDIO_MAX_BYTES = 512 * 1024;
export const AUDIO_MAX_MS = 5_000;
/** FR-ASSET-58 (OQ-ASSET-30): sounds per campaign; no delete. */
export const AUDIO_LIBRARY_CAP = 50;

/** FR-ASSET-57: wire shape of `audio-asset` (lazy `all`, DM only). */
export const AudioAssetRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  seq: z.int(),
  name: z.string(),
  mime: AudioMime,
  bytes: z.int().min(1).max(AUDIO_MAX_BYTES),
  durationMs: z.int().min(0).max(AUDIO_MAX_MS),
  createdAt: z.string(),
});
export type AudioAssetRecord = z.infer<typeof AudioAssetRecord>;

/** FR-ASSET-56: `GET /api/assets/:id/audio`; a sound's capability URL (ADR-0023). */
export const audioPath = (id: string) => `/api/assets/${encodeURIComponent(id)}/audio`;
