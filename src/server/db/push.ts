// Schema creation via drizzle-kit push (ADR-0001: push in dev; migrations start at release).
import type { Database } from "bun:sqlite";
import { schema } from "./schema";

type KitApi = typeof import("drizzle-kit/api");
let kit: Promise<KitApi> | null = null;
const loadKit = () => {
  kit ??= import("drizzle-kit/api");
  return kit;
};

/** SQL that creates the whole schema on an empty DB (= push against empty). */
export async function createSchemaStatements(): Promise<string[]> {
  const api = await loadKit();
  const empty = await api.generateSQLiteDrizzleJson({});
  const current = await api.generateSQLiteDrizzleJson(schema);
  return api.generateSQLiteMigration(empty, current);
}

export async function createSchema(sqlite: Database): Promise<void> {
  const stmts = await createSchemaStatements();
  sqlite.transaction(() => {
    for (const s of stmts) sqlite.run(s);
  })();
}

export function isEmptyDb(sqlite: Database): boolean {
  const row = sqlite
    .query<{ n: number }, []>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  return (row?.n ?? 0) === 0;
}

/**
 * Brings an existing dev DB up to the current schema. Refuses changes that lose data
 * (run `fixtures:reset` on a disposable dir instead).
 */
export async function pushSchema(sqlite: Database): Promise<{ applied: number }> {
  if (isEmptyDb(sqlite)) {
    const stmts = await createSchemaStatements();
    sqlite.transaction(() => {
      for (const s of stmts) sqlite.run(s);
    })();
    return { applied: stmts.length };
  }
  const api = await loadKit();
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const res = await api.pushSQLiteSchema(schema, drizzle(sqlite) as never);
  // Expression indexes always show as changed; only act on real changes.
  const real = res.statementsToExecute.filter((s) => !/^(DROP|CREATE UNIQUE) INDEX/.test(s));
  if (real.length === 0) return { applied: 0 };
  if (res.hasDataLoss) {
    throw new Error(
      `Schema change would lose data:\n${res.warnings.join("\n")}\nOn a disposable dir run \`bun run fixtures:reset\`.`,
    );
  }
  await res.apply();
  return { applied: res.statementsToExecute.length };
}
