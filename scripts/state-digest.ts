// `bun run state:digest [--profile p]`: read-only per-table row counts + SHA-256 (#163). Safe
// while the server runs; compare the last line between two states.
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { ConfigError, loadConfig, profileArg } from "../src/server/config";
import { stateDigest } from "../src/server/db/digest";

try {
  const config = loadConfig({ profile: profileArg(process.argv) });
  if (!existsSync(config.dbPath)) throw new ConfigError(`No DB at ${config.dbPath}`);
  const db = new Database(config.dbPath, { readonly: true });
  try {
    const d = stateDigest(db);
    const w = Math.max(...d.tables.map((t) => t.table.length));
    for (const t of d.tables) {
      console.log(`${t.table.padEnd(w)}  ${String(t.rows).padStart(6)}  ${t.sha256.slice(0, 16)}`);
    }
    console.log(`digest ${d.sha256} (profile ${config.profile}, ${config.dbPath})`);
  } finally {
    db.close();
  }
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
