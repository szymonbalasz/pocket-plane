// assets.ingest (FR-ASSET-01, -03, -04, -06, -08, -09) and assets.require (FR-ASSET-15).
// *(Sprint 8)* Sounds (FR-ASSET-52–60) share the command: `audio` in place of `image`.
import { createHash } from "node:crypto";
import {
  type AssetKind,
  AUDIO_LIBRARY_CAP,
  AUDIO_MAX_BYTES,
  AUDIO_MAX_MS,
  AudioMime,
} from "@shared/assets-pipeline/audio";
import { AssetName, type AssetRecord, nameFromFilename } from "@shared/assets-pipeline/schemas";
import { type DroppedTag, ImageTags } from "@shared/assets-pipeline/tags";
import { AssetIngested, AssetListed, AssetTagsSet } from "@shared/events/assets-pipeline";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import type { CommandContext } from "../../commands/context";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { asset, assetSeqNext } from "../../db/schema";
import type { Actor } from "../../events/types";
import type { ProcessedImage } from "./image";
import { assetUpsert, toAssetRecord } from "./records";
import type { AssetStore } from "./store";
import { addTags, campaignTagSpellings } from "./tags";

export const INGEST = "assets.ingest";

type AssetRow = typeof asset.$inferSelect;

const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected bytes");
const Dim = z.number().int().min(1);
const Derivative = z.object({ data: Bytes, width: Dim, height: Dim });

/** Output of `processImage` (async, no disk); the command itself is synchronous. */
export const ProcessedImageSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  original: Bytes,
  width: Dim,
  height: Dim,
  display: Derivative,
  thumb: Derivative,
}) satisfies z.ZodType<ProcessedImage>;

/** A probed sound (FR-ASSET-53): the stored file as uploaded; the route has checked the limits. */
export const ProbedAudioSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  mime: AudioMime,
  durationMs: z.int().min(1).max(AUDIO_MAX_MS),
  original: Bytes.refine((b) => b.byteLength <= AUDIO_MAX_BYTES, "Too large (max 512 KB)"),
});
export type ProbedAudio = z.infer<typeof ProbedAudioSchema>;

/** Exactly one of `image` / `audio` (sprint 8). */
export const IngestInput = z
  .object({
    image: ProcessedImageSchema.optional(),
    audio: ProbedAudioSchema.optional(),
    filename: z.string().max(1024),
    name: z.string().optional(),
    /** FR-ASSET-24 (S5): false = an attachment (outside the library and every snapshot). */
    listed: z.boolean().optional(),
    /** FR-ASSET-41 (S6): the upload context's tags; a new row without them gets `[]`. */
    tags: ImageTags.optional(),
  })
  .refine((v) => (v.image === undefined) !== (v.audio === undefined), {
    message: "Expected an image or a sound",
  });
export type IngestInput = z.input<typeof IngestInput>;

export interface IngestResult {
  asset: AssetRecord;
  outcome: "created" | "existing";
  /** FR-ASSET-41: sent tags not added (image full / campaign cap); absent when none. */
  droppedTags?: DroppedTag[];
}

const withDropped = (r: IngestResult, dropped: DroppedTag[]): IngestResult =>
  dropped.length > 0 ? { ...r, droppedTags: dropped } : r;

/** Name rule (FR-ASSET-08): given `name`, else the filename without extension. */
export function resolveName(filename: string, name?: string) {
  return AssetName.safeParse(name ?? nameFromFilename(filename));
}

/**
 * Asset ID (FR-ASSET-08): the next `ctx.tokens` draw. Seeded (fixture / test) contexts also mix
 * in the source bytes, so a fixture whose art changed gets a new ID and URL on reload: a URL
 * served `immutable` (FR-ASSET-14) never names other bytes (N2). Same bytes → same ID on every
 * load and machine (FR-ASSET-18). Real IDs are the token as drawn (ADR-0023).
 */
function nextAssetId(ctx: CommandContext, sourceHash: string): string {
  const token = ctx.tokens.next();
  if (ctx.fixtureKey === undefined) return token;
  return seededAssetId(token, sourceHash);
}

