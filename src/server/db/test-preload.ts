// `bun test` preload: build one schema DB per run from the Drizzle schema (AGENTS §9.4).
// Each test file opens `:memory:` from these bytes via `openTestDb()`.
import { Database } from "bun:sqlite";
import { createSchema } from "./push";

const sqlite = new Database(":memory:");
await createSchema(sqlite);
(globalThis as { __ppTemplateDb?: Uint8Array }).__ppTemplateDb = sqlite.serialize();
sqlite.close();
