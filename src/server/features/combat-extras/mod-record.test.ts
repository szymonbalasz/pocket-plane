// effect-modifiers on the CBTX `effect` record (FR-MOD-03, FR-MOD-21): `insertEffect` stores
// modifiers + presetKey; the record type sends them to players only on PC effects, built-in
// keys only; monster effects and preset ids never reach a player (snapshot and live changes).
import { describe, expect, test } from "bun:test";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import { EffectsAdded } from "@shared/events/combat-extras";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { checkLimits, insertEffect } from "./effects";
import { effectChange } from "./rows";
import { cbtxSetup } from "./testing";

const BLESS = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 } as const;
const BLESS_SAVE = { ...BLESS, on: { roll: "save" } } as const;
const BANE = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: -1 } as const;
const CURSED = { kind: "dice", on: { roll: "save" }, dice: "2d6", sign: -1 } as const;
/** A campaign preset's id (what `mod.apply` writes for a non-built-in preset). */
const PRESET_ID = "pr-cursed-0001";

function setup() {
  const t = cbtxSetup();
  const cmd = defineCommand({
    name: "test.modEffects",
    input: z.object({}),
    execute(_i, env) {
      const changes: RecordChange[] = [];
      const add = (cols: Parameters<typeof insertEffect>[1]) => {
        checkLimits(
          env,
          {
            targetCombatantId: cols.targetCombatantId ?? null,
            targetCharacterId: cols.targetCharacterId ?? null,
          },
          1,
        );
        const e = insertEffect(env, cols);
        changes.push(effectChange(null, e));
        return e;
      };
      const custom = { kind: "custom" as const, encounterId: t.enc.id };
      const mira = add({
        ...custom,
        label: "Bless",
        targetCharacterId: t.miraId,
        modifiers: [BLESS, BLESS_SAVE],
        presetKey: "bless",
      });
      const thorn = add({
        ...custom,
        label: "Cursed",
        targetCharacterId: t.thornId,
        modifiers: [CURSED],
        presetKey: PRESET_ID,
      });
      const goblin = add({
        ...custom,
        label: "Bane",
        targetCombatantId: t.id("Goblin"),
        modifiers: [BANE],
        presetKey: "bane",
      });
      const plain = add({ ...custom, label: "Marked", targetCombatantId: t.id("Goblin 2") });
      env.emit({
        type: EffectsAdded.type,
        campaignId: env.actor.campaignId,
        payload: { effectIds: [mira.id, thorn.id, goblin.id, plain.id] },
        changes,
      });
      return { mira, thorn, goblin, plain, changes };
    },
  });
  t.s.commands.register(cmd);
  const r = t.s.commands.run(cmd, {}, { actor: t.h.dm }) as {
    mira: EffectRecord;
    thorn: EffectRecord;
    goblin: EffectRecord;
    plain: EffectRecord;
    changes: RecordChange[];
  };
  const viewer = (role: "dm" | "player", playerId: string | null = null): Viewer => ({
    connId: `${role}-${playerId}`,
    campaignId: t.h.campaignId,
    role,
    playerId,
  });
  const snapshotFx = (v: Viewer) =>
    (t.s.records.snapshot({ db: t.s.db, presence: { list: () => [] } }, v)[EFFECT_TYPE] ??
      []) as Record<string, unknown>[];
  return { t, r, viewer, snapshotFx };
}

describe("FR-MOD-03 effect rows carry modifiers", () => {
  test("FR-MOD-03 insertEffect stores modifiers + presetKey; defaults [] / null", () => {
    const { t, r } = setup();
    expect(t.fx(r.mira.id)).toMatchObject({ modifiers: [BLESS, BLESS_SAVE], presetKey: "bless" });
    expect(t.fx(r.thorn.id)).toMatchObject({ modifiers: [CURSED], presetKey: PRESET_ID });
    expect(t.fx(r.plain.id)).toMatchObject({ modifiers: [], presetKey: null });
    expect(r.mira).toEqual(t.fx(r.mira.id));
  });

  test("FR-MOD-03 modifiers follow the row through a CBTX end (soft end keeps them)", () => {
    const { t, r } = setup();
    t.end(r.mira.id);
    expect(t.fx(r.mira.id)).toMatchObject({
      endedReason: "removed",
      modifiers: [BLESS, BLESS_SAVE],
      presetKey: "bless",
    });
  });
});

describe("FR-MOD-21 effect visibility with modifiers", () => {
  test("FR-MOD-21 DM snapshot: full rows with every modifier and preset id", () => {
    const { r, viewer, snapshotFx } = setup();
    const dm = snapshotFx(viewer("dm"));
    const byId = (id: string) => dm.find((e) => e.id === id);
    expect(byId(r.thorn.id)).toMatchObject({ modifiers: [CURSED], presetKey: PRESET_ID });
    expect(byId(r.goblin.id)).toMatchObject({ modifiers: [BANE], presetKey: "bane" });
  });

  test("FR-MOD-21 player snapshots: PC effects with modifiers, built-in keys only; monster effects without either", () => {
    const { t, r, viewer, snapshotFx } = setup();
    for (const p of [t.h.p1, t.h.p2]) {
      const fx = snapshotFx(viewer("player", p.id));
      const byId = (id: string) => fx.find((e) => e.id === id) as Record<string, unknown>;
      expect(byId(r.mira.id)).toMatchObject({ modifiers: [BLESS, BLESS_SAVE], presetKey: "bless" });
      expect(byId(r.thorn.id)).toMatchObject({ modifiers: [CURSED], presetKey: null });
      for (const id of [r.goblin.id, r.plain.id]) {
        expect(Object.keys(byId(id))).not.toContain("modifiers");
        expect(Object.keys(byId(id))).not.toContain("presetKey");
      }
      const json = JSON.stringify(fx);
      expect(json).not.toContain(PRESET_ID);
      expect(json).not.toContain('"bane"');
      // The only -1 sign a player sees is the PC's own "Cursed" (FR-MOD-21 accepted leak).
      expect(json.match(/"sign":-1/g)).toHaveLength(1);
    }
  });

  test("FR-MOD-21 live changes: the same redaction per viewer; no preset id in any player change", () => {
    const { t, r, viewer } = setup();
    const p = viewer("player", t.h.p1.id);
    const wire = r.changes.map((c) => t.s.records.filterChange(c, p));
    const json = JSON.stringify(wire);
    expect(json).not.toContain(PRESET_ID);
    expect(json).not.toContain('"bane"');
    const goblin = wire.find((w) => w?.id === r.goblin.id);
    expect(JSON.stringify(goblin)).not.toContain("modifiers");
    const dm = r.changes.map((c) => t.s.records.filterChange(c, viewer("dm")));
    expect(JSON.stringify(dm)).toContain(PRESET_ID);
  });

  test("FR-MOD-21 a secret PC effect with modifiers stays hidden from players", () => {
    const { t, r, viewer, snapshotFx } = setup();
    t.run("cbtx.updateEffect", { effectId: r.mira.id, secret: true });
    const fx = snapshotFx(viewer("player", t.h.p1.id));
    expect(fx.map((e) => e.id)).not.toContain(r.mira.id);
  });
});
