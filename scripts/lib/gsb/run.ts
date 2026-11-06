// `gsb:import` core over one MCP session: target campaign → ledger → diff → (dry run: plan_check)
// or (apply: images, create / edit, read back, ledger row per item). Never deletes an entry,
// never shares one, never retries a write.
import { existsSync } from "node:fs";
import { entryNameKey, NAME_MAX } from "@shared/compendium/schemas";
import type { Dataset, Item } from "./dataset";
import { GsbError } from "./dataset";
import { type Diff, diff, type Filters, isFiltered } from "./diff";
import { type Ledger, type LedgerRow, ledgerPath, loadLedger, saveLedger } from "./ledger";
import { entryHash, type ItemEntry, MAPPER_VERSION, type Mapped, mapItem } from "./map";
import { FATAL_CODES, type ToolCaller, ToolFailure } from "./tools";

export const PLAN_CHUNK = 50;
export const NAMES_SHOWN = 20;
const HOMEBREW = "Homebrew";

interface StoredEntry {
  id: string;
  kind: string;
  name: string;
  facets: unknown;
  body: unknown;
  imageAssetIds: string[];
  source: string | null;
}
interface SearchHit {
  id: string;
  name: string;
  sourceLabel: string;
  group?: { count: number };
}

export interface ImportOptions {
  caller: ToolCaller;
  dataset: Dataset;
  /** Ledger label: the profile name, or `play`. */
  target: string;
  ledgerDir: string;
  filters: Filters;
  apply: boolean;
  overwrite: boolean;
  now?: () => string;
  /** Progress lines (stderr in the CLI). */
  progress?: (line: string) => void;
  progressEvery?: number;
  exists?: (p: string) => boolean;
  /** Tests only: stands in for a bumped `MAPPER_VERSION`. */
  mapperVersion?: number;
}

export interface ItemNote {
  uid: string;
  name: string;
  message: string;
}
export interface Failure extends ItemNote {
  code: string;
}

export const BUCKETS = [
  "new",
  "changed",
  "unchanged",
  "removed",
  "locallyEdited",
  "deleted",
  "adopt",
  "clash",
] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface Summary {
  mode: "dry-run" | "apply";
  target: string;
  campaign: { id: string; name: string };
  ledger: string;
  datasetHash: string;
  /** The dataset hash differs from the last full import's. */
  datasetChanged: boolean;
  filtered: boolean;
  overwrite: boolean;
  /** No new, changed or removed item (unfiltered: the campaign is in step with the dataset). */
  nothingChanged: boolean;
  counts: Record<Bucket, number>;
  /** First `NAMES_SHOWN` names per bucket (removed: uids; the ledger keeps no names). */
  names: Record<Bucket, { shown: string[]; more: number }>;
  /** Items this run would write (or wrote). */
  work: number;
  planIssues: ItemNote[];
  warnings: ItemNote[];
  result?: {
    created: number;
    updated: number;
    adopted: number;
    skipped: number;
    failed: number;
    removed: number;
  };
  failures: Failure[];
  stopped?: { code: string; message: string };
}

type Work =
  | { op: "create"; item: Item; m: Mapped; row?: LedgerRow }
  | { op: "edit"; item: Item; m: Mapped; row: LedgerRow; stored: StoredEntry };

const clipQ = (s: string) => [...s.trim()].slice(0, NAME_MAX).join("");
const storedHash = (e: StoredEntry) => entryHash(e);

/** `patch` for `homebrew_edit`: the whole mapped entry; stored keys it lacks are removed (null). */
export function patchOf(stored: StoredEntry, entry: ItemEntry, imageAssetIds?: string[]) {
  const over = (old: unknown, next: object): Record<string, unknown> => ({
    ...Object.fromEntries(
      Object.keys((old ?? {}) as object)
        .filter((k) => !(k in next))
        .map((k) => [k, null]),
    ),
    ...next,
  });
  return {
    name: entry.name,
    facets: over(stored.facets, entry.facets),
    body: over(stored.body, entry.body),
    ...(imageAssetIds ? { imageAssetIds } : {}),
  };
}

async function getEntry(caller: ToolCaller, id: string): Promise<StoredEntry | null> {
  try {
    return (await caller.call<{ entry: StoredEntry }>("compendium_get", { id })).entry;
  } catch (err) {
    if (err instanceof ToolFailure && err.code === "not_found") return null;
    throw err;
  }
}

/** The campaign's homebrew item named `name` whose text carries `uid` (an earlier import). */
export async function findImported(
  caller: ToolCaller,
  name: string,
  uid: string,
): Promise<StoredEntry | null> {
  const q = clipQ(name);
  const key = entryNameKey(name);
  const search = (args: Record<string, unknown>) =>
    caller.call<{ results: SearchHit[] }>("compendium_search", args);
  const { results } = await search({ q, kind: "item" });
  for (const r of results.filter((x) => entryNameKey(x.name) === key)) {
    const members = r.group ? (await search({ sameAs: r.id, q })).results : [r];
    for (const hit of members) {
      if (hit.sourceLabel !== HOMEBREW || entryNameKey(hit.name) !== key) continue;
      const e = await getEntry(caller, hit.id);
      const text = (e?.body as { text?: unknown } | undefined)?.text;
      if (e && e.source === null && typeof text === "string" && text.includes(uid)) return e;
    }
  }
  return null;
}

