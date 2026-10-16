// Loads the bundled source `srd-5.1` from its recorded files (FR-CMP-06). Repo files only;
// never the network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { OPEN5E_ENDPOINTS, type Open5eResponses } from "../../adapter/open5e";
import { type BundledFile, sourceVersion } from "../../adapter/version";
import { ATTRIBUTION_FILE, SRD_51_SOURCE } from "./source";

export { SRD_51_SOURCE } from "./source";

export const SRD_51_DIR = import.meta.dir;
export const SRD_51_FILES = [...OPEN5E_ENDPOINTS.map((e) => `${e}.json`), ATTRIBUTION_FILE];

export interface BundledSource {
  source: typeof SRD_51_SOURCE;
  version: string;
  files: BundledFile[];
  responses: Open5eResponses;
}

export function loadSrd51(): BundledSource {
  const files = SRD_51_FILES.map((name) => ({
    name,
    text: readFileSync(path.join(SRD_51_DIR, name), "utf8"),
  }));
  const responses: Open5eResponses = {};
  for (const e of OPEN5E_ENDPOINTS) {
    const f = files.find((x) => x.name === `${e}.json`)!;
    responses[e] = JSON.parse(f.text) as unknown[];
  }
  return { source: SRD_51_SOURCE, version: sourceVersion(files), files, responses };
}
