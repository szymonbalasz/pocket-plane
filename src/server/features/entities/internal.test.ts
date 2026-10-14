// Internal entities API for CHARX (OQ-CHARX-19): createIn / updateIn / followHpMax.
import { describe, expect, test } from "bun:test";
import {
  type CharacterRecord,
  CreateEntityBody,
  type EntityRecord,
} from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { seededContext } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { entity } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import {
  CREATE,
  createIn,
  type EntityEnv,
  followHpMax,
  UPDATE,
  type UpdateNext,
  updateIn,
} from "./commands";
import { definitionHooksOf } from "./definition-hooks";
import { entityServices, goblinBlock, miraBlock, seedEntities } from "./testing";

function setup() {
  const s = entityServices();
  const h = seedEntities(s);
  const hooks = definitionHooksOf(s);
  const ctx = seededContext({ disposable: true, key: "charx-core" });
  const tx = <R>(fn: (env: EntityEnv) => R, actor: Actor = h.dm): R =>
    s.db.transaction((t) => fn({ tx: t, ctx, actor }));
  const logCount = () => readEventLog(s.db).length;
  const pc = (statBlock: object = miraBlock, name = "Brin") =>
    tx((env) =>
      createIn(
        env,
        body({
          kind: "character",
          name,
          ownerPlayerId: h.p1.id,
          statBlock,
        }),
      ),
    ).record as CharacterRecord;
  const nextOf = (e: CharacterRecord, statBlock: object, extra: Partial<UpdateNext> = {}) =>
    ({
      name: e.name,
      portraitAssetId: e.portraitAssetId,
      tokenShape: e.tokenShape,
      statBlock: statBlock as Record<string, unknown>,
      ownerPlayerId: e.ownerPlayerId,
      ...extra,
    }) satisfies UpdateNext;
  const err = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  return { s, h, hooks, ctx, tx, logCount, pc, nextOf, err };
}

const body = (b: object) => CreateEntityBody.parse(b);
const fighter = { ...miraBlock, classes: [{ name: "Fighter", level: 1, hitDie: "d10" }] };