const emptyCounts = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;

function namesOf(list: readonly string[]) {
  return { shown: list.slice(0, NAMES_SHOWN), more: Math.max(0, list.length - NAMES_SHOWN) };
}

export async function runImport(o: ImportOptions): Promise<Summary> {
  const { caller, dataset } = o;
  const now = o.now ?? (() => new Date().toISOString());
  const exists = o.exists ?? existsSync;
  const progress = o.progress ?? (() => {});

  const { campaigns } = await caller.call<{
    campaigns: { id: string; name: string; active: boolean }[];
  }>("campaigns_list", {});
  const active = campaigns.find((c) => c.active);
  if (!active) throw new GsbError("No active campaign: open one in the DM client, then rerun.");
  const file = ledgerPath(o.ledgerDir, o.target, active.id);
  const ledger: Ledger = loadLedger(file);
  const filtered = isFiltered(o.filters);
  const d: Diff = diff(dataset.items, ledger, o.filters, o.mapperVersion);

  const buckets: Record<Bucket, string[]> = Object.fromEntries(
    BUCKETS.map((b) => [b, [] as string[]]),
  ) as Record<Bucket, string[]>;
  buckets.new = d.new.map((i) => i.name);
  buckets.changed = d.changed.map((i) => i.name);
  buckets.unchanged = d.unchanged.map((i) => i.name);
  buckets.removed = d.removed;

  const warnings: ItemNote[] = [];
  const mapped = (item: Item) => {
    const m = mapItem(item, dataset.dataDir, exists);
    for (const w of m.warnings) warnings.push({ uid: item.uid, name: item.name, message: w });
    return m;
  };

  // Changed upstream: the stored entry decides edit / locallyEdited / deleted.
  const work: Work[] = [];
  const order = new Map(dataset.items.map((it, i) => [it.uid, i]));
  for (const item of d.new) work.push({ op: "create", item, m: mapped(item) });
  for (const item of d.changed) {
    const row = ledger.items[item.uid] as LedgerRow;
    const stored = await getEntry(caller, row.entryId);
    if (!stored) {
      buckets.deleted.push(item.name);
      if (o.overwrite) work.push({ op: "create", item, m: mapped(item), row });
    } else if (storedHash(stored) !== row.writtenHash) {
      buckets.locallyEdited.push(item.name);
      if (o.overwrite) work.push({ op: "edit", item, m: mapped(item), row, stored });
    } else {
      work.push({ op: "edit", item, m: mapped(item), row, stored });
    }
  }
  work.sort((a, b) => (order.get(a.item.uid) ?? 0) - (order.get(b.item.uid) ?? 0));

  const summary: Summary = {
    mode: o.apply ? "apply" : "dry-run",
    target: o.target,
    campaign: { id: active.id, name: active.name },
    ledger: file,
    datasetHash: dataset.manifest.datasetHash,
    datasetChanged: ledger.datasetHash !== dataset.manifest.datasetHash,
    filtered,
    overwrite: o.overwrite,
    nothingChanged: d.new.length + d.changed.length + d.removed.length === 0,
    counts: emptyCounts(),
    names: {} as Summary["names"],
    work: work.length,
    planIssues: [],
    warnings,
    failures: [],
  };
  const finish = () => {
    for (const b of BUCKETS) {
      summary.counts[b] = buckets[b].length;
      summary.names[b] = namesOf(buckets[b]);
    }
    return summary;
  };

  if (!o.apply) {
    await dryRun(caller, work, buckets, summary.planIssues);
    return finish();
  }
  await applyWork(o, work, ledger, file, progress, summary);
  if (summary.result && !o.overwrite) {
    summary.result.skipped += buckets.locallyEdited.length + buckets.deleted.length;
  }
  // Removed upstream: reported and marked, the entry is kept.
  let removed = 0;
  if (!summary.stopped) {
    const at = now();
    for (const uid of d.removed) {
      const row = ledger.items[uid];
      if (row) {
        row.removedAt = at;
        removed++;
      }
    }
    for (const it of d.unchanged) {
      const row = ledger.items[it.uid];
      if (row?.removedAt !== undefined) delete row.removedAt;
    }
    if (!filtered && summary.failures.length === 0) {
      ledger.datasetHash = dataset.manifest.datasetHash;
    }
    ledger.importedAt = at;
    saveLedger(file, ledger);
  }
  if (summary.result) summary.result.removed = removed;
  return finish();
}