/** The seeded asset ID for a token draw and the source bytes' hash (fixtures, `bun test`). */
export function seededAssetId(token: string, sourceHash: string): string {
  return createHash("sha256")
    .update(`${token}:${sourceHash}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/**
 * `assets.ingest`, DM authority, campaign = `actor.campaignId` fixed at authentication
 * (FR-ASSET-09, CON-21). Files go to disk first, then row + log entry commit together;
 * `AssetIngested` dispatches after commit (FR-ASSET-06). Same image in the campaign →
 * `existing`, nothing written (FR-ASSET-03), except that a `listed` request lists an existing
 * attachment (`AssetListed`, FR-ASSET-26); `listed: false` never unlists. *(S5)* An attachment's
 * `AssetIngested` carries no record change (FR-ASSET-24). *(S6)* Tags (FR-ASSET-41): a new row
 * gets the sent ones (`[]` if none); `existing` adds them (union, `AssetTagsSet` if that changed
 * anything). A tag that doesn't fit is dropped (`droppedTags`); checked after the files are
 * written, so it never fails the upload.
 */
export function ingestCommand(store: AssetStore) {
  return defineCommand({
    name: INGEST,
    input: IngestInput,
    execute(
      { image, audio, filename, name, listed = true, tags: sent },
      { tx, ctx, actor, emit },
    ): IngestResult {
      const campaignId = actor.campaignId;
      if (!campaignId) throw conflict("No active campaign");
      const parsedName = resolveName(filename, name);
      if (!parsedName.success) {
        throw invalid(
          "Invalid name",
          parsedName.error.issues.map((i) => ({ path: ["name"], message: i.message })),
        );
      }
      if (audio) {
        return ingestAudio(store, audio, parsedName.data, { tx, ctx, emit, campaignId });
      }
      if (!image) throw invalid("Expected an image or a sound");
      if (createHash("sha256").update(image.original).digest("hex") !== image.hash) {
        throw invalid("Hash does not match the original");
      }

      const existing = tx
        .select()
        .from(asset)
        .where(and(eq(asset.campaignId, campaignId), eq(asset.hash, image.hash)))
        .get();
      if (existing) {
        // Files lost since (FR-ASSET-07 404s): this upload heals them (#163).
        store.repairFiles(image);
        let row: AssetRow = existing;
        let dropped: DroppedTag[] = [];
        if (sent !== undefined && sent.length > 0) {
          const current = existing.tags ?? [];
          const added = addTags(current, sent, campaignTagSpellings(tx, campaignId));
          dropped = added.dropped;
          if (added.tags.length > current.length) {
            row = { ...row, tags: added.tags, listed: row.listed || listed };
            tx.update(asset).set({ tags: added.tags }).where(eq(asset.id, existing.id)).run();
            emit({
              type: AssetTagsSet.type,
              campaignId,
              payload: { assetId: existing.id, tags: added.tags },
              changes: assetUpsert(row),
            });
          }
        }
        if (listed && !existing.listed) {
          row = { ...row, listed: true };
          tx.update(asset).set({ listed: true }).where(eq(asset.id, existing.id)).run();
          emit({
            type: AssetListed.type,
            campaignId,
            payload: { assetId: existing.id },
            // New to the library: an upsert for the DM (players: `asset` is hidden).
            changes: assetUpsert(row),
          });
        }
        return withDropped({ asset: toAssetRecord(row), outcome: "existing" }, dropped);
      }

      store.ensureFiles(image);
      // After the files (FR-ASSET-41): a tag that doesn't fit is dropped, the upload kept.
      const { tags, dropped } = addTags([], sent ?? [], campaignTagSpellings(tx, campaignId));

      let id = nextAssetId(ctx, image.sourceHash);
      while (tx.select({ id: asset.id }).from(asset).where(eq(asset.id, id)).get()) {
        id = nextAssetId(ctx, image.sourceHash);
      }
      tx.insert(asset)
        .values({
          id,
          campaignId,
          seq: assetSeqNext,
          name: parsedName.data,
          hash: image.hash,
          mime: image.mime,
          bytes: image.original.byteLength,
          width: image.width,
          height: image.height,
          displayWidth: image.display.width,
          displayHeight: image.display.height,
          createdAt: ctx.clock.iso(),
          listed,
          tags,
        })
        .run();
      const row = tx.select().from(asset).where(eq(asset.id, id)).get() as AssetRow;
      emit({
        type: AssetIngested.type,
        campaignId,
        payload: { assetId: id, hash: image.hash, bytes: row.bytes, listed, tags },
        changes: assetUpsert(row),
      });
      return withDropped({ asset: toAssetRecord(row), outcome: "created" }, dropped);
    },
  });
}

/**
 * FR-ASSET-52–58: a sound. Dedupe by hash as images (`existing`, files healed); else the cap
 * (50 per campaign, no delete) → `conflict` "Sound library full (50)"; files (`original` only)
 * before the row; the row: kind `audio`, image sizes 0, `listed` true, tags `[]` (FR-ASSET-60:
 * the upload's `listed` / `tags` are ignored). Its upsert is an `audio-asset` (DM only, lazy).
 */
function ingestAudio(
  store: AssetStore,
  audio: ProbedAudio,
  name: string,
  env: Pick<CommandEnv, "tx" | "ctx" | "emit"> & { campaignId: string },
): IngestResult {
  const { tx, ctx, emit, campaignId } = env;
  if (createHash("sha256").update(audio.original).digest("hex") !== audio.hash) {
    throw invalid("Hash does not match the original");
  }
  const existing = tx
    .select()
    .from(asset)
    .where(and(eq(asset.campaignId, campaignId), eq(asset.hash, audio.hash)))
    .get();
  if (existing) {
    store.repairAudioFiles(audio.hash, audio.original);
    return { asset: toAssetRecord(existing), outcome: "existing" };
  }
  const count = tx
    .select({ n: sql<number>`count(*)` })
    .from(asset)
    .where(and(eq(asset.campaignId, campaignId), eq(asset.kind, "audio")))
    .get();
  if ((count?.n ?? 0) >= AUDIO_LIBRARY_CAP) {
    throw conflict(`Sound library full (${AUDIO_LIBRARY_CAP})`);
  }
  store.ensureAudioFiles(audio.hash, audio.original);
  let id = nextAssetId(ctx, audio.hash);
  while (tx.select({ id: asset.id }).from(asset).where(eq(asset.id, id)).get()) {
    id = nextAssetId(ctx, audio.hash);
  }
  tx.insert(asset)
    .values({
      id,
      campaignId,
      seq: assetSeqNext,
      name,
      hash: audio.hash,
      mime: audio.mime,
      bytes: audio.original.byteLength,
      width: 0,
      height: 0,
      displayWidth: 0,
      displayHeight: 0,
      createdAt: ctx.clock.iso(),
      listed: true,
      tags: [],
      kind: "audio",
      durationMs: audio.durationMs,
    })
    .run();
  const row = tx.select().from(asset).where(eq(asset.id, id)).get() as AssetRow;
  emit({
    type: AssetIngested.type,
    campaignId,
    payload: { assetId: id, hash: audio.hash, bytes: row.bytes, listed: true, tags: [] },
    changes: assetUpsert(row),
  });
  return { asset: toAssetRecord(row), outcome: "created" };
}

/**
 * `assets.require(ctx, id, {kind?})` (FR-ASSET-15, -59): the asset of `actor.campaignId`, else
 * `not_found`; of `kind` (default `image`), else `invalid` (a sound as a map, an image as an alert
 * sound). Every command that sets an asset-ID field calls it, incl. propagated copies in its
 * transaction. A sound comes back in the `asset` shape too (image sizes 0); only its id is used.
 */
export function requireAsset(
  env: { tx: Tx; actor: Actor },
  id: string,
  opts: { kind?: AssetKind } = {},
): AssetRecord {
  const campaignId = env.actor.campaignId;
  const row = campaignId
    ? env.tx
        .select()
        .from(asset)
        .where(and(eq(asset.id, id), eq(asset.campaignId, campaignId)))
        .get()
    : undefined;
  if (!row) throw notFound("Asset not found");
  const kind = opts.kind ?? "image";
  if (row.kind !== kind) throw invalid(kind === "audio" ? "Not a sound" : "Not an image");
  return toAssetRecord(row);
}

/** Server API for other specs (protocol §13). */
export const assets = { require: requireAsset };
