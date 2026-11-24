// Griffon's Saddlebag dataset (`bun run gsb:import`): the exporter's data folder (its
// `GSB_DATA_DIR`, kept outside the exporter repo): `manifest.json` and `items.json`, read-only.
// Only the fields the import uses are checked; the rest (and `extra`, `raw/`) is ignored.
// Reference: `<exporter>/schema/item.schema.json`.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const DATA_ENV = "GRIFFONS_SADDLEBAG_DATA_PATH";
/** The old variable: the exporter repo root, with the dataset in its `data/`. Now refused with a hint. */
export const OLD_EXPORTER_ENV = "GRIFFONS_SADDLEBAG_EXPORTER_PATH";
export const SCHEMA_VERSION = 1;

/** A refusal the CLI prints as is (exit 1). */
export class GsbError extends Error {
  override name = "GsbError";
}

export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "very rare",
  "legendary",
  "artifact",
] as const;
export const IMAGE_SIZES = ["tiny", "small", "medium", "original"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const Manifest = z.object({
  schemaVersion: z.number(),
  datasetHash: z.string().min(1),
  itemCount: z.number().int().optional(),
  files: z.object({ items: z.string().min(1) }).optional(),
});
export type Manifest = z.infer<typeof Manifest>;

const ImageFile = z.object({ path: z.string().min(1), sha256: z.string().min(1) });
export const ItemImage = z.object({
  id: z.string().min(1),
  files: z.partialRecord(z.enum(IMAGE_SIZES), ImageFile),
});
export type ItemImage = z.infer<typeof ItemImage>;

const strings = z.array(z.string()).default([]);
const optText = z.string().nullish();

export const Item = z.object({
  uid: z.string().regex(/^gsb_[0-9a-f]{20}$/),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  source: z.object({ url: optText }).default({}),
  name: z.string().min(1),
  type: optText,
  typeLabel: optText,
  rarity: z.string(),
  rarities: z.array(z.enum(RARITIES)),
  attunement: z.object({ required: z.boolean().default(false), requirement: optText }),
  meta: optText,
  flavor: optText,
  description: z.string(),
  bookVolume: z.number().int().nullish(),
  tags: strings,
  treasureTheme: strings,
  image: optText,
  images: z.array(ItemImage),
});
export type Item = z.infer<typeof Item>;

export interface Dataset {
  /** The data folder (absolute): `manifest.json`, `items.json`; image paths resolve from here. */
  dataDir: string;
  manifest: Manifest;
  items: Item[];
}

const quote = (p: string) => `"${p}"`;
const envPath = (env: Record<string, string | undefined>, name: string) =>
  env[name]?.trim().replace(/^"(.*)"$/, "$1");

/** The data folder from the env, or a refusal that names the variable and `.env`. */
export function dataRoot(env: Record<string, string | undefined>, cwd: string): string {
  const raw = envPath(env, DATA_ENV);
  if (!raw) {
    const old = envPath(env, OLD_EXPORTER_ENV);
    throw new GsbError(
      `${DATA_ENV} is not set. Put the absolute path of the Griffon's Saddlebag data folder ` +
        `(the one holding manifest.json) in .env (e.g. ${DATA_ENV}=C:\\path\\to\\griffons-saddlebag).` +
        (old ? ` ${OLD_EXPORTER_ENV} is no longer read: replace it with ${DATA_ENV}.` : ""),
    );
  }
  return path.resolve(cwd, raw);
}

async function readJson(file: string, what: string): Promise<unknown> {
  if (!existsSync(file)) {
    throw new GsbError(`No ${what} at ${quote(file)}. Run the exporter first, or fix ${DATA_ENV}.`);
  }
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new GsbError(`Can't read ${what} ${quote(file)}: ${(err as Error).message}`);
  }
}

const issueText = (e: z.ZodError, max = 5) =>
  e.issues
    .slice(0, max)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

/** Preflight + read (FR: brief §2): manifest, schema version, items. Writes nothing. */
export async function readDataset(dataDir: string): Promise<Dataset> {
  const manifestPath = path.join(dataDir, "manifest.json");
  const m = Manifest.safeParse(await readJson(manifestPath, "manifest"));
  if (!m.success) throw new GsbError(`Bad manifest ${quote(manifestPath)}: ${issueText(m.error)}`);
  if (m.data.schemaVersion !== SCHEMA_VERSION) {
    throw new GsbError(
      `Manifest schemaVersion ${m.data.schemaVersion} isn't supported (expected ${SCHEMA_VERSION}). Update Pocket Plane's importer.`,
    );
  }
  const itemsPath = path.join(dataDir, m.data.files?.items ?? "items.json");
  const raw = await readJson(itemsPath, "items file");
  if (!Array.isArray(raw)) throw new GsbError(`Items file ${quote(itemsPath)} isn't a JSON array`);
  const items: Item[] = [];
  const bad: string[] = [];
  for (const [i, r] of raw.entries()) {
    const p = Item.safeParse(r);
    if (p.success) items.push(p.data);
    else bad.push(`#${i}: ${issueText(p.error, 2)}`);
  }
  if (bad.length > 0) {
    throw new GsbError(
      `${bad.length} item(s) in ${quote(itemsPath)} don't match schema v1: ${bad.slice(0, 3).join(" | ")}`,
    );
  }
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.uid)) throw new GsbError(`Duplicate uid ${it.uid} in ${quote(itemsPath)}`);
    seen.add(it.uid);
  }
  return { dataDir, manifest: m.data, items };
}

/** `<dataDir>/<rel>`, or null when `rel` escapes the data dir. */
export function dataPath(dataDir: string, rel: string): string | null {
  const p = path.resolve(dataDir, rel);
  const r = path.relative(dataDir, p);
  return r === "" || r.startsWith("..") || path.isAbsolute(r) ? null : p;
}
