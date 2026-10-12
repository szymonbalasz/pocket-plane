// Image processing for ingest (FR-ASSET-02, -03, -05). Pure: no disk, no DB, no ctx.
// Format comes from content only; SVG is rasterised to PNG; derivatives are WebP via sharp.
import { createHash } from "node:crypto";
import { DISPLAY_EDGE, MAX_PIXELS, THUMB_EDGE } from "@shared/assets-pipeline/schemas";
import sharp, { type Metadata } from "sharp";

export type SourceFormat = "png" | "jpeg" | "webp" | "svg";

export type RejectStatus = 413 | 415 | 422;

/** An upload refused before anything is written (FR-ASSET-02). */
export class IngestRejected extends Error {
  override name = "IngestRejected";
  constructor(
    readonly status: RejectStatus,
    message: string,
  ) {
    super(message);
  }
}

export const unsupported = () => new IngestRejected(415, "Unsupported file type");
export const tooLarge = () => new IngestRejected(413, "File over 25 MB");
export const tooManyPixels = () => new IngestRejected(422, "Image over 50 megapixels");
export const corrupt = (detail = "Image is corrupt or unreadable") =>
  new IngestRejected(422, detail);

export interface Derivative {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ProcessedImage {
  /** SHA-256 hex of `original` (FR-ASSET-03). */
  hash: string;
  /** Stored original's type; SVG is stored as PNG (FR-ASSET-02). */
  mime: "image/png" | "image/jpeg" | "image/webp";
  original: Uint8Array;
  width: number;
  height: number;
  display: Derivative;
  thumb: Derivative;
}

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

const SVG_PROLOG =
  /^(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*<svg[\s>/]/i;

/** Content sniffing (FR-ASSET-01): never the extension or Content-Type. */
export function sniffFormat(bytes: Uint8Array): SourceFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  const head = decodeText(bytes.subarray(0, 4096));
  if (head !== null && SVG_PROLOG.test(head)) return "svg";
  return null;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    // fatal: a binary file is not SVG. A multi-byte char cut at the 4 KB edge is tolerated by
    // decoding the prefix with `stream: true`.
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return s.replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

/** Long edge ≤ `edge`, aspect kept, never upscaled (FR-ASSET-05). */
export function fitWithin(width: number, height: number, edge: number) {
  const long = Math.max(width, height);
  if (long <= edge) return { width, height };
  const k = edge / long;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}

const PX = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`, "i").exec(tag);
  return m?.[2] ?? null;
}

export interface SvgSize {
  width: number;
  height: number;
  /** Width/height attributes are not plain px: rasterise from the viewBox instead. */
  useViewBox: boolean;
}

/**
 * Intrinsic size of an SVG (FR-ASSET-02): px `width` + `height`, else the `viewBox` size.
 * Neither → null (422).
 */
export function svgIntrinsicSize(svg: string): SvgSize | null {
  const tag = /<svg[\s>/][^>]*>?/i.exec(svg)?.[0];
  if (!tag) return null;
  const w = PX.exec(attr(tag, "width") ?? "");
  const h = PX.exec(attr(tag, "height") ?? "");
  if (w && h) {
    const width = Math.round(Number(w[1]));
    const height = Math.round(Number(h[1]));
    if (width >= 1 && height >= 1) return { width, height, useViewBox: false };
  }
  const vb = (attr(tag, "viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) {
    const width = Math.round(vb[2] as number);
    const height = Math.round(vb[3] as number);
    if (width >= 1 && height >= 1) return { width, height, useViewBox: true };
  }
  return null;
}

/**
 * Never resolve external references (FR-ASSET-02): every `href` / `xlink:href` that isn't a
 * same-document `#fragment` and every CSS `url(…)` / `@import` is blanked before rasterising.
 */
export function neutralizeSvg(svg: string): string {
  return svg
    .replace(/(\s(?:xlink:)?href\s*=\s*)(["'])(?!#)[^"']*\2/gi, "$1$2#$2")
    .replace(/url\(\s*(?!["']?#)[^)]*\)/gi, "url(#)")
    .replace(/@import[^;]*;?/gi, "");
}

function prepareSvg(bytes: Uint8Array): { input: Buffer; width: number; height: number } {
  const text = decodeText(bytes);
  if (text === null) throw corrupt("SVG is not valid UTF-8");
  // Entities can pull in external files (XXE) or expand without bound.
  if (/<!ENTITY/i.test(text)) throw corrupt("SVG entity declarations are not allowed");
  const size = svgIntrinsicSize(text);
  if (!size) throw corrupt("SVG needs width and height or a viewBox");
  if (size.width * size.height > MAX_PIXELS) throw tooManyPixels();
  let svg = neutralizeSvg(text);
  if (size.useViewBox) {
    // Drop non-px width/height so the rasteriser sizes from the viewBox.
    svg = svg.replace(/<svg[\s>/][^>]*>?/i, (tag) =>
      tag.replace(/\s(?:width|height)\s*=\s*(["'])[^"']*\1/gi, ""),
    );
  }
  return { input: Buffer.from(svg, "utf8"), width: size.width, height: size.height };
}

const SHARP_OPTS = { limitInputPixels: MAX_PIXELS, failOn: "error" as const };

async function derive(src: Buffer, edge: number): Promise<Derivative> {
  const { data, info } = await sharp(src, SHARP_OPTS)
    .autoOrient()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/**
 * Validate and process an upload (FR-ASSET-02, -05). Throws `IngestRejected` (415 / 422);
 * the 413 body limit is enforced by the caller before the bytes are read.
 */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  const format = sniffFormat(bytes);
  if (!format) throw unsupported();

  let original: Buffer;
  let mime: ProcessedImage["mime"];
  let width: number;
  let height: number;
  if (format === "svg") {
    const svg = prepareSvg(bytes);
    try {
      original = await sharp(svg.input, { ...SHARP_OPTS, density: 72 })
        .png()
        .toBuffer();
    } catch {
      throw corrupt("SVG could not be rendered");
    }
    mime = "image/png";
    width = svg.width;
    height = svg.height;
  } else {
    original = Buffer.from(bytes);
    mime = MIME[format];
    let meta: Metadata;
    try {
      // Header only: no pixel limit here, so an oversized image reports its size (422 below).
      meta = await sharp(original, { limitInputPixels: false }).metadata();
    } catch {
      throw corrupt();
    }
    if (!meta.width || !meta.height) throw corrupt();
    // Header check before any pixel decode (decompression bombs).
    if (meta.width * (meta.pageHeight ?? meta.height) > MAX_PIXELS) throw tooManyPixels();
    const h = meta.pageHeight ?? meta.height;
    const swap = (meta.orientation ?? 1) >= 5;
    width = swap ? h : meta.width;
    height = swap ? meta.width : h;
  }

  let display: Derivative;
  let thumb: Derivative;
  try {
    [display, thumb] = await Promise.all([
      derive(original, DISPLAY_EDGE),
      derive(original, THUMB_EDGE),
    ]);
  } catch {
    throw corrupt();
  }
  const hash = createHash("sha256").update(original).digest("hex");
  return { hash, mime, original: new Uint8Array(original), width, height, display, thumb };
}
