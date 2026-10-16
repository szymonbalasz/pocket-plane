// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// FR-MOD-32–35, -45, -46, -47: `mod.putTrigger` / `mod.deleteTrigger` (authoring rules, locks,
// caps, refs, formula against the owner), `addTriggerFromPreset`, the owner copy and the lazy
// `rule-trigger` type (never in a snapshot; `sync.load` rows per viewer; live saves to the owner).
import { describe, expect, test } from "bun:test";
import { TRIGGER_INTENTS, type TriggerInput } from "@shared/effect-modifiers/trigger-intents";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { asc, eq } from "drizzle-orm";
import { seededContext } from "../../commands/context";
import { ruleTrigger, triggerUse } from "../../db/schema";
import type { Actor } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { playerViewer, sourceOf } from "../../ws/testing/convergence";
import { addTriggerFromPreset } from "./index";
import { modSetup } from "./testing";

const fury = (requires?: string): TriggerRule => ({
  on: "hit",
  ...(requires ? { requires: { preset: requires } } : {}),
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
});

let ctxKey = 0;
const ctx = () => seededContext({ disposable: true, key: `trg-cmd-${++ctxKey}` });

function setup() {
  const t = modSetup();
  const trig = (trigger: TriggerInput, actor: Actor = t.h.dm) =>
    t.run<{ triggerId: string }>(TRIGGER_INTENTS.putTrigger, { trigger }, actor).triggerId;
  const del = (triggerId: string, actor: Actor = t.h.dm) =>
    t.run(TRIGGER_INTENTS.deleteTrigger, { triggerId }, actor);
  const rows = () => t.s.db.select().from(ruleTrigger).orderBy(asc(ruleTrigger.seq)).all();
  const row = (id: string) => rows().find((r) => r.id === id);
  const src = sourceOf(t.s);
  const dm: Viewer = { connId: "dm", campaignId: t.h.campaignId, role: "dm", playerId: null };
  const p1 = playerViewer(t.h.campaignId, t.h.p1.id);
  const p2 = playerViewer(t.h.campaignId, t.h.p2.id);
  /** `sync.load {type: "rule-trigger"}`'s rows for a viewer; never in its snapshot. */
  const load = (v: Viewer) => {
    expect(t.s.records.snapshot(src, v)[RULE_TRIGGER_TYPE]).toBeUndefined();
    return (t.s.records.load(src, v, RULE_TRIGGER_TYPE)[RULE_TRIGGER_TYPE] ?? []) as {
      id: string;
      name: string;
      rule: Record<string, unknown>;
    }[];
  };
  return { ...t, trig, del, rows, row, dm, p1v: p1, p2v: p2, load };
}

