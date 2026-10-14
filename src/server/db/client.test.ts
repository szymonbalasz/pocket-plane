import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, openFileDb } from "./client";
import { createSchema } from "./push";
import { campaign } from "./schema";

// fix/test-flakes: a statement GC hadn't collected yet kept a "closed" file DB open, so a later
// journal_mode switch hit SQLITE_BUSY and deleting the file hit EBUSY, depending on GC timing.
test("closeDb releases the file at once, even with live Drizzle statements", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-client-"));
  const file = path.join(dir, "x.db");
  const db = openFileDb(file);
  await createSchema(db.$client);
  const live = db.select().from(campaign).prepare(); // still referenced below: GC can't collect it
  expect(live.all()).toEqual([]);
  closeDb(db);

  const other = new Database(file);
  other.run("PRAGMA busy_timeout = 0");
  expect(other.query("PRAGMA journal_mode = DELETE").get()).toEqual({ journal_mode: "delete" });
  other.close(true);
  rmSync(dir, { recursive: true });
  expect(existsSync(file)).toBe(false);
  expect(() => live.all()).toThrow();
});
