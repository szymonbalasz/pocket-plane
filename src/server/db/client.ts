import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { schema } from "./schema";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };
/** A Drizzle transaction handle; commands only see this. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function wrap(sqlite: Database, file: boolean): Db {
  sqlite.run("PRAGMA foreign_keys = ON");
  if (file) {
    sqlite.run("PRAGMA journal_mode = WAL");
    // FULL (#163): a commit survives an OS crash / power loss too; one fsync per commit is cheap
    // at a few intents per second.
    sqlite.run("PRAGMA synchronous = FULL");
    sqlite.run("PRAGMA busy_timeout = 2000");
  }
  return drizzle(sqlite, { schema }) as Db;
}

/**
 * A file DB that owns the statements Drizzle prepares (one `prepare` per query), cached by SQL
 * text, so `closeDb` can finalize them and really close. Bun 1.3's `close()` leaves `prepare`d
 * statements alive, and each keeps the connection open as a "zombie" until GC finalizes it:
 * the file stays locked (EBUSY on Windows) and a later `journal_mode` switch fails with
 * SQLITE_BUSY, depending on GC timing (fix/test-flakes). Drizzle only calls run / all / get /
 * values on a statement, so sharing one per SQL text is safe; the cache is bounded by the
 * number of distinct queries.
 */
class FileDatabase extends Database {
  readonly #statements = new Map<string, Statement>();

  override prepare<R, P extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: P) {
    if (params !== undefined) return super.prepare<R, P>(sql, params);
    const hit = this.#statements.get(sql);
    if (hit) return hit as ReturnType<typeof Database.prototype.prepare<R, P>>;
    const stmt = super.prepare<R, P>(sql);
    this.#statements.set(sql, stmt as Statement);
    return stmt;
  }

  /** Finalize every statement, then close now; throws if SQLite can't close. */
  closeNow(): void {
    for (const stmt of this.#statements.values()) stmt.finalize();
    this.#statements.clear();
    this.close(true);
  }
}

export function openFileDb(dbPath: string): Db {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return wrap(new FileDatabase(dbPath, { create: true, strict: true }), true);
}

/** Close and release the file: no zombie connection is left behind (see `FileDatabase`). */
export function closeDb(db: Db): void {
  if (db.$client instanceof FileDatabase) db.$client.closeNow();
  else db.$client.close(false); // in-memory: no file to release
}

/** In-memory DB from serialized bytes (the test template, AGENTS §9.4). */
export function openMemoryDb(bytes?: Uint8Array): Db {
  const sqlite = bytes
    ? Database.deserialize(bytes, { strict: true })
    : new Database(":memory:", { strict: true });
  return wrap(sqlite, false);
}