describe("FR-MOD-45 authoring", () => {
  test("FR-MOD-45 owner put / replace / delete own character trigger; defaults; RuleTriggerSaved / Deleted", () => {
    const t = setup();
    const rage = t.put(t.from("rage", { characterId: t.miraId }), t.p1);
    const id = t.trig({ characterId: t.miraId, name: "  Divine Fury ", rule: fury(rage) }, t.p1);
    expect(t.row(id)).toMatchObject({
      characterId: t.miraId,
      definitionId: null,
      ownerPlayerId: t.h.p1.id,
      name: "Divine Fury",
      enabled: true,
      public: true,
    });
    t.trig({ id, characterId: t.miraId, name: "Fury", enabled: false, rule: fury() }, t.p1);
    expect(t.row(id)).toMatchObject({ name: "Fury", enabled: false, public: true });
    expect(t.row(id)?.rule.requires).toBeUndefined();
    t.del(id, t.p1);
    expect(t.rows()).toEqual([]);
    expect(t.events.map((e) => e.event.type).slice(-3)).toEqual([
      "RuleTriggerSaved",
      "RuleTriggerSaved",
      "RuleTriggerDeleted",
    ]);
  });

  test("FR-MOD-45 permissions: other's character, definitions, locked sheet, invisible delete", () => {
    const t = setup();
    expect(
      t.err(() => t.trig({ characterId: t.thornId, name: "X", rule: fury() }, t.p1)).code,
    ).toBe("forbidden");
    expect(
      t.err(() => t.trig({ definitionId: t.h.wolfId, name: "X", rule: fury() }, t.p1)).code,
    ).toBe("forbidden");
    const dmDef = t.trig({ definitionId: t.h.wolfId, name: "Pack", rule: fury() });
    expect(t.row(dmDef)).toMatchObject({ public: false, ownerPlayerId: null });
    expect(t.err(() => t.del(dmDef, t.p1)).code).toBe("not_found");
    const thorn = t.trig({ characterId: t.thornId, name: "Sneak", rule: fury() }, t.p2);
    expect(t.err(() => t.del(thorn, t.p1)).code).toBe("not_found");
    t.run("char.setLock", { characterId: t.thornId, locked: true });
    const e = t.err(() =>
      t.trig({ id: thorn, characterId: t.thornId, name: "S", rule: fury() }, t.p2),
    );
    expect([e.code, e.message]).toEqual(["forbidden", "Locked by the DM"]);
    expect(t.err(() => t.del(thorn, t.p2)).code).toBe("forbidden");
    t.trig({ id: thorn, characterId: t.thornId, name: "S", rule: fury() });
    // A replace keeps its owner.
    expect(
      t.err(() => t.trig({ id: thorn, characterId: t.miraId, name: "S", rule: fury() })).code,
    ).toBe("invalid");
  });

  test("FR-MOD-45 refs: requires built-in / campaign / own preset; another's preset, targetMarked, feature row → invalid", () => {
    const t = setup();
    const camp = t.put(t.from("bless", { name: "Hex" }));
    const own = t.put(t.from("rage", { characterId: t.miraId }));
    const thorns = t.put(t.from("rage", { characterId: t.thornId }));
    for (const ok of ["rage", camp, own]) {
      t.trig({ characterId: t.miraId, name: `R ${ok.slice(0, 8)}`, rule: fury(ok) });
    }
    const bad = t.err(() => t.trig({ characterId: t.miraId, name: "X", rule: fury(thorns) }));
    expect([bad.code, bad.issues?.[0]?.path]).toEqual([
      "invalid",
      ["trigger", "rule", "requires", "preset"],
    ]);
    // Definitions: built-in or campaign presets only.
    expect(t.err(() => t.trig({ definitionId: t.h.wolfId, name: "X", rule: fury(own) })).code).toBe(
      "invalid",
    );
    const marked = (preset: string): TriggerRule => ({
      on: "hit",
      when: [{ if: "targetMarked", preset }],
      every: "each",
      then: { do: "damage", formula: "1d6", type: null },
    });
    t.trig({ characterId: t.miraId, name: "HM", rule: marked("hunters-mark") });
    t.trig({ characterId: t.thornId, name: "Hex", rule: marked(camp) });
    expect(
      t.err(() => t.trig({ characterId: t.thornId, name: "X", rule: marked("bless") })).code,
    ).toBe("invalid");
    expect(t.err(() => t.trig({ characterId: t.thornId, name: "X", rule: marked(own) })).code).toBe(
      "invalid",
    );
    const feat = (feature: string): TriggerRule => ({ ...fury(), every: { feature } });
    const noUses = t.run<{ rowId: string }>("char.putRow", {
      creatureId: t.miraId,
      list: "features",
      row: { name: "Divine Fury" },
    }).rowId;
    const uses = t.run<{ rowId: string }>("char.putRow", {
      creatureId: t.miraId,
      list: "features",
      row: { name: "Rage", usesMax: 3, reset: "long" },
    }).rowId;
    expect(t.err(() => t.trig({ characterId: t.miraId, name: "F", rule: feat(noUses) })).code).toBe(
      "invalid",
    );
    t.trig({ characterId: t.miraId, name: "F", rule: feat(uses) });
    // `feature` on a definition: the rule's owner check (FR-MOD-33).
    expect(
      t.err(() => t.trig({ definitionId: t.h.wolfId, name: "F", rule: feat(uses) })).code,
    ).toBe("invalid");
  });

  test("FR-MOD-34 formula checked against the owner at save: > 25 dice and die size → invalid with path", () => {
    const t = setup();
    const rule = (formula: string): TriggerRule => ({
      ...fury(),
      then: { do: "damage", formula, type: null },
    });
    // Mira is a level-1 Fighter: (level * 20)d6 + 6d8 = 26 dice.
    const e = t.err(() =>
      t.trig({ characterId: t.miraId, name: "X", rule: rule("(level * 20)d6 + 6d8") }),
    );
    expect([e.code, e.message, e.issues?.[0]?.path]).toEqual([
      "invalid",
      "Too many dice: 26 > 25",
      ["trigger", "rule", "then", "formula"],
    ]);
    expect(
      t.err(() => t.trig({ characterId: t.miraId, name: "X", rule: rule("1d(level + 6)") }))
        .message,
    ).toBe("Die size 7 at 3");
    expect(
      t.err(() => t.trig({ characterId: t.miraId, name: "X", rule: rule("1d6 + foo") })).code,
    ).toBe("invalid");
    t.trig({ characterId: t.miraId, name: "OK", rule: rule("(level * 20)d6 + 5d8") });
  });

  test("FR-MOD-32 caps: 6 per character, 4 per definition, 40 per campaign → conflict", () => {
    const t = setup();
    for (let i = 0; i < 6; i++) t.trig({ characterId: t.miraId, name: `M${i}`, rule: fury() });
    expect(t.err(() => t.trig({ characterId: t.miraId, name: "M7", rule: fury() })).code).toBe(
      "conflict",
    );
    for (let i = 0; i < 4; i++) t.trig({ definitionId: t.h.wolfId, name: `W${i}`, rule: fury() });
    expect(
      t.err(() => t.trig({ definitionId: t.h.wolfId, name: "W5", rule: fury() })).message,
    ).toBe("At most 4 triggers per monster");
    // Fill the campaign to 40 directly, then one more → conflict.
    const n = t.rows().length;
    for (let i = n; i < 40; i++) {
      t.s.db
        .insert(ruleTrigger)
        .values({
          ...(t.rows()[0] as typeof ruleTrigger.$inferInsert),
          id: `fill-${i}`,
          seq: 1000 + i,
          characterId: null,
          definitionId: t.h.goblinId,
          ownerPlayerId: null,
        })
        .run();
    }
    expect(t.err(() => t.trig({ characterId: t.thornId, name: "T", rule: fury() })).message).toBe(
      "At most 40 triggers per campaign",
    );
  });

  test("FR-MOD-46 addTriggerFromPreset: built-in key or rule, in the caller's transaction, no event; validates; throws roll back", () => {
    const t = setup();
    const before = t.events.length;
    const r = t.s.db.transaction((tx) =>
      addTriggerFromPreset(
        { tx, ctx: ctx(), actor: t.h.dm, emit: () => expect.unreachable() },
        t.thornId,
        { presetKey: "sneak-attack" },
      ),
    );
    expect(t.row(r.triggerId)).toMatchObject({
      name: "Sneak Attack",
      characterId: t.thornId,
      ownerPlayerId: t.h.p2.id,
      public: true,
    });
    expect(r.changes.map((c) => [c.type, c.id, c.before])).toEqual([
      [RULE_TRIGGER_TYPE, r.triggerId, null],
    ]);
    expect(t.events.length).toBe(before);
    const ruled = t.s.db.transaction((tx) =>
      addTriggerFromPreset({ tx, ctx: ctx(), actor: t.h.dm, emit: () => {} }, t.miraId, {
        name: "Divine Fury",
        rule: fury("rage"),
      }),
    );
    expect(t.row(ruled.triggerId)?.rule.requires).toEqual({ preset: "rage" });
    for (const from of [
      { presetKey: "divine-fury" },
      { name: "X", rule: { on: "hit" } as never },
    ]) {
      expect(() =>
        t.s.db.transaction((tx) =>
          addTriggerFromPreset({ tx, ctx: ctx(), actor: t.h.dm, emit: () => {} }, t.miraId, from),
        ),
      ).toThrow();
    }
    expect(t.rows()).toHaveLength(2);
  });
});

