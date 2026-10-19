// MOD §13 bundle `rule-triggers` (R5): loads from empty and is deterministic; `trg-thorn` patches
// Thorn's classes only (stacks with `vision-senses`); `trg-monsters` puts DM-only definition
// triggers on the Elite's and the Wolf's definitions. Leak scan per player over snapshots,
// `sync.load` acks and live changes, before and after a Divine Fury / Martial Advantage /
// Regeneration flow (MOD §13 leak strings).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  combatant,
  effectPreset,
  encounter,
  entity,
  notification,
  ruleTrigger,
} from "@server/db/schema";
import type { Actor, DispatchedEvent } from "@server/events/types";
import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import type { Viewer } from "@server/ws/records";
import { playerViewer, sourceOf } from "@server/ws/testing/convergence";
import { servicesFromBundle, snapshotFrames } from "@server/ws/testing/snapshot-size";
import { CBT_INTENTS, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import { asc, eq } from "drizzle-orm";
import { library, loadBundle } from "../../index";

const VISION = defineBundle({
  name: "rule-triggers-vision-test",
  includes: ["rule-triggers"],
  fixtures: ["vision-senses"],
});
const lib = { ...library, bundles: [...library.bundles, VISION] };

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) c();
});

async function loaded(name = "rule-triggers") {
  const r =
    name === "rule-triggers"
      ? await loadBundle(name, { testMode: true })
      : await loadInProcess(lib, name, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
}

describe("rule-triggers bundle (MOD §13)", () => {
  test("FR-MOD-31 rule-triggers loads from empty: effect-modifiers + mod-tier2 + Brakka + Thorn's Sneak Attack + monster triggers + trg-combat", async () => {
    const { r, db } = await loaded();
    expect(r.manifest.fixtures.slice(-11)).toEqual([
      "combat-1",
      "mod-presets",
      "mod-bless",
      "mod-bane",
      "mod-rage",
      "mod-tier2",
      "char-brakka",
      "trg-brakka",
      "trg-thorn",
      "trg-monsters",
      "trg-combat",
    ]);
    const thorn = db.select().from(entity).where(eq(entity.name, "Thorn")).get();
    expect(thorn?.statBlock).toMatchObject({
      level: 5,
      className: "Rogue",
      classes: [{ name: "Rogue", level: 5, hitDie: "d8" }],
      // Patch: every other field as `char-thorn` made it.
      ac: 14,
      hpMax: 10,
      attacks: [expect.objectContaining({ name: "Dagger", damage: "1d4+3" })],
    });
    const elite = db.select().from(entity).where(eq(entity.name, "Elite Goblin Warrior")).get();
    const wolf = db.select().from(combatant).where(eq(combatant.name, "Wolf")).get();
    const rows = db.select().from(ruleTrigger).orderBy(asc(ruleTrigger.seq)).all();
    expect(
      rows.map((t) => [
        t.name,
        t.characterId !== null ? "character" : "definition",
        t.public,
        t.enabled,
        t.rule.on,
      ]),
    ).toEqual([
      ["Divine Fury", "character", true, true, "hit"],
      ["Sneak Attack", "character", true, true, "hit"],
      ["Martial Advantage", "definition", false, true, "hit"],
      ["Regeneration", "definition", false, true, "turnStart"],
    ]);
    expect(rows[1]).toMatchObject({ characterId: thorn?.id, ownerPlayerId: thorn?.ownerPlayerId });
    expect(rows[1]?.rule.then).toEqual({
      do: "damage",
      formula: "(ceil(level(rogue) / 2))d6",
      type: null,
    });
    expect([rows[2]?.definitionId, rows[3]?.definitionId]).toEqual([elite?.id, wolf?.entityId]);
    expect(
      db
        .select()
        .from(effectPreset)
        .all()
        .map((p) => p.name),
    ).toContain("Frost Ward");
    const enc = db.select().from(encounter).get();
    const turn = db
      .select()
      .from(combatant)
      .where(eq(combatant.id, enc?.turnCombatantId as string))
      .get();
    expect([enc?.round, turn?.name]).toEqual([1, "Wolf"]);
  }, 30_000);

  test("FR-MOD-31 deterministic: two loads give identical trigger, preset and entity rows", async () => {
    const a = await loaded();
    const b = await loaded();
    for (const t of [ruleTrigger, effectPreset, entity, combatant] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 30_000);

  test("FR-MOD-31 trg-thorn composes with vision-senses: Thorn keeps both patches", async () => {
    const { db } = await loaded(VISION.name);
    const thorn = db.select().from(entity).where(eq(entity.name, "Thorn")).get();
    expect(thorn?.statBlock).toMatchObject({
      classes: [{ name: "Rogue", level: 5, hitDie: "d8" }],
      senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true },
    });
  }, 30_000);
});

describe("FR-MOD-47 rule-triggers leak scan per player", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("rule-triggers", { testMode: true }));
  }, 30_000);
  afterAll(() => b.cleanup());

  const ids = () => {
    const db = b.s.db;
    const ent = (name: string) => db.select().from(entity).where(eq(entity.name, name)).get();
    const k = (name: string) => db.select().from(combatant).where(eq(combatant.name, name)).get();
    const trig = (name: string) =>
      db.select().from(ruleTrigger).where(eq(ruleTrigger.name, name)).get();
    const brakka = ent("Brakka");
    const thorn = ent("Thorn");
    return {
      cid: brakka?.campaignId as string,
      p1: brakka?.ownerPlayerId as string,
      p2: thorn?.ownerPlayerId as string,
      brakka,
      k,
      trig,
    };
  };
  const viewers = () => {
    const x = ids();
    return {
      dm: { connId: "dm", campaignId: x.cid, role: "dm", playerId: null } as Viewer,
      p1: playerViewer(x.cid, x.p1),
      p2: playerViewer(x.cid, x.p2),
    };
  };
  const ack = (v: Viewer) =>
    (b.s.records.load(sourceOf(b.s), v, RULE_TRIGGER_TYPE)[RULE_TRIGGER_TYPE] ?? []) as {
      id: string;
      name: string;
      characterId: string | null;
      definitionId: string | null;
    }[];
  /** MOD §13 leak strings for every player, plus each player's other-character trigger ids. */
  const leaks = (v: Viewer): string[] => {
    const x = ids();
    const common = [
      "Martial Advantage",
      "Regeneration",
      "trigger_use",
      "ownerCombatantId",
      '"window"',
      "triggerParts",
      '"dmPayload"',
      x.trig("Martial Advantage")?.id as string,
      x.trig("Regeneration")?.id as string,
    ];
    const other = v.playerId === x.p1 ? "Sneak Attack" : "Divine Fury";
    return [...common, x.trig(other)?.id as string];
  };
  const scan = (label: string) => {
    const vs = viewers();
    for (const f of snapshotFrames(b.s).filter((y) => y.viewer.role === "player")) {
      expect(f.records[RULE_TRIGGER_TYPE]).toBeUndefined();
      const json = JSON.stringify(f.records);
      for (const s of leaks(f.viewer))
        expect([label, "snapshot", s, json.includes(s)]).toEqual([label, "snapshot", s, false]);
    }
    for (const v of [vs.p1, vs.p2]) {
      const rows = ack(v);
      expect(rows.every((r) => r.definitionId === null)).toBe(true);
      const json = JSON.stringify(rows);
      for (const s of leaks(v))
        expect([label, "ack", s, json.includes(s)]).toEqual([label, "ack", s, false]);
    }
    expect(ack(vs.p1).map((r) => r.name)).toEqual(["Divine Fury"]);
    expect(ack(vs.p2).map((r) => r.name)).toEqual(["Sneak Attack"]);
    expect(ack(vs.dm)).toHaveLength(4);
  };

  test("FR-MOD-47 no leak string in player snapshots, sync.load acks or live changes; before and after a trigger flow (reconnect = fresh snapshot)", () => {
    scan("before");
    const x = ids();
    const vs = viewers();
    const dm: Actor = { role: "dm", playerId: null, campaignId: x.cid };
    const p1: Actor = { role: "player", playerId: x.p1, campaignId: x.cid };
    const run = <R>(name: string, input: unknown, actor = dm) =>
      b.s.commands.run(name, input, { actor }) as R;
    const events: DispatchedEvent[] = [];
    b.s.bus.subscribe("rule-triggers-leak-scan", (e) => events.push(e));
    const next = () => {
      const enc = b.s.db.select().from(encounter).get();
      run(CBT_INTENTS.nextTurn, {
        encounterId: enc?.id,
        expectedRound: enc?.round,
        expectedTurnId: enc?.turnCombatantId,
      });
    };
    const turnName = () => {
      const enc = b.s.db.select().from(encounter).get();
      return b.s.db
        .select()
        .from(combatant)
        .where(eq(combatant.id, enc?.turnCombatantId as string))
        .get()?.name;
    };
    const nextTo = (name: string) => {
      for (let i = 0; i < 10 && turnName() !== name; i++) next();
      expect(turnName()).toBe(name);
    };
    const card = (id: string) =>
      b.s.db.select().from(notification).where(eq(notification.id, id)).get()
        ?.payload as DamageCardPayload;
    const apply = (
      cardId: string,
      target: string,
      triggers: { triggerId: string; value?: number }[],
    ) => {
      const p = card(cardId);
      run(CBT_INTENTS.applyCard, {
        cardId,
        toHitTotal: p.toHit?.total,
        damageTotal: p.damage?.total,
        damageRollId: p.damage?.rollId ?? null,
        targets: [{ targetId: x.k(target)?.id, hit: true, multiplier: "normal", triggers }],
      });
    };
    // Brakka raging: Divine Fury offered and applied to the Goblin.
    nextTo("Brakka");
    const rage = b.s.db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.characterId, x.brakka?.id as string))
      .get();
    run(MOD_INTENTS.toggle, { characterId: x.brakka?.id, presetId: rage?.id, on: true }, p1);
    const fury = run<{ cardId: string }>(
      CBT_INTENTS.attack,
      { attackerId: x.k("Brakka")?.id, manual: [{ diceTotal: 15 }, { diceTotal: 8 }] },
      p1,
    ).cardId;
    const furyId = x.trig("Divine Fury")?.id as string;
    expect(card(fury).damage?.triggers?.map((t) => t.triggerId)).toEqual([furyId]);
    apply(fury, "Goblin", [{ triggerId: furyId }]);
    // The Elite (hidden) attacks Brakka: Martial Advantage offered unticked, DM sets 9.
    nextTo("Elite Goblin Warrior");
    const ma = run<{ cardId: string }>(CBT_INTENTS.attack, {
      attackerId: x.k("Elite Goblin Warrior")?.id,
      manual: [{ diceTotal: 14 }, { diceTotal: 4 }],
    }).cardId;
    const maId = x.trig("Martial Advantage")?.id as string;
    expect(card(ma).damage?.triggers?.map((t) => [t.triggerId, t.ask])).toEqual([
      [maId, "an ally within 5 ft of the target"],
    ]);
    apply(ma, "Brakka", [{ triggerId: maId, value: 9 }]);
    // Round 2: the Wolf's turn start → a DM-only Regeneration reminder.
    nextTo("Wolf");
    const reminders = b.s.db
      .select()
      .from(notification)
      .all()
      .filter((n) => n.kind === "mod-trigger");
    expect(reminders.map((n) => [n.audience, n.text])).toEqual([
      ["dm", "Wolf: Regeneration — regain 10 HP unless it took acid or fire damage"],
    ]);
    // Live changes as each player receives them.
    const changes = events.flatMap((e) => e.event.changes);
    for (const v of [vs.p1, vs.p2]) {
      const wire = JSON.stringify(
        changes.map((c) => b.s.records.filterChange(c, v)).filter((w) => w !== null),
      );
      for (const s of leaks(v)) expect(["live", s, wire.includes(s)]).toEqual(["live", s, false]);
    }
    scan("after");
  });
});
