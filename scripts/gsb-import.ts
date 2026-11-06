// `bun run gsb:import [--profile p | --play] [--apply] [--overwrite] [--json] [filters]`: imports
// the Griffon's Saddlebag exporter's items as unshared homebrew items, over the stdio MCP server
// (one session, many calls). Dry run by default. The exporter repo is only ever read.
import path from "node:path";
import { mcpConfig, parseTargetArgs, targetArgs, UsageError } from "@mcp/args";
import { ConfigError } from "@server/config";
import { exporterRoot, GsbError, readDataset } from "./lib/gsb/dataset";
import type { Filters } from "./lib/gsb/diff";
import { BUCKETS, runImport, type Summary } from "./lib/gsb/run";
import { connectStdio, ToolFailure } from "./lib/gsb/tools";

const ROOT = path.resolve(import.meta.dir, "..");
const LEDGER_DIR = path.join(ROOT, "data", "griffons-saddlebag");
const USAGE =
  "usage: bun run gsb:import [--profile dev|verify | --play] [--apply] [--overwrite] [--json]\n" +
  "         [--name <text>] [--type <type>] [--rarity <rarity>] [--tag <tag>] [--theme <theme>]\n" +
  "         [--uid <a,b>] [--limit <n>]";

interface Flags {
  apply: boolean;
  overwrite: boolean;
  json: boolean;
  filters: Filters;
}

export function parseFlags(args: readonly string[]): Flags {
  const f: Flags = { apply: false, overwrite: false, json: false, filters: {} };
  const value = (i: number, flag: string) => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--apply") f.apply = true;
    else if (a === "--overwrite") f.overwrite = true;
    else if (a === "--json") f.json = true;
    else if (["--name", "--type", "--rarity", "--tag", "--theme"].includes(a)) {
      const key = a.slice(2) as "name" | "type" | "rarity" | "tag" | "theme";
      f.filters[key] = value(i, a);
      i++;
    } else if (a === "--uid") {
      f.filters.uids = value(i, a)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (a === "--limit") {
      const n = Number(value(i, a));
      if (!Number.isInteger(n) || n < 1) throw new UsageError("--limit needs a whole number ≥ 1");
      f.filters.limit = n;
      i++;
    } else throw new UsageError(`unknown argument ${a}`);
  }
  return f;
}

const pad = (s: string, n: number) => s.padEnd(n);

export function formatSummary(s: Summary): string {
  const out: string[] = [];
  const mode = s.mode === "apply" ? "apply" : "dry run";
  out.push(`Griffon's Saddlebag → "${s.campaign.name}" (${s.target}) — ${mode}`);
  out.push(
    `dataset ${s.datasetHash.slice(0, 19)}… ${s.datasetChanged ? "differs from the last full import" : "same as the last full import"}${s.filtered ? " (filtered run)" : ""}`,
  );
  for (const b of BUCKETS) {
    const n = s.counts[b];
    if (n === 0 && !["new", "changed", "unchanged"].includes(b)) continue;
    const { shown, more } = s.names[b];
    const names = b === "unchanged" ? "" : shown.join(", ") + (more > 0 ? ` … +${more} more` : "");
    out.push(`  ${pad(b, 14)}${String(n).padStart(5)}  ${names}`);
  }
  if (s.warnings.length > 0) {
    out.push(`warnings (${s.warnings.length}):`);
    for (const w of s.warnings.slice(0, 20)) out.push(`  ${w.name} [${w.uid}]: ${w.message}`);
  }
  if (s.mode === "dry-run") {
    if (s.planIssues.length === 0) out.push("plan_check: ok");
    else {
      out.push(`plan_check: ${s.planIssues.length} issue(s)`);
      for (const i of s.planIssues.slice(0, 20)) out.push(`  ${i.name} [${i.uid}]: ${i.message}`);
    }
    if (s.nothingChanged && !s.filtered) out.push("Nothing changed.");
    else out.push(`Dry run, nothing written. --apply writes ${s.work} item(s).`);
    if (s.counts.locallyEdited > 0 && !s.overwrite) {
      out.push(
        `${s.counts.locallyEdited} locally edited item(s) stay as they are (--overwrite replaces them).`,
      );
    }
  } else if (s.result) {
    const r = s.result;
    out.push(
      `created ${r.created}, updated ${r.updated}, adopted ${r.adopted}, skipped ${r.skipped}, failed ${r.failed}, removed ${r.removed}`,
    );
    for (const f of s.failures.slice(0, 50))
      out.push(`  FAILED ${f.name} [${f.uid}] ${f.code}: ${f.message}`);
    if (s.stopped) out.push(`Stopped: ${s.stopped.code}: ${s.stopped.message}`);
    if (s.nothingChanged && !s.filtered) out.push("Nothing changed.");
  }
  out.push(`ledger: ${s.ledger}`);
  return out.join("\n");
}

async function main(): Promise<number> {
  let target: ReturnType<typeof parseTargetArgs>["target"];
  let flags: Flags;
  let label: string;
  try {
    const parsed = parseTargetArgs(process.argv.slice(2));
    target = parsed.target;
    flags = parseFlags(parsed.rest);
    ({ label } = mcpConfig(process.env, target));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`gsb:import: ${err.message}\n${USAGE}`);
      return 2;
    }
    if (err instanceof ConfigError) {
      console.error(`gsb:import: ${err.message}`);
      return 1;
    }
    throw err;
  }
  const say = flags.json ? console.error : console.log;

  const dataset = await readDataset(exporterRoot(process.env, ROOT));
  say(`gsb:import: ${dataset.items.length} items in the dataset`);

  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const caller = await connectStdio({ root: ROOT, args: targetArgs(target), env });
  try {
    const summary = await runImport({
      caller,
      dataset,
      target: label,
      ledgerDir: LEDGER_DIR,
      filters: flags.filters,
      apply: flags.apply,
      overwrite: flags.overwrite,
      progress: (l) => console.error(l),
    });
    if (flags.json) console.log(JSON.stringify(summary, null, 2));
    else console.log(formatSummary(summary));
    return summary.failures.length > 0 || summary.stopped ? 1 : 0;
  } finally {
    await caller.close();
  }
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (err) {
    if (err instanceof GsbError || err instanceof ToolFailure) {
      const code = err instanceof ToolFailure ? ` (${err.code})` : "";
      console.error(`gsb:import${code}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