describe("FR-MOD-47 lazy visibility", () => {
  test("FR-MOD-47 never in a snapshot; sync.load: DM every row, owner theirs redacted, definitions never; live saves reach the owner only", () => {
    const t = setup();
    const camp = t.put(t.from("bless", { name: "Frenzy" }));
    const mira = t.trig({ characterId: t.miraId, name: "Divine Fury", rule: fury(camp) });
    const thorn = t.trig({ characterId: t.thornId, name: "Sneak Attack", rule: fury("rage") });
    t.trig({ definitionId: t.h.wolfId, name: "Martial Advantage", rule: fury() });
    expect(t.load(t.dm).map((r) => r.name)).toEqual([
      "Divine Fury",
      "Sneak Attack",
      "Martial Advantage",
    ]);
    const p1 = t.load(t.p1v);
    expect(p1.map((r) => [r.id, r.rule.requires])).toEqual([[mira, { name: "Frenzy" }]]);
    expect(JSON.stringify(p1)).not.toContain(camp);
    expect(t.load(t.p2v).map((r) => r.id)).toEqual([thorn]);
    for (const v of [t.p1v, t.p2v]) {
      expect(JSON.stringify(t.load(v))).not.toContain("Martial Advantage");
    }
    // Live: the save's change reaches its owner (loaded or not) and nobody else.
    const changes = t.events
      .filter((e) => e.event.type === "RuleTriggerSaved")
      .flatMap((e) => e.event.changes);
    const seen = (v: Viewer) =>
      changes.map((c) => t.s.records.filterChange(c, v)).filter((w) => w !== null);
    expect(seen(t.p1v).map((w) => w?.id)).toEqual([mira]);
    expect(seen(t.p2v).map((w) => w?.id)).toEqual([thorn]);
    expect(JSON.stringify(seen(t.p1v))).not.toContain(camp);
    expect(seen(t.dm)).toHaveLength(3);
  });

  test("FR-MOD-47 owner change moves rows: old owner delete, new owner upsert; use rows cascade on delete", () => {
    const t = setup();
    const id = t.trig({ characterId: t.thornId, name: "Sneak Attack", rule: fury() });
    t.run("char.edit", { creatureId: t.thornId, set: { ownerPlayerId: t.h.p1.id } });
    expect(t.row(id)?.ownerPlayerId).toBe(t.h.p1.id);
    const last = t.events.at(-1)?.event.changes.find((c) => c.type === RULE_TRIGGER_TYPE);
    expect(last).toBeDefined();
    const wire = (v: Viewer) => (last ? t.s.records.filterChange(last, v) : null);
    expect(wire(t.p2v)).toMatchObject({ op: "delete" });
    expect(wire(t.p1v)).toMatchObject({ op: "upsert" });
    expect(t.load(t.p1v).map((r) => r.id)).toEqual([id]);
    expect(t.load(t.p2v)).toEqual([]);
    t.del(id);
    expect(t.s.db.select().from(triggerUse).where(eq(triggerUse.triggerId, id)).all()).toEqual([]);
  });
});
