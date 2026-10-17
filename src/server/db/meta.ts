// DB identity (#163): a random id kept in `db_meta`, so files outside the DB (the asset dir)
// can tell which DB they belong to.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { dbMeta } from "./schema";

const DB_ID = "db-id";

/**
 * Model versions a DB created from scratch already has (stamped by schema creation): the boot
 * upgrades keyed by them have nothing to do on a fresh DB. FR-FOG-40 (sprint 4): the vision
 * model (999 ft default, map edges, inward simplification) = 2.
 */
export const VISION_MODEL_KEY = "fog-vision-model";
export const VISION_MODEL = 2;
export const FRESH_DB_META: readonly (readonly [key: string, value: string])[] = [
  [VISION_MODEL_KEY, String(VISION_MODEL)],
];

/** This DB's id; created (and committed) on first call. */
export function dbId(db: Db): string {
  const row = db.select().from(dbMeta).where(eq(dbMeta.key, DB_ID)).get();
  if (row) return row.value;
  const id = randomUUID();
  db.insert(dbMeta).values({ key: DB_ID, value: id }).onConflictDoNothing().run();
  return db.select().from(dbMeta).where(eq(dbMeta.key, DB_ID)).get()?.value ?? id;
}
