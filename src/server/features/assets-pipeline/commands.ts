// assets.ingest (FR-ASSET-01, -03, -04, -06, -08, -09) and assets.require (FR-ASSET-15).
import { createHash } from "node:crypto";
import { AssetName, type AssetRecord, nameFromFilename } from "@shared/assets-pipeline/schemas";
import { AssetIngested } from "@shared/events/assets-pipeline";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { asset, assetSeqNext } from "../../db/schema";
import type { Actor } from "../../events/types";
import type { ProcessedImage } from "./image";
import type { AssetStore } from "./store";

export const INGEST = "assets.ingest";

type AssetRow = typeof asset.$inferSelect;

/** The only mapping from a row to the wire: `hash` is dropped here (ASSET §8). */
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
});

const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected bytes");
const Dim = z.number().int().min(1);
const Derivative = z.object({ data: Bytes, width: Dim, height: Dim });

/** Output of `processImage` (async, no disk); the command itself is synchronous. */
export const ProcessedImageSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  original: Bytes,
  width: Dim,
  height: Dim,
  display: Derivative,
  thumb: Derivative,
}) satisfies z.ZodType<ProcessedImage>;

export const IngestInput = z.object({
  image: ProcessedImageSchema,
  filename: z.string().max(1024),
  name: z.string().optional(),
});
export type IngestInput = z.input<typeof IngestInput>;

export interface IngestResult {
  asset: AssetRecord;
  outcome: "created" | "existing";
}

/** Name rule (FR-ASSET-08): given `name`, else the filename without extension. */
export function resolveName(filename: string, name?: string) {
  return AssetName.safeParse(name ?? nameFromFilename(filename));
}

/**
 * `assets.ingest`, DM authority, campaign = `actor.campaignId` fixed at authentication
 * (FR-ASSET-09, CON-21). Files go to disk first, then row + log entry commit together;
 * `AssetIngested` dispatches after commit (FR-ASSET-06). Same image in the campaign →
 * `existing`, nothing written (FR-ASSET-03).
 */
export function ingestCommand(store: AssetStore) {
  return defineCommand({
    name: INGEST,
    input: IngestInput,
    execute({ image, filename, name }, { tx, ctx, actor, emit }): IngestResult {
      const campaignId = actor.campaignId;
      if (!campaignId) throw conflict("No active campaign");
      const parsedName = resolveName(filename, name);
      if (!parsedName.success) {
        throw invalid(
          "Invalid name",
          parsedName.error.issues.map((i) => ({ path: ["name"], message: i.message })),
        );
      }
      if (createHash("sha256").update(image.original).digest("hex") !== image.hash) {
        throw invalid("Hash does not match the original");
      }

      const existing = tx
        .select()
        .from(asset)
        .where(and(eq(asset.campaignId, campaignId), eq(asset.hash, image.hash)))
        .get();
      if (existing) return { asset: toAssetRecord(existing), outcome: "existing" };

      store.ensureFiles(image);

      let id = ctx.tokens.next();
      while (tx.select({ id: asset.id }).from(asset).where(eq(asset.id, id)).get()) {
        id = ctx.tokens.next();
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
        })
        .run();
      const row = tx.select().from(asset).where(eq(asset.id, id)).get() as AssetRow;
      const rec = toAssetRecord(row);
      emit({
        type: AssetIngested.type,
        campaignId,
        payload: { assetId: id, hash: image.hash, bytes: row.bytes },
        changes: [{ type: "asset", id, before: null, after: rec }],
      });
      return { asset: rec, outcome: "created" };
    },
  });
}

/**
 * `assets.require(ctx, id)` (FR-ASSET-15): the asset of `actor.campaignId`, else `not_found`.
 * Every command that sets an asset-ID field calls it, incl. propagated copies in its transaction.
 */
export function requireAsset(env: { tx: Tx; actor: Actor }, id: string): AssetRecord {
  const campaignId = env.actor.campaignId;
  const row = campaignId
    ? env.tx
        .select()
        .from(asset)
        .where(and(eq(asset.id, id), eq(asset.campaignId, campaignId)))
        .get()
    : undefined;
  if (!row) throw notFound("Asset not found");
  return toAssetRecord(row);
}

/** Server API for other specs (protocol §13). */
export const assets = { require: requireAsset };
