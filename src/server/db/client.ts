import { Database } from "bun:sqlite";
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
    sqlite.run("PRAGMA synchronous = NORMAL");
    sqlite.run("PRAGMA busy_timeout = 2000");
  }
  return drizzle(sqlite, { schema }) as Db;
}

export function openFileDb(dbPath: string): Db {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return wrap(new Database(dbPath, { create: true, strict: true }), true);
}

/**
 * Close and release the file. Drizzle's prepared statements keep SQLite open as a
 * "zombie" until finalized (GC), which keeps the file locked on Windows; collect first.
 */
export function closeDb(db: Db): void {
  Bun.gc(true);
  db.$client.close(false);
}

/** In-memory DB from serialized bytes (the test template, AGENTS §9.4). */
export function openMemoryDb(bytes?: Uint8Array): Db {
  const sqlite = bytes
    ? Database.deserialize(bytes, { strict: true })
    : new Database(":memory:", { strict: true });
  return wrap(sqlite, false);
}
