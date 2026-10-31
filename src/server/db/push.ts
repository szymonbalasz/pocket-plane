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

/** What a refused schema change leaves the DM and the builder to do (AGENTS §3, ADR-0076). */
const AFTER_REFUSAL = [
  "Get the campaign back: stop, go back to the previous version of the app and restart, or restore a `play` start-up backup or a `<db>.pre-push-*.bak`.",
  "Fix the code: keep the old column or table, add the new one and copy at boot (ADR-0076). Never rename or drop in place.",
  "On a disposable dir (dev, fixtures), `bun run fixtures:reset-load <bundle>` also works.",
].join("\n");

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

/** Tables drizzle-kit's introspection skips (`filterIgnoredTablesByField`, 0.31). */
const KIT_IGNORED_TABLE = /^(__drizzle_migrations$|_cf_|_litestream_|libsql_|sqlite_)/;

/**
 * The questions drizzle-kit would ask before it can diff (0.31, `promptNamedWithSchemasConflict`,
 * `promptColumnsConflicts`): the schema has a table the DB lacks while the DB has one the schema
 * lacks, or the same for a table's columns. It can't tell a rename from an add and a drop, and
 * the push API has no way to answer. One readable line per question; empty = no question.
 */
export function renameQuestions(
  sqlite: Database,
  wanted: Record<string, { columns: Record<string, unknown> }>,
): string[] {
  const live = sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name)
    .filter((n) => !KIT_IGNORED_TABLE.test(n));
  const wantedTables = Object.keys(wanted);
  const onlyWanted = wantedTables.filter((t) => !live.includes(t));
  const onlyLive = live.filter((t) => !wantedTables.includes(t));
  const out: string[] = [];
  if (onlyWanted.length > 0 && onlyLive.length > 0) {
    out.push(`new table(s) ${onlyWanted.join(", ")}; old table(s) ${onlyLive.join(", ")}`);
  }
  for (const table of wantedTables.filter((t) => live.includes(t))) {
    const liveCols = sqlite
      .query<{ name: string }, [string]>("SELECT name FROM pragma_table_xinfo(?)")
      .all(table)
      .map((c) => c.name);
    const wantedCols = Object.keys(wanted[table]?.columns ?? {});
    const added = wantedCols.filter((c) => !liveCols.includes(c));
    const gone = liveCols.filter((c) => !wantedCols.includes(c));
    if (added.length > 0 && gone.length > 0) {
      out.push(
        `table ${table}: new column(s) ${added.join(", ")}; old column(s) ${gone.join(", ")}`,
      );
    }
  }
  return out;
}

const refusedRename = (questions: readonly string[]) =>
  new SchemaPushError(
    `Schema change refused; nothing was changed. It looks like a rename, which the schema update at start can't do:\n${questions.map((q) => `  ${q}`).join("\n")}\n${AFTER_REFUSAL}`,
  );

/**
 * drizzle-kit prompts only when `process.stdin.isTTY && process.stdout.isTTY` (hanji `render`);
 * otherwise it rejects with "Interactive prompts require a TTY terminal". In a real terminal the
 * prompt would wait forever behind the hidden stdout, so stdout says it's no terminal while `fn`
 * runs: any question `renameQuestions` didn't foresee rejects too, and never waits.
 */
export async function withoutPrompts<T>(fn: () => Promise<T>): Promise<T> {
  const before = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  try {
    return await fn();
  } finally {
    if (before) Object.defineProperty(process.stdout, "isTTY", before);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: drizzle-kit colours its warnings with ANSI codes.
const plainText = (s: string) => s.replace(/\u001b\[\d+m/g, "");

/**
 * Brings an existing DB up to the current schema. Refuses, with nothing applied and a message
 * saying what to do, changes drizzle-kit would ask about (BL-172) or that lose data, and DBs an
 * interrupted push left half-rebuilt. File DBs are backed up first; statements apply in one
 * transaction (#163).
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
      `${where} has table(s) ${leftovers.join(", ")} left by an interrupted schema change; nothing was changed now.\n` +
        "Get the campaign back: stop, copy the newest `<db>.pre-push-*.bak` or `play` start-up backup over the DB (delete its -wal / -shm files), and restart.\n" +
        "On a disposable dir (dev, fixtures), `bun run fixtures:reset-load <bundle>` also works.",
    );
  }
  const api = await loadKit();
  const questions = renameQuestions(sqlite, (await api.generateSQLiteDrizzleJson(schema)).tables);
  if (questions.length > 0) throw refusedRename(questions);
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  // drizzle-kit draws a spinner on stdout; keep server output clean.
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof write;
  let res: Awaited<ReturnType<typeof api.pushSQLiteSchema>>;
  try {
    res = await withoutPrompts(() => api.pushSQLiteSchema(schema, drizzle(sqlite) as never));
  } catch (err) {
    if (/Interactive prompts require/.test(String(err))) {
      throw refusedRename([
        "compare schema.ts with the DB: drizzle-kit asked about a table or column",
      ]);
    }
    throw err;
  } finally {
    process.stdout.write = write;
  }
  // Expression indexes always show as changed; only act on real changes.
  const real = res.statementsToExecute.filter((s) => !/^(DROP|CREATE UNIQUE) INDEX/.test(s));
  if (real.length === 0) return { applied: 0, backup: null };
  const lossy = res.hasDataLoss ? dropFalseTruncates(res.statementsToExecute, res.warnings) : [];
  if (lossy.length > 0) {
    throw new SchemaPushError(
      `Schema change refused; nothing was changed. It would lose data:\n${lossy.map((w) => `  ${plainText(w).trim()}`).join("\n")}\n${AFTER_REFUSAL}`,
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
 * One column name may be added to several tables in a push (`position`, FR-MAP-116), and a warning
 * doesn't name its table: each warning accounts for one such table that has a truncate. A warning
 * left over is real (a table adding that name with no default). Returns the warnings that are real.
 */
export function dropFalseTruncates(stmts: string[], warnings: string[]): string[] {
  const addedWithDefault = new Map<string, string[]>();
  for (const s of stmts) {
    const m = /^ALTER TABLE `(\w+)` ADD `(\w+)` .* DEFAULT .* NOT NULL;$/.exec(s);
    if (!m?.[1] || !m[2]) continue;
    if (stmts.includes(`delete from ${m[1]};`)) {
      addedWithDefault.set(m[2], [...(addedWithDefault.get(m[2]) ?? []), m[1]]);
    }
  }
  const truncates = new Set<string>();
  const real = warnings.filter((w) => {
    const col = /add not-null (\S+) column without default value,/.exec(plainText(w))?.[1];
    const table = col ? addedWithDefault.get(col)?.shift() : undefined;
    if (table) truncates.add(`delete from ${table};`);
    return !table;
  });
  if (real.length > 0) return real;
  for (let i = stmts.length - 1; i >= 0; i--) {
    if (truncates.has(stmts[i] ?? "")) stmts.splice(i, 1);
  }
  return [];
}
