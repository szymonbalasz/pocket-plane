// Record type `asset` (FR-ASSET-10, ASSET §9): scope campaign; DM full, players never.
// *(S5)* Library (listed) assets only: an attachment has no record (FR-ASSET-24).
// *(Sprint 8, TT0)* Images only: audio rows sync as the lazy DM-only `audio-asset` (FR-ASSET-57).
import { AUDIO_ASSET_TYPE, AudioAssetRecord, AudioMime } from "@shared/assets-pipeline/audio";
import { AssetRecord } from "@shared/assets-pipeline/schemas";
import { and, asc, eq } from "drizzle-orm";
import { asset } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { defineRecordType } from "../../ws/records";

type AssetRow = typeof asset.$inferSelect;

/**
 * The only mapping from a row to the wire: `hash` and `listed` are dropped here (ASSET §8).
 * *(S6)* A pre-IM-1 row's null `tags` is sent as `[]` (FR-ASSET-10).
 */
export const toAssetRecord = (r: AssetRow): AssetRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  seq: r.seq,
  name: r.name,
  mime: r.mime,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  displayWidth: r.displayWidth,
  displayHeight: r.displayHeight,
  createdAt: r.createdAt,
  tags: r.tags ?? [],
});

/** FR-ASSET-57: the only mapping from an audio row to the wire (`hash`, image sizes dropped). */
export const toAudioAssetRecord = (r: AssetRow): AudioAssetRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  seq: r.seq,
  name: r.name,
  mime: AudioMime.parse(r.mime),
  bytes: r.bytes,
  durationMs: r.durationMs ?? 0,
  createdAt: r.createdAt,
});

/**
 * The new row's upsert (DM): a listed image → `asset`; an attachment has no record
 * (FR-ASSET-24); a sound → `audio-asset` (FR-ASSET-57).
 */
export function assetUpsert(row: AssetRow): RecordChange[] {
  if (row.kind === "audio") {
    return [{ type: AUDIO_ASSET_TYPE, id: row.id, before: null, after: toAudioAssetRecord(row) }];
  }
  return row.listed ? [{ type: "asset", id: row.id, before: null, after: toAssetRecord(row) }] : [];
}

export const assetRecordType = defineRecordType<AssetRecord>({
  type: "asset",
  scope: "campaign",
  // Players: hidden, and not even an empty snapshot list (FR-ASSET-10, FR-ASSET-12).
  audience: "dm",
  schema: AssetRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  // The campaign's listed images (S5: attachments never, FR-ASSET-24; sprint 8: sounds never,
  // FR-ASSET-57); array order not significant (picker sorts).
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(asset)
      .where(
        and(eq(asset.campaignId, v.campaignId), eq(asset.listed, true), eq(asset.kind, "image")),
      )
      .orderBy(asc(asset.seq))
      .all()
      .map(toAssetRecord),
});

/**
 * `audio-asset` (FR-ASSET-57): the campaign's sounds (≤ 50), **lazy** `all` (ADR-0045: 0 B in
 * every snapshot; the Campaign options dialog loads the library) and DM only (a player
 * `sync.load` → `forbidden`). Players learn a sound's ID only as a pick in `campaign.alertSounds`.
 */
export const audioAssetRecordType = defineRecordType<AudioAssetRecord>({
  type: AUDIO_ASSET_TYPE,
  scope: "campaign",
  audience: "dm",
  lazy: "all",
  schema: AudioAssetRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(asset)
      .where(and(eq(asset.campaignId, v.campaignId), eq(asset.kind, "audio")))
      .orderBy(asc(asset.seq))
      .all()
      .map(toAudioAssetRecord),
});
