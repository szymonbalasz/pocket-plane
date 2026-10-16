import { describe, expect, test } from "bun:test";
import { seededContext } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { readEventLog } from "../../events/log";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { isReadOnly } from "./import-pipeline";

// The pipeline core against the real definition store: entities' `entity` table + `monster`
// kind (CON-03, FR-ENT-06).
function setup() {
  const s = createTestServices();
  const rows = () =>
    s.db.$client.query<Record<string, string>, []>("SELECT * FROM entity ORDER BY rowid").all();
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
const block = (ac: number, hpMax: number) => ({
  size: "small",
  ac,
  hpMax,
  initBonus: 2,
  attacks: [],
  cr: "1/4",
});
const goblin = {
  kind: "monster",
  sourceKey: "goblin",
  data: { name: "Goblin", statBlock: block(15, 7) },
};
const wolf = {
  kind: "monster",
  sourceKey: "wolf",
  data: { name: "Wolf", statBlock: block(13, 11) },
};

describe("import pipeline core", () => {
  test("FR-FIX-18/21 valid batch → created, global, with provenance", () => {
    const { run, rows } = setup();
    const out = run({ source, records: [goblin, wolf] });
    expect(out.map((o) => o.outcome)).toEqual(["created", "created"]);
    expect(rows()[0]).toMatchObject({
      id: out[0]?.id,
      campaign_id: null,
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
          { ...wolf, data: { name: "Wolf", statBlock: { ...block(13, 0), ac: 31 } } },
          { kind: "nope", sourceKey: "x", data: {} },
        ],
      });
    } catch (e) {
      err = e as CommandError;
    }
    expect(err?.code).toBe("invalid");
    const paths = (err?.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toContain("wolf.data.statBlock.ac");
    expect(paths).toContain("wolf.data.statBlock.hpMax");
    expect(paths).toContain("x.kind");
    expect(rows()).toHaveLength(0);
  });

  test("FR-FIX-18 unknown kind is rejected (character is not importable)", () => {
    const { run } = setup();
    expect(() =>
      run({ source, records: [{ kind: "character", sourceKey: "a", data: {} }] }),
    ).toThrow(CommandError);
  });

  test("FR-FIX-20 existing (source, sourceKey), same data → existing, nothing written, same ID", () => {
    const { s, run, rows } = setup();
    const first = run({ source, records: [goblin] });
    const before = rows();
    const second = run({ source, records: [goblin, wolf] });
    expect(second[0]).toEqual({
      sourceKey: "goblin",
      outcome: "existing",
      id: first[0]?.id as string,
    });
    expect(second[1]?.outcome).toBe("created");
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toEqual(before[0] as Record<string, string>);
    expect(readEventLog(s.db).map((e) => e.type)).toEqual(["EntityImported", "EntityImported"]);
  });

  test("OQ-FIX-18 FR-CMP-07 changed data → updated in place: same ID, ImportedEntityUpdated logged with campaignId null", () => {
    const { s, run, rows } = setup();
    const first = run({ source, records: [goblin] });
    const second = run({
      source,
      records: [{ ...goblin, data: { name: "Changed", statBlock: block(1, 1) } }],
    });
    expect(second).toEqual([
      { sourceKey: "goblin", outcome: "updated", id: first[0]?.id as string },
    ]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: first[0]?.id, name: "Changed", source: "fixture" });
    const log = readEventLog(s.db);
    expect(log.map((e) => [e.type, e.campaignId])).toEqual([
      ["EntityImported", null],
      ["ImportedEntityUpdated", null],
    ]);
    // Key order of the stored JSON doesn't matter: the same data again is `existing`.
    const third = run({
      source,
      records: [{ ...goblin, data: { statBlock: block(1, 1), name: "Changed" } }],
    });
    expect(third[0]?.outcome).toBe("existing");
  });

  test("FR-FIX-23 each created record emits the definition event, logged with campaignId null; existing emits nothing", () => {
    const { s, run } = setup();
    run({ source, records: [goblin] });
    run({ source, records: [goblin] });
    const log = readEventLog(s.db);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ type: "EntityImported", campaignId: null });
  });

  test("readOnly = source != null", () => {
    expect(isReadOnly({ source: "fixture" })).toBe(true);
    expect(isReadOnly({ source: null })).toBe(false);
  });
});
