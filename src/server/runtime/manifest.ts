// Load manifest `$PP_DATA_DIR/load-manifest.json` (FIX §8, FR-FIX-09/28). Never holds the DM secret.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { renameRetrying } from "./rename";

export const MANIFEST_FILE = "load-manifest.json";

export const ManifestStatus = z.enum(["resetting", "empty", "loading", "complete"]);
export type ManifestStatus = z.infer<typeof ManifestStatus>;

export const Manifest = z.object({
  status: ManifestStatus,
  bundle: z.string().nullable(),
  fixtures: z.array(z.string()),
  /** fixture key → record type → record IDs created by it. */
  records: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  dmUrl: z.string().nullable(),
  playerLinks: z.array(z.object({ player: z.string(), campaign: z.string(), url: z.string() })),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
});
export type Manifest = z.infer<typeof Manifest>;

export function manifestPath(dataDir: string): string {
  return path.join(dataDir, MANIFEST_FILE);
}

export function readManifest(dataDir: string): Manifest | null {
  try {
    return Manifest.parse(JSON.parse(readFileSync(manifestPath(dataDir), "utf8")));
  } catch {
    return null;
  }
}

/** Atomic write (temp + rename) so a crash never leaves a half-written manifest. */
export function writeManifest(dataDir: string, m: Manifest): void {
  const file = manifestPath(dataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(Manifest.parse(m), null, 2)}\n`);
  renameRetrying(tmp, file);
}
