// DB identity (#163): a random id kept in `db_meta`, so files outside the DB (the asset dir)
// can tell which DB they belong to.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { dbMeta } from "./schema";

const DB_ID = "db-id";

/** This DB's id; created (and committed) on first call. */
export function dbId(db: Db): string {
  const row = db.select().from(dbMeta).where(eq(dbMeta.key, DB_ID)).get();
  if (row) return row.value;
  const id = randomUUID();
  db.insert(dbMeta).values({ key: DB_ID, value: id }).onConflictDoNothing().run();
  return db.select().from(dbMeta).where(eq(dbMeta.key, DB_ID)).get()?.value ?? id;
}
