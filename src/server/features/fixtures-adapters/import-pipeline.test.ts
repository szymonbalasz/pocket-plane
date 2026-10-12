import { describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { seededContext } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { readEventLog } from "../../events/log";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { type DefinitionStore, isReadOnly } from "./import-pipeline";

// Test-only kind + store behind the insert interface (CON-03); entities ships the real ones.
const TestDefinitionCreated = defineEvent({
  type: "TestDefinitionCreated",
  payload: z.object({ definitionId: z.string(), kind: z.string() }),
  logged: true,
  undoable: false,
});

const testStore: DefinitionStore = {
  recordType: "test-definition",
  createdEvent: TestDefinitionCreated,
  find(tx, source, sourceKey) {
    const rows = tx.values<[string]>(
      sql`SELECT id FROM test_definition WHERE source = ${source} AND source_key = ${sourceKey}`,
    );
    const id = rows[0]?.[0];
    return id === undefined ? null : { id };
  },
  insert(tx, r) {
    tx.run(sql`INSERT INTO test_definition (id, kind, data, source, source_key, licence, attribution, imported_at)
      VALUES (${r.id}, ${r.kind}, ${JSON.stringify(r.data)}, ${r.source}, ${r.sourceKey}, ${r.licence}, ${r.attribution}, ${r.importedAt})`);
    return { record: { ...r }, payload: { definitionId: r.id, kind: r.kind } };
  },
};

function setup() {
  const s = createTestServices();
  s.db.$client.run(`CREATE TABLE test_definition (id TEXT PRIMARY KEY, kind TEXT, data TEXT, source TEXT,
    source_key TEXT, licence TEXT, attribution TEXT, imported_at TEXT, UNIQUE (source, source_key))`);
  s.imports.registerKind({
    kind: "test-creature",
    schema: z.object({
      name: z.string(),
      ac: z.number().int().min(1),
      hp: z.number().int().min(1),
    }),
  });
  s.imports.store = testStore;
  s.commands.registerEvent(TestDefinitionCreated);
  const rows = () =>
    s.db.$client
      .query<Record<string, string>, []>("SELECT * FROM test_definition ORDER BY rowid")
      .all();
  let n = 0;
  const run = (batch: unknown) =>
    s.commands.run("import.batch", batch, {
      actor: DM_ACTOR,
      ctx: seededContext({ disposable: true, key: `test-${n++}` }),
    }) as { sourceKey: string; outcome: string; id: string }[];
  return { s, rows, run };
}

const source = {
  key: "fixture",
  name: "Fixtures",
  licence: "CC BY 4.0",
  attribution: "SRD 5.1 by Wizards of the Coast, CC BY 4.0",
};
const goblin = {
  kind: "test-creature",
  sourceKey: "goblin",
  data: { name: "Goblin", ac: 15, hp: 7 },
};
const wolf = { kind: "test-creature", sourceKey: "wolf", data: { name: "Wolf", ac: 13, hp: 11 } };

describe("import pipeline core", () => {
  test("FR-FIX-18/21 valid batch → created, global, with provenance", () => {
    const { run, rows } = setup();
    const out = run({ source, records: [goblin, wolf] });
    expect(out.map((o) => o.outcome)).toEqual(["created", "created"]);
    expect(rows()[0]).toMatchObject({
      id: out[0]?.id,
      source: "fixture",
      source_key: "goblin",
      licence: "CC BY 4.0",
      attribution: source.attribution,
      imported_at: "2026-01-01T00:00:00.000Z",
    });
  });

  test("FR-FIX-19 any invalid record → nothing written; every error with sourceKey + path", () => {
    const { run, rows } = setup();
    let err: CommandError | null = null;
    try {
      run({
        source,
        records: [
          goblin,
          { ...wolf, data: { name: "Wolf", ac: 0 } },
          { kind: "nope", sourceKey: "x", data: {} },
        ],
      });
    } catch (e) {
      err = e as CommandError;
    }
    expect(err?.code).toBe("invalid");
    const paths = (err?.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toContain("wolf.data.ac");
    expect(paths).toContain("wolf.data.hp");
    expect(paths).toContain("x.kind");
    expect(rows()).toHaveLength(0);
  });

  test("FR-FIX-18 unknown kind is rejected", () => {
    const { run } = setup();
    expect(() => run({ source, records: [{ kind: "monster", sourceKey: "a", data: {} }] })).toThrow(
      CommandError,
    );
  });

  test("FR-FIX-20 existing (source, sourceKey) → existing, nothing written, same ID", () => {
    const { run, rows } = setup();
    const first = run({ source, records: [goblin] });
    const second = run({
      source,
      records: [{ ...goblin, data: { name: "Changed", ac: 1, hp: 1 } }, wolf],
    });
    expect(second[0]).toEqual({
      sourceKey: "goblin",
      outcome: "existing",
      id: first[0]?.id as string,
    });
    expect(second[1]?.outcome).toBe("created");
    expect(rows()).toHaveLength(2);
    expect(JSON.parse(rows()[0]?.data ?? "{}").name).toBe("Goblin");
  });

  test("FR-FIX-23 each created record emits the definition event, logged with campaignId null; existing emits nothing", () => {
    const { s, run } = setup();
    run({ source, records: [goblin] });
    run({ source, records: [goblin] });
    const log = readEventLog(s.db);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ type: "TestDefinitionCreated", campaignId: null });
  });

  test("readOnly = source != null", () => {
    expect(isReadOnly({ source: "fixture" })).toBe(true);
    expect(isReadOnly({ source: null })).toBe(false);
  });
});
