// The import ledger: which dataset item became which homebrew entry, per target and campaign.
// `data/griffons-saddlebag/<target>-<campaignId>.json` in the checkout (gitignored). Hashes and
// ids only, never item content. Written atomically (tmp + rename) after every item.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GsbError } from "./dataset";

export const LEDGER_VERSION = 1;

export const LedgerRow = z.object({
  entryId: z.string().min(1),
  contentHash: z.string().min(1),
  writtenHash: z.string().min(1),
  imageAssetIds: z.array(z.string()),
  imageSha256s: z.array(z.string()),
  /** `MAPPER_VERSION` the entry was written with; absent = 1 (before the field). */
  mapperVersion: z.number().int().min(1).optional(),
  removedAt: z.string().optional(),
});
export type LedgerRow = z.infer<typeof LedgerRow>;

export const rowMapperVersion = (r: LedgerRow) => r.mapperVersion ?? 1;

export const Ledger = z.object({
  schemaVersion: z.literal(LEDGER_VERSION),
  datasetHash: z.string().nullable(),
  importedAt: z.string().nullable(),
  items: z.record(z.string(), LedgerRow),
});
export type Ledger = z.infer<typeof Ledger>;

export const emptyLedger = (): Ledger => ({
  schemaVersion: LEDGER_VERSION,
  datasetHash: null,
  importedAt: null,
  items: {},
});

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

export function ledgerPath(dir: string, target: string, campaignId: string): string {
  return path.join(dir, `${safe(target)}-${safe(campaignId)}.json`);
}

/** The ledger at `file`; none yet → empty. A corrupt file is refused, never overwritten. */
export function loadLedger(file: string): Ledger {
  if (!existsSync(file)) return emptyLedger();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new GsbError(`Can't read the ledger "${file}": ${(err as Error).message}`);
  }
  const r = Ledger.safeParse(raw);
  if (!r.success) {
    throw new GsbError(`The ledger "${file}" doesn't validate; move it away to start over.`);
  }
  return r.data;
}

export function saveLedger(file: string, ledger: Ledger): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(tmp, file);
}
