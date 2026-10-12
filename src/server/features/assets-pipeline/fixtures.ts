// Fixture support (FR-ASSET-18, FR-FIX-17): committed SVGs go through `assets.ingest`,
// never copied into the asset dir.
import { readFileSync } from "node:fs";
import path from "node:path";
import { WORKTREE_ROOT } from "../../config";
import type { SetupStep } from "../fixtures-adapters/fixture-types";
import { ASSETS_ROOT } from "../fixtures-adapters/loader";
import { INGEST } from "./commands";
import { prepareIngest } from "./ingest";

/**
 * Setup step ingesting `fixtures/assets/<file>` as the DM, in the active campaign. The input is
 * async (image processing); the loader awaits it, then runs `assets.ingest`.
 */
export function ingestStep(file: string, name?: string): SetupStep {
  return {
    command: INGEST,
    input: () =>
      prepareIngest({
        bytes: readFileSync(path.join(WORKTREE_ROOT, ASSETS_ROOT, file)),
        filename: path.basename(file),
        ...(name !== undefined ? { name } : {}),
      }),
  };
}