describe("entities internal API (OQ-CHARX-19)", () => {
  test("FR-CHARX-08 createIn: row + change, IDs from ctx, no event or log; hpCurrent = hpMax", () => {
    const t = setup();
    const logs = t.logCount();
    const { record, change } = t.tx((env) =>
      createIn(
        env,
        body({
          kind: "character",
          name: "Brin",
          ownerPlayerId: t.h.p1.id,
          statBlock: { ...miraBlock, hpMax: 1 },
        }),
      ),
    );
    const expected = seededContext({ disposable: true, key: "charx-core" });
    expect(record.id).toBe(expected.ids.next());
    expect(change).toEqual({ type: "entity", id: record.id, before: null, after: record });
    expect(record).toMatchObject({ kind: "character", hpCurrent: 1, ownerPlayerId: t.h.p1.id });
    expect(t.logCount()).toBe(logs);
    // A player actor works too (CHARX authorizes; entities checks campaign, owner, name).
    const asPlayer: Actor = { role: "player", playerId: t.h.p1.id, campaignId: t.h.campaignId };
    const own = t.tx(
      (env) =>
        createIn(
          env,
          body({
            kind: "character",
            name: "Sela",
            ownerPlayerId: t.h.p1.id,
            statBlock: miraBlock,
          }),
        ),
      asPlayer,
    );
    expect(own.record.campaignId).toBe(t.h.campaignId);
    const dup = t.err(() => t.pc(miraBlock, "brin"));
    expect(dup.code).toBe("conflict");
  });

  test("FR-CHARX-04 createIn / updateIn / POST / PUT write level + className from classes", () => {
    const t = setup();
    const multi = {
      ...miraBlock,
      level: 9,
      className: "Wrong",
      classes: [
        { name: "Fighter", level: 3, hitDie: "d10" },
        { name: "Rogue", level: 2, hitDie: "d8" },
      ],
    };
    const e = t.pc(multi);
    expect([e.statBlock.level, e.statBlock.className]).toEqual([5, "Fighter/Rogue"]);
    const { record } = t.tx((env) =>
      updateIn(env, e.id, t.nextOf(e, { ...multi, classes: multi.classes.slice(0, 1) }), t.hooks),
    );
    expect((record as CharacterRecord).statBlock).toMatchObject({ level: 3, className: "Fighter" });
    const run = (name: string, input: unknown) =>
      t.s.commands.run(name, input, { actor: t.h.dm }) as CharacterRecord;
    const viaPost = run(CREATE, {
      kind: "character",
      name: "Kell",
      ownerPlayerId: t.h.p2.id,
      statBlock: multi,
    });
    expect(viaPost.statBlock.level).toBe(5);
    const viaPut = run(UPDATE, { id: viaPost.id, ...t.nextOf(viaPost, { ...multi, level: 1 }) });
    expect([viaPut.statBlock.level, viaPut.statBlock.className]).toEqual([5, "Fighter/Rogue"]);
    // Legacy (no classes): level and className as written.
    const legacy = run(UPDATE, {
      id: viaPost.id,
      ...t.nextOf(viaPost, { ...miraBlock, level: 4 }),
    });
    expect([legacy.statBlock.level, legacy.statBlock.className]).toEqual([4, "Fighter"]);
  });

  test("FR-CHARX-15 hpCurrent follows hpMax: draft always; full HP follows; otherwise clamp", () => {
    // Test plan cases: draft 1 → 9; ready 10/10 → 12; 7/10 → 12; 10/10 → 6.
    expect(followHpMax({ hpCurrent: 1, hpMax: 1 }, 9, { draft: true })).toBe(9);
    expect(followHpMax({ hpCurrent: 3, hpMax: 9 }, 5, { draft: true })).toBe(5);
    expect(followHpMax({ hpCurrent: 10, hpMax: 10 }, 12, { draft: false })).toBe(12);
    expect(followHpMax({ hpCurrent: 7, hpMax: 10 }, 12, { draft: false })).toBe(7);
    expect(followHpMax({ hpCurrent: 10, hpMax: 10 }, 6, { draft: false })).toBe(6);
    expect(followHpMax({ hpCurrent: 7, hpMax: 10 }, 5, { draft: false })).toBe(5);

    const t = setup();
    const edit = (e: CharacterRecord, hpMax: number, draft: boolean) =>
      t.tx(
        (env) =>
          updateIn(
            env,
            e.id,
            t.nextOf(
              e,
              { ...e.statBlock, hpMax },
              {
                hpCurrent: followHpMax(
                  { hpCurrent: e.hpCurrent, hpMax: e.statBlock.hpMax },
                  hpMax,
                  { draft },
                ),
              },
            ),
            t.hooks,
          ).record as CharacterRecord,
      );
    const draft = t.pc({ ...miraBlock, hpMax: 1 }, "Draft");
    expect(edit(draft, 9, true).hpCurrent).toBe(9);
    const full = t.pc({ ...miraBlock, hpMax: 10 }, "Full");
    expect(edit(full, 12, false).hpCurrent).toBe(12);
    const hurt = t.pc({ ...miraBlock, hpMax: 10 }, "Hurt");
    t.s.db.update(entity).set({ hpCurrent: 7 }).where(eq(entity.id, hurt.id)).run();
    const hurt7 = { ...hurt, hpCurrent: 7 };
    expect(edit(hurt7, 12, false).hpCurrent).toBe(7);
    const shrink = t.pc({ ...miraBlock, hpMax: 10 }, "Shrink");
    expect(edit(shrink, 6, false).hpCurrent).toBe(6);
    // A passed hpCurrent is still clamped to 0…hpMax (FR-ENT-11).
    const over = t.tx(
      (env) =>
        updateIn(
          env,
          shrink.id,
          t.nextOf(shrink, { ...shrink.statBlock, hpMax: 6 }, { hpCurrent: 50 }),
          t.hooks,
        ).record as CharacterRecord,
    );
    expect(over.hpCurrent).toBe(6);
    // Absent hpCurrent: FR-ENT-11's clamp (the PUT rule), unchanged.
    const put = t.tx(
      (env) =>
        updateIn(env, full.id, t.nextOf(full, { ...full.statBlock, hpMax: 20 }), t.hooks)
          .record as CharacterRecord,
    );
    expect(put.hpCurrent).toBe(12);
  });

  test("FR-CHARX-13 updateIn: hooks run, their rows follow the entity change; no event or log", () => {
    const t = setup();
    const e = t.pc(fighter);
    t.hooks.register("test.owner-copy", (_env, before, after) =>
      before.ownerPlayerId === after.ownerPlayerId
        ? []
        : [{ type: "test-sheet", id: after.id, before: { o: before.ownerPlayerId }, after: null }],
    );
    const logs = t.logCount();
    const { before, record, changes } = t.tx((env) =>
      updateIn(env, e.id, t.nextOf(e, e.statBlock, { ownerPlayerId: t.h.p2.id }), t.hooks),
    );
    expect(before).toEqual(e);
    expect(record.ownerPlayerId).toBe(t.h.p2.id);
    expect(changes.map((c) => [c.type, c.id])).toEqual([
      ["entity", e.id],
      ["test-sheet", e.id],
    ]);
    expect(changes[0]).toEqual({ type: "entity", id: e.id, before: e, after: record });
    expect(t.logCount()).toBe(logs);
  });

  test("FR-CHARX-18 updateIn: imported → forbidden; other campaign → not_found; bad block → invalid", () => {
    const t = setup();
    const e = t.pc();
    const imported = { name: "Goblin", portraitAssetId: null, statBlock: { ...goblinBlock } };
    const f = t.err(() => t.tx((env) => updateIn(env, t.h.goblinId, imported, t.hooks)));
    expect([f.code, f.message]).toEqual([
      "forbidden",
      "Imported definitions are read-only. Derive a custom one.",
    ]);
    const nf = t.err(() =>
      t.tx((env) => updateIn(env, e.id, t.nextOf(e, e.statBlock), t.hooks), t.h.dmSecond),
    );
    expect(nf.code).toBe("not_found");
    const bad = t.err(() =>
      t.tx((env) =>
        updateIn(env, e.id, t.nextOf(e, { ...e.statBlock, skills: { x: 1 } }), t.hooks),
      ),
    );
    expect(bad.code).toBe("invalid");
    expect(bad.issues?.[0]?.path.slice(0, 2)).toEqual(["statBlock", "skills"]);
    const row = t.s.db.select().from(entity).where(eq(entity.id, e.id)).get();
    expect((row?.statBlock as EntityRecord["statBlock"] | undefined)?.ac).toBe(miraBlock.ac);
  });
});
