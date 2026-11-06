// A tiny invented Griffon's Saddlebag export for tests (names and text made up; PNGs generated).
// Lives in a temp dir whose path has spaces, like the DM's OneDrive folder.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const hex = (s: string, n: number) => createHash("sha256").update(s).digest("hex").slice(0, n);
export const uidOf = (key: string) => `gsb_${hex(`test:${key}`, 20)}`;

// biome-ignore lint/suspicious/noExplicitAny: test items are loose JSON on purpose (extra fields)
export type RawItem = Record<string, any>;

export async function png(seed: number, size = 16): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: (seed * 70) % 256, g: (seed * 130) % 256, b: (seed * 40) % 256 },
    },
  })
    .png()
    .toBuffer();
}

export function rawItem(key: string, over: RawItem = {}): RawItem {
  const uid = uidOf(key);
  return {
    uid,
    contentHash: `sha256:${hex(`content:${key}`, 64)}`,
    source: { system: "griffons-saddlebag", id: key, url: `https://example.test/items/${key}` },
    name: `Test ${key}`,
    slug: key,
    type: "Wondrous item",
    subtype: null,
    typeLabel: "Wondrous item",
    rarity: "rare",
    rarities: ["rare"],
    attunement: { required: false, requirement: null },
    significance: "minor",
    meta: "Wondrous item, rare",
    flavor: null,
    description: `A made-up item called ${key}.`,
    descriptionFormat: "markdown",
    bookVolume: null,
    tags: [],
    treasureTheme: [],
    image: null,
    thumbnail: null,
    images: [],
    extra: { anything: true },
    ...over,
  };
}

export interface TestExport {
  root: string;
  dataDir: string;
  /** Writes an image's files under `assets/images/<id>/`; returns the item `images[]` row. */
  image(id: string, seed: number, sizes?: string[]): Promise<RawItem>;
  write(items: RawItem[], manifest?: RawItem): void;
}

export function testExport(): TestExport {
  const root = mkdtempSync(path.join(os.tmpdir(), "pp gsb exporter "));
  const dataDir = path.join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  return {
    root,
    dataDir,
    async image(id, seed, sizes = ["tiny", "medium"]) {
      const files: RawItem = {};
      for (const [i, size] of sizes.entries()) {
        const bytes = await png(seed * 10 + i, 8 * (i + 1));
        const rel = `assets/images/${id}/${size}.png`;
        mkdirSync(path.join(dataDir, "assets", "images", id), { recursive: true });
        writeFileSync(path.join(dataDir, rel), bytes);
        files[size] = {
          path: rel,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
          width: 8 * (i + 1),
          height: 8 * (i + 1),
        };
      }
      return { id, files };
    },
    write(items, manifest = {}) {
      writeFileSync(path.join(dataDir, "items.json"), JSON.stringify(items));
      writeFileSync(
        path.join(dataDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          datasetHash: `sha256:${hex(JSON.stringify(items), 64)}`,
          itemCount: items.length,
          files: { items: "items.json", assets: "assets/" },
          ...manifest,
        }),
      );
    },
  };
}
