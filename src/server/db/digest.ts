// Read-only state digest (#163): per-table row counts + SHA-256 of the rows, so a crash
// walkthrough checks "identical state" by digest, not by eye (`bun run state:digest`).
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

/** Not state: the DB's own id (differs per DB file). */
const SKIP_TABLES = new Set(["db_meta"]);
/** Columns left out of the hash: wall-clock times of real commands. */
const SKIP_COLUMNS: Record<string, readonly string[]> = { event_log: ["at"] };

export interface TableDigest {
  table: string;
  rows: number;
  sha256: string;
}

export function stateDigest(sqlite: Database): { tables: TableDigest[]; sha256: string } {
  const names = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name)
    .filter((n) => !SKIP_TABLES.has(n));
  const all = createHash("sha256");
  const tables = names.map((table) => {
    const skip = SKIP_COLUMNS[table] ?? [];
    const h = createHash("sha256");
    let rows = 0;
    for (const row of sqlite
      .query<Record<string, unknown>, []>(`SELECT * FROM "${table}" ORDER BY rowid`)
      .iterate()) {
      for (const c of skip) delete row[c];
      h.update(`${JSON.stringify(row, (_k, v) => (v instanceof Uint8Array ? [...v] : v))}\n`);
      rows++;
    }
    const sha256 = h.digest("hex");
    all.update(`${table}:${rows}:${sha256}\n`);
    return { table, rows, sha256 };
  });
  return { tables, sha256: all.digest("hex") };
}
