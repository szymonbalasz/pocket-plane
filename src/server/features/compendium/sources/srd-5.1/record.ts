// Recorder for the bundled source `srd-5.1` (FR-CMP-06). Run by hand, never in tests:
//   bun src/server/features/compendium/sources/srd-5.1/record.ts
// The only network use in the compendium. Writes `<endpoint>.json` (wotc-srd records only,
// nested class `archetypes` filtered too, sorted by slug) and the attribution file next to it,
// then formats them with Biome.
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  ATTRIBUTION_FILE,
  OPEN5E_ENDPOINTS,
  OPEN5E_V1_URL,
  SRD_51_ATTRIBUTION,
  SRD_DOCUMENT_SLUG,
} from "./source";

type Rec = { slug: string; document__slug?: string; archetypes?: Rec[] } & Record<string, unknown>;

const isSrd = (r: Rec) => r.document__slug === SRD_DOCUMENT_SLUG;

async function fetchAll(endpoint: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let url: string | null =
    `${OPEN5E_V1_URL}${endpoint}/?document__slug=${SRD_DOCUMENT_SLUG}&limit=500`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const page = (await res.json()) as { next: string | null; results: Rec[] };
    out.push(...page.results);
    url = page.next;
  }
  return out;
}

function filter(records: Rec[]): Rec[] {
  return records
    .filter(isSrd)
    .map((r) => (r.archetypes ? { ...r, archetypes: r.archetypes.filter(isSrd) } : r))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

const dir = import.meta.dir;
let total = 0;
for (const endpoint of OPEN5E_ENDPOINTS) {
  const records = filter(await fetchAll(endpoint));
  const text = `${JSON.stringify(records, null, 2)}\n`;
  writeFileSync(path.join(dir, `${endpoint}.json`), text);
  total += text.length;
  console.log(`${endpoint}: ${records.length} records, ${text.length} B`);
}
writeFileSync(
  path.join(dir, ATTRIBUTION_FILE),
  [
    "# SRD 5.1 — attribution",
    "",
    SRD_51_ATTRIBUTION,
    "",
    "## Provenance",
    "",
    `Transcribed from the Open5e API v1 (${OPEN5E_V1_URL}), records with`,
    `\`document__slug = ${SRD_DOCUMENT_SLUG}\` only (class archetypes included). Open5e is the`,
    "transcription source only; this content is used under CC BY 4.0, not Open5e's licence label.",
    "",
  ].join("\n"),
);
// Committed files must pass `bun run lint` as written: let Biome lay out the JSON.
const fmt = Bun.spawnSync(["bun", "x", "biome", "format", "--write", dir], { stdout: "inherit" });
if (fmt.exitCode !== 0) throw new Error("biome format failed");
console.log(`total before formatting: ${total} B`);
