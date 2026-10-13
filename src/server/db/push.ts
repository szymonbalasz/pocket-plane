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
  // drizzle-kit draws a spinner on stdout; keep server output clean.
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof write;
  let res: Awaited<ReturnType<typeof api.pushSQLiteSchema>>;
  try {
    res = await api.pushSQLiteSchema(schema, drizzle(sqlite) as never);
  } finally {
    process.stdout.write = write;
  }
  // Expression indexes always show as changed; only act on real changes.
  const real = res.statementsToExecute.filter((s) => !/^(DROP|CREATE UNIQUE) INDEX/.test(s));
  if (real.length === 0) return { applied: 0 };
  const lossy = res.hasDataLoss ? dropFalseTruncates(res.statementsToExecute, res.warnings) : [];
  if (lossy.length > 0) {
    throw new Error(
      `Schema change would lose data:\n${lossy.join("\n")}\nOn a disposable dir run \`bun run fixtures:reset\`.`,
    );
  }
  await res.apply();
  return { applied: res.statementsToExecute.length };
}

/**
 * drizzle-kit 0.31 reads a falsy default (`DEFAULT 0`) as "no default" when a not-null column
 * is added to a non-empty table: it warns and empties the table first (`delete from t;`). Drops
 * those truncates in place (`apply()` runs this array) when the column's ADD carries a DEFAULT.
 * Returns the warnings that are real.
 */
function dropFalseTruncates(stmts: string[], warnings: string[]): string[] {
  const addedWithDefault = new Map<string, string>();
  for (const s of stmts) {
    const m = /^ALTER TABLE `(\w+)` ADD `(\w+)` .* DEFAULT .* NOT NULL;$/.exec(s);
    if (m?.[1] && m[2]) addedWithDefault.set(m[2], m[1]);
  }
  const truncates = new Set<string>();
  const real = warnings.filter((w) => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: drizzle-kit underlines names with ANSI codes.
    const plain = w.replace(/\u001b\[\d+m/g, "");
    const col = /add not-null (\S+) column without default value,/.exec(plain)?.[1];
    const table = col ? addedWithDefault.get(col) : undefined;
    if (table) truncates.add(`delete from ${table};`);
    return !table;
  });
  if (real.length > 0) return real;
  for (let i = stmts.length - 1; i >= 0; i--) {
    if (truncates.has(stmts[i] ?? "")) stmts.splice(i, 1);
  }
  return [];
}
