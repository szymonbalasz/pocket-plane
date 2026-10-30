// Materialises the 5etools-mini folder (compendium-expansion §13): invented content in 5etools'
// layout. The JSON is copied as is; token SVGs are rasterised to the `.webp` the adapter looks for
// (no generated file is committed, FR-CMPX-20).
//   bun fixtures/5etools-mini/prepare.ts <target dir>
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const FIVE_ETOOLS_MINI_DIR = import.meta.dir;

const TOKENS = "img/bestiary/tokens";

export async function prepare5etoolsMini(target: string): Promise<string> {
  cpSync(path.join(FIVE_ETOOLS_MINI_DIR, "data"), path.join(target, "data"), { recursive: true });
  const root = path.join(FIVE_ETOOLS_MINI_DIR, TOKENS);
  for (const source of readdirSync(root)) {
    const out = path.join(target, TOKENS, source);
    mkdirSync(out, { recursive: true });
    for (const file of readdirSync(path.join(root, source))) {
      if (!file.endsWith(".svg")) continue;
      const webp = await sharp(path.join(root, source, file))
        .webp()
        .toBuffer();
      writeFileSync(path.join(out, `${path.basename(file, ".svg")}.webp`), webp);
    }
  }
  return target;
}

if (import.meta.main) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: bun fixtures/5etools-mini/prepare.ts <target dir>");
    process.exit(2);
  }
  await prepare5etoolsMini(path.resolve(target));
  console.log(`5etools-mini written to ${path.resolve(target)}`);
}
