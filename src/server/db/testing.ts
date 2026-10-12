import { type Db, openMemoryDb } from "./client";

/** Fresh `:memory:` DB with the schema, from the per-run template (test-preload.ts). */
export function openTestDb(): Db {
  const bytes = (globalThis as { __ppTemplateDb?: Uint8Array }).__ppTemplateDb;
  if (!bytes) throw new Error("Template DB missing: run tests via `bun test` (bunfig preload).");
  return openMemoryDb(bytes);
}