/** plan_check on the create / edit calls (no images: their ids exist only after upload). */
async function dryRun(
  caller: ToolCaller,
  todo: Work[],
  buckets: Record<Bucket, string[]>,
  issues: ItemNote[],
) {
  for (let from = 0; from < todo.length; from += PLAN_CHUNK) {
    const chunk = todo.slice(from, from + PLAN_CHUNK);
    const calls = chunk.map((w) =>
      w.op === "create"
        ? { tool: "homebrew_create", input: { entry: w.m.entry, shared: false } }
        : {
            tool: "homebrew_edit",
            input: { id: w.row.entryId, patch: patchOf(w.stored, w.m.entry) },
          },
    );
    const r = await caller.call<{
      ok: boolean;
      issues: { call: number; path: (string | number)[]; message: string }[];
    }>("plan_check", { calls });
    const nameTaken = new Set<number>();
    for (const iss of r.issues) {
      const w = chunk[iss.call] as Work;
      if (w.op === "create" && iss.path.join(".") === "input.entry.name") {
        nameTaken.add(iss.call);
        continue;
      }
      issues.push({
        uid: w.item.uid,
        name: w.item.name,
        message: `${iss.path.join(".")}: ${iss.message}`,
      });
    }
    for (const i of nameTaken) {
      const w = chunk[i] as Work;
      const found = await findImported(caller, w.m.entry.name, w.item.uid);
      buckets[found ? "adopt" : "clash"].push(w.item.name);
    }
  }
}

async function uploadImages(
  caller: ToolCaller,
  w: Work,
): Promise<{ ids: string[]; shas: string[] }> {
  const known = new Map<string, string>();
  const row = w.row;
  if (row) {
    for (const [i, sha] of row.imageSha256s.entries()) {
      const id = row.imageAssetIds[i];
      if (id) known.set(sha, id);
    }
  }
  const ids: string[] = [];
  const shas: string[] = [];
  for (const im of w.m.images) {
    let id = known.get(im.sha256);
    if (!id) {
      const r = await caller.call<{ assetId: string }>("asset_upload", {
        path: im.path,
        name: w.m.entry.name,
        context: "compendium-item",
      });
      id = r.assetId;
    }
    if (ids.includes(id)) continue;
    ids.push(id);
    shas.push(im.sha256);
  }
  return { ids, shas };
}

async function applyWork(
  o: ImportOptions,
  todo: Work[],
  ledger: Ledger,
  file: string,
  progress: (line: string) => void,
  summary: Summary,
) {
  const { caller } = o;
  const res = { created: 0, updated: 0, adopted: 0, skipped: 0, failed: 0, removed: 0 };
  summary.result = res;
  const every = o.progressEvery ?? 25;
  for (const [n, w] of todo.entries()) {
    try {
      const { ids, shas } = await uploadImages(caller, w);
      const want = { ...w.m.entry, imageAssetIds: ids };
      let entryId: string;
      if (w.op === "edit") {
        await caller.call("homebrew_edit", {
          id: w.row.entryId,
          patch: patchOf(w.stored, w.m.entry, ids),
        });
        entryId = w.row.entryId;
        res.updated++;
      } else {
        try {
          const r = await caller.call<{ entryId: string }>("homebrew_create", {
            entry: w.m.entry,
            shared: false,
            imageAssetIds: ids,
          });
          entryId = r.entryId;
          res.created++;
        } catch (err) {
          if (!(err instanceof ToolFailure) || err.code !== "conflict") throw err;
          const found = await findImported(caller, w.m.entry.name, w.item.uid);
          if (!found) {
            throw new ToolFailure(
              "conflict",
              "Name taken by a homebrew item that isn't from this import (rename one of them)",
            );
          }
          entryId = found.id;
          if (storedHash(found) !== entryHash(want)) {
            await caller.call("homebrew_edit", {
              id: found.id,
              patch: patchOf(found, w.m.entry, ids),
            });
          }
          res.adopted++;
        }
      }
      const back = await getEntry(caller, entryId);
      if (!back) throw new ToolFailure("not_found", `Entry ${entryId} vanished after the write`);
      ledger.items[w.item.uid] = {
        entryId,
        contentHash: w.item.contentHash,
        writtenHash: storedHash(back),
        imageAssetIds: back.imageAssetIds,
        imageSha256s: shas.filter((_, i) => back.imageAssetIds.includes(ids[i] as string)),
        mapperVersion: o.mapperVersion ?? MAPPER_VERSION,
      };
      saveLedger(file, ledger);
    } catch (err) {
      const f = err instanceof ToolFailure ? err : null;
      const code = f?.code ?? "internal";
      const message = f
        ? [f.message, ...f.issues.map((i) => `${i.path.join(".")}: ${i.message}`)].join("; ")
        : String(err);
      if (FATAL_CODES.has(code)) {
        summary.stopped = { code, message };
        summary.failures.push({ uid: w.item.uid, name: w.item.name, code, message });
        res.failed++;
        res.skipped += todo.length - n - 1;
        break;
      }
      summary.failures.push({ uid: w.item.uid, name: w.item.name, code, message });
      res.failed++;
    }
    if ((n + 1) % every === 0 || n + 1 === todo.length) {
      progress(
        `[gsb] ${n + 1}/${todo.length} (created ${res.created}, updated ${res.updated}, adopted ${res.adopted}, failed ${res.failed})`,
      );
    }
  }
}
