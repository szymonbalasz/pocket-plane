// `assets.ingest {bytes, filename, name?}` (FR-ASSET-01) for REST and the fixture loader:
// async processing (no disk), then the synchronous `assets.ingest` command.
import type { RunOptions } from "../../commands/commands";
import type { Services } from "../../services";
import { INGEST, type IngestInput, type IngestResult } from "./commands";
import { processImage } from "./image";

export interface IngestRequest {
  bytes: Uint8Array;
  filename: string;
  name?: string;
  /** FR-ASSET-24 (S5): false = an attachment. Absent = listed. */
  listed?: boolean;
}

/** Async half of an ingest; the result is the `assets.ingest` command input. */
export async function prepareIngest(req: IngestRequest): Promise<IngestInput> {
  const image = await processImage(req.bytes);
  return {
    image,
    filename: req.filename,
    ...(req.name !== undefined ? { name: req.name } : {}),
    ...(req.listed !== undefined ? { listed: req.listed } : {}),
  };
}

/** Throws `IngestRejected` (413/415/422) or `CommandError`; nothing written on rejection. */
export async function ingestAsset(
  s: Services,
  req: IngestRequest,
  opts: RunOptions,
): Promise<IngestResult> {
  const input = await prepareIngest(req);
  return s.commands.run(INGEST, input, opts) as IngestResult;
}
