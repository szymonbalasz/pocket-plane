// Fixture support (FR-ASSET-18, FR-FIX-17): committed SVGs go through `assets.ingest`,
// never copied into the asset dir.
import { readFileSync } from "node:fs";
import path from "node:path";
import { seededContext } from "../../commands/context";
import { WORKTREE_ROOT } from "../../config";
import type { SetupStep } from "../fixtures-adapters/fixture-types";
import { ASSETS_ROOT } from "../fixtures-adapters/loader";
import { INGEST, seededAssetId } from "./commands";
import { type ProcessedImage, processImage } from "./image";

/**
 * Processed fixture images, per process, keyed by file and content hash. Processing is
 * deterministic and is most of a bundle load (sharp renders each SVG, ~1 s for `map-large`);
 * `bun test` loads bundles dozens of times per run (fix/test-speed). Nothing mutates an image.
 */
const processed = new Map<string, Promise<ProcessedImage>>();

function processFixtureImage(file: string): Promise<ProcessedImage> {
  const bytes = readFileSync(path.join(WORKTREE_ROOT, ASSETS_ROOT, file));
  const key = `${file}:${Bun.hash(bytes)}`;
  let hit = processed.get(key);
  if (!hit) {
    hit = processImage(bytes);
    hit.catch(() => processed.delete(key));
    processed.set(key, hit);
  }
  return hit;
}

export interface IngestStepOptions {
  name?: string;
  /** FR-ASSET-24 (S5): false = an attachment (ruling #26: `ingestStep(file, {listed: false})`). */
  listed?: boolean;
}

/**
 * Setup step ingesting `fixtures/assets/<file>` as the DM, in the active campaign. The input is
 * async (image processing); the loader awaits it, then runs `assets.ingest`. A string option is
 * the asset name.
 */
export function ingestStep(file: string, opts: string | IngestStepOptions = {}): SetupStep {
  const { name, listed } = typeof opts === "string" ? { name: opts, listed: undefined } : opts;
  return {
    command: INGEST,
    input: async () => ({
      image: await processFixtureImage(file),
      filename: path.basename(file),
      ...(name !== undefined ? { name } : {}),
      ...(listed !== undefined ? { listed } : {}),
    }),
  };
}

/**
 * The seeded ID of the attachment that fixture `fixtureKey` ingests from `file` with its
 * `draw`-th token (0 = its first ingest). An attachment's `AssetIngested` carries no record
 * change (FR-ASSET-24), so the loader's `r.id(key, "asset")` never sees it; a later step of the
 * same fixture computes it here instead (the loader's per-fixture seeded context, same formula as
 * `assets.ingest`). Pure: draws from a fresh seeded context, writes nothing. The fixture tests
 * assert it equals the stored row's ID.
 */
export async function fixtureAttachmentId(
  fixtureKey: string,
  file: string,
  draw = 0,
): Promise<string> {
  const tokens = seededContext({ disposable: true, key: fixtureKey }).tokens;
  let token = tokens.next();
  for (let i = 0; i < draw; i++) token = tokens.next();
  return seededAssetId(token, (await processFixtureImage(file)).sourceHash);
}
