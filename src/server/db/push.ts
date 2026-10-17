// Schema creation via drizzle-kit push (ADR-0001: push in dev; migrations start at release).
import type { Database } from "bun:sqlite";
import { FRESH_DB_META } from "./meta";
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

/** Stamps a DB just created from scratch with the current model versions (`FRESH_DB_META`). */
function stampFresh(sqlite: Database): void {
  for (const [key, value] of FRESH_DB_META) {
    sqlite.query("INSERT INTO db_meta (key, value) VALUES (?, ?)").run(key, value);
  }
}

export async function createSchema(sqlite: Database): Promise<void> {
  const stmts = await createSchemaStatements();
  sqlite.transaction(() => {
    for (const s of stmts) sqlite.run(s);
    stampFresh(sqlite);
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

/** A refused or failed boot-time schema change; the message says what to do. */
export class SchemaPushError extends Error {
  override name = "SchemaPushError";
}

export interface PushOptions {
  /**
   * File DBs: `VACUUM INTO '<db>.pre-push-<timestamp>.bak'` before applying a change (#163).
   * Default on; in-memory DBs never back up.
   */
  backup?: boolean;
  /** Backup timestamp (tests). */
  now?: () => Date;
}

/** Tables a drizzle-kit table rebuild creates and renames away; left over = interrupted push. */
export function leftoverRebuildTables(sqlite: Database): string[] {
  return sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 6) = '__new_' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}

const isFileDb = (sqlite: Database) => sqlite.filename !== "" && sqlite.filename !== ":memory:";

/** `VACUUM INTO` a consistent copy next to the DB; returns its path. */
export function backupDb(sqlite: Database, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = `${sqlite.filename}.pre-push-${stamp}.bak`;
  sqlite.query("VACUUM INTO ?").run(target);
  return target;
}

/**
 * Runs push statements in one transaction (#163). `PRAGMA foreign_keys` is a no-op inside a
 * transaction, so drizzle-kit's own toggles are dropped and the pragma is switched off around
 * the transaction instead; `foreign_key_check` must pass before the commit. All or nothing.
 */
export function applyStatements(sqlite: Database, stmts: readonly string[]): void {
  const body = stmts.filter((s) => !/^PRAGMA\s+foreign_keys\s*=/i.test(s.trim()));
  const fkOn = sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
  sqlite.run("PRAGMA foreign_keys = OFF");
  try {
    sqlite.transaction(() => {
      for (const s of body) sqlite.run(s);
      const broken = sqlite.query("PRAGMA foreign_key_check").all();
      if (broken.length > 0) {
        throw new SchemaPushError(
          `Schema change would break ${broken.length} foreign key reference(s); nothing applied.`,
        );
      }
    })();
  } finally {
    if (fkOn?.foreign_keys === 1) sqlite.run("PRAGMA foreign_keys = ON");
  }
}

/**
 * Brings an existing dev DB up to the current schema. Refuses changes that lose data
 * (run `fixtures:reset` on a disposable dir instead) and DBs an interrupted push left
 * half-rebuilt. File DBs are backed up first; statements apply in one transaction (#163).
 */
export async function pushSchema(
  sqlite: Database,
  opts: PushOptions = {},
): Promise<{ applied: number; backup: string | null }> {
  if (isEmptyDb(sqlite)) {
    const stmts = await createSchemaStatements();
    sqlite.transaction(() => {
      for (const s of stmts) sqlite.run(s);
      stampFresh(sqlite);
    })();
    return { applied: stmts.length, backup: null };
  }
  const leftovers = leftoverRebuildTables(sqlite);
  if (leftovers.length > 0) {
    const where = isFileDb(sqlite) ? sqlite.filename : "the DB";
    throw new SchemaPushError(
      `${where} has table(s) ${leftovers.join(", ")} left by an interrupted schema change. ` +
        "Stop the server, copy the newest `<db>.pre-push-*.bak` over the DB (delete its -wal / -shm files), " +
        "or on a disposable dir run `bun run fixtures:reset-load <bundle>`.",
    );
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
  if (real.length === 0) return { applied: 0, backup: null };
  const lossy = res.hasDataLoss ? dropFalseTruncates(res.statementsToExecute, res.warnings) : [];
  if (lossy.length > 0) {
    throw new SchemaPushError(
      `Schema change would lose data:\n${lossy.join("\n")}\nOn a disposable dir run \`bun run fixtures:reset\`.`,
    );
  }
  const stmts = dropDuplicateIndexCreates(res.statementsToExecute);
  const backup = opts.backup !== false && isFileDb(sqlite) ? backupDb(sqlite, opts.now?.()) : null;
  applyStatements(sqlite, stmts);
  return { applied: stmts.length, backup };
}

/**
 * drizzle-kit 0.31 emits a rebuilt table's `CREATE INDEX` statements twice (a column type change,
 * e.g. SCN sprint 4's `aoe_template.x` → `real`), so the second one fails with "index … already
 * exists". Keeps the first CREATE of a name until a `DROP INDEX` of that name; drops the repeats.
 */
export function dropDuplicateIndexCreates(stmts: readonly string[]): string[] {
  const live = new Set<string>();
  return stmts.filter((s) => {
    const drop = /^DROP INDEX `(\w+)`/.exec(s.trim())?.[1];
    if (drop) {
      live.delete(drop);
      return true;
    }
    const create = /^CREATE (?:UNIQUE )?INDEX `(\w+)`/.exec(s.trim())?.[1];
    if (!create) return true;
    if (live.has(create)) return false;
    live.add(create);
    return true;
  });
}

/**
 * drizzle-kit 0.31 reads a falsy default (`DEFAULT 0`) as "no default" when a not-null column
 * is added to a non-empty table: it warns and empties the table first (`delete from t;`). Drops
 * those truncates in place (`applyStatements` runs this array) when the column's ADD carries a DEFAULT.
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
