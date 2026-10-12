// assets-pipeline boundary schemas (ASSET §6, §8, §9). Used by server and both clients.
import { z } from "zod";

/** FR-ASSET-02 (OQ-ASSET-06, proposed): request body limit. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** FR-ASSET-02: pixel limit, read from the header before decoding. */
export const MAX_PIXELS = 50_000_000;
/** FR-ASSET-05 (OQ-ASSET-03): long-edge limits of the derivatives. */
export const THUMB_EDGE = 512;
export const DISPLAY_EDGE = 4096;
/** FR-ASSET-08: name length. */
export const MAX_NAME_LENGTH = 80;

/** 128-bit base64url capability ID (FR-ASSET-08, ADR-0023). */
export const AssetId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** Servable derivatives (FR-ASSET-11). Originals are never served. */
export const AssetFile = z.enum(["thumb", "display"]);
export type AssetFile = z.infer<typeof AssetFile>;

/** Wire shape of record type `asset` (ASSET §9). `hash` is server-only. */
export const AssetRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  seq: z.number().int(),
  name: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  displayWidth: z.number().int(),
  displayHeight: z.number().int(),
  createdAt: z.string(),
});
export type AssetRecord = z.infer<typeof AssetRecord>;

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the rule (FR-ASSET-08).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** FR-ASSET-08: control characters removed, then trimmed; 1–80 chars. */
export const AssetName = z
  .string()
  .transform((s) => s.replace(CONTROL, "").trim())
  .refine((s) => s.length >= 1, { message: "Name is required" })
  .refine((s) => [...s].length <= MAX_NAME_LENGTH, {
    message: `Name must be at most ${MAX_NAME_LENGTH} characters`,
  });

/** Base name of an upload without directory or extension (FR-ASSET-08). */
export function nameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Picker order (FR-ASSET-10): `createdAt` desc, then `seq` desc. */
export function pickerOrder(a: AssetRecord, b: AssetRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return b.seq - a.seq;
}

/** `GET /api/assets/:id/:file` (FR-ASSET-11); clients build URLs from record fields only. */
export const assetPath = (id: string, file: AssetFile) =>
  `/api/assets/${encodeURIComponent(id)}/${file}`;

/** POST /api/assets responses (ASSET §9): 201 created, 200 existing. */
export const UploadResponse = z.object({ asset: AssetRecord });
export type UploadResponse = z.infer<typeof UploadResponse>;
