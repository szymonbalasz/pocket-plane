// Fixture support (FR-ASSET-18, FR-FIX-17): committed SVGs go through `assets.ingest`,
// never copied into the asset dir. *(Sprint 8)* Bytes built in code (the `audio-chime` sound) go
// through the same path as an upload.
import { readFileSync } from "node:fs";
import path from "node:path";
import { WORKTREE_ROOT } from "../../config";
import type { SetupStep } from "../fixtures-adapters/fixture-types";
import { ASSETS_ROOT } from "../fixtures-adapters/loader";
import { INGEST } from "./commands";
import { type ProcessedImage, processImage } from "./image";
import { prepareIngest } from "./ingest";

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
  /** FR-ASSET-41 (S6): `ingestStep(file, {tags})`; absent = `[]`. Tags don't feed the ID seed. */
  tags?: string[];
}

/** Bytes built by a fixture module (no committed file), sniffed as an upload is. */
export interface FixtureBytes {
  bytes: () => Uint8Array;
  filename: string;
}

/**
 * Setup step ingesting `fixtures/assets/<file>` (or built bytes) as the DM, in the active
 * campaign. The input is async (image processing); the loader awaits it, then runs
 * `assets.ingest`. A string option is the asset name.
 */
export function ingestStep(
  file: string | FixtureBytes,
  opts: string | IngestStepOptions = {},
): SetupStep {
  const { name, listed, tags } =
    typeof opts === "string" ? ({ name: opts } as IngestStepOptions) : opts;
  if (typeof file !== "string") {
    return {
      command: INGEST,
      input: () =>
        prepareIngest({
          bytes: file.bytes(),
          filename: file.filename,
          ...(name !== undefined ? { name } : {}),
          ...(listed !== undefined ? { listed } : {}),
          ...(tags !== undefined ? { tags } : {}),
        }),
    };
  }
  return {
    command: INGEST,
    input: async () => ({
      image: await processFixtureImage(file),
      filename: path.basename(file),
      ...(name !== undefined ? { name } : {}),
      ...(listed !== undefined ? { listed } : {}),
      ...(tags !== undefined ? { tags } : {}),
    }),
  };
}
