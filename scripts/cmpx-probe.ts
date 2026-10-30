// Dev aid (compendium-expansion §2): runs the 5etools adapter over a folder and prints mapping
// figures. Never prints entry text: counts, field names and timing only. Never in CI.
//   bun scripts/cmpx-probe.ts [folder]      (default: PP_5ETOOLS_DIR)

import { existsSync } from "node:fs";
import path from "node:path";
import { adaptBookData, describeBooks } from "@server/features/compendium/adapter/5etools";
import {
  readFolder,
  readFromDir,
  readLabels,
} from "@server/features/compendium/adapter/5etools/read";

const dir = process.argv[2] ?? process.env.PP_5ETOOLS_DIR;
if (!dir) {
  console.error("Usage: bun scripts/cmpx-probe.ts <folder> (or set PP_5ETOOLS_DIR)");
  process.exit(2);
}
const read = readFromDir(dir);
const t0 = performance.now();
const labels = readLabels(read);
const data = readFolder(read);
const readMs = performance.now() - t0;
const books = describeBooks(data, labels);
console.log(`5etools ${labels.release}: ${books.length} books, read ${readMs.toFixed(0)} ms`);

const byField = new Map<string, number>();
const totals = {
  monster: 0,
  spell: 0,
  item: 0,
  entryOnly: 0,
  art: 0,
  noArt: 0,
  replaces: 0,
  skipped: 0,
};
const exists = (rel: string) => existsSync(path.join(dir, rel));
const times: number[] = [];
for (const b of books) {
  const t = performance.now();
  const r = adaptBookData(data, b.abbr, { exists });
  const ms = performance.now() - t;
  times.push(ms);
  totals.monster += r.counts.monster;
  totals.spell += r.counts.spell;
  totals.item += r.counts.item;
  totals.skipped += r.skipped;
  for (const w of r.warnings) {
    const f = w.field.replace(/\[\d+\]/g, "[]");
    byField.set(f, (byField.get(f) ?? 0) + 1);
  }
  for (const rec of r.records) {
    if (rec.replaces?.length) totals.replaces++;
    if (rec.kind !== "monster") continue;
    if (!rec.definition) totals.entryOnly++;
    if (rec.artPath) totals.art++;
    else totals.noArt++;
  }
  console.log(
    `${b.abbr.padEnd(12)} M ${String(r.counts.monster).padStart(4)}  S ${String(r.counts.spell).padStart(3)}  I ${String(r.counts.item).padStart(4)}  warn ${String(r.warnings.length).padStart(4)}  skip ${r.skipped}  ${ms.toFixed(0)} ms`,
  );
}
console.log("\nTotals", totals);
console.log(
  `Adapt per book: max ${Math.max(...times).toFixed(0)} ms, all ${times.reduce((a, b) => a + b, 0).toFixed(0)} ms`,
);
console.log("\nWarnings by field");
for (const [f, n] of [...byField].sort((a, b) => b[1] - a[1]))
  console.log(`${String(n).padStart(6)}  ${f || "(record)"}`);
