// MOD commands (FR-MOD-06–11): presets for DM and owner, apply with concentration, toggles,
// editing an effect's modifiers; failures change nothing; toggle crash is all or nothing.
import { describe, expect, test } from "bun:test";
import { EFFECTS_PER_TARGET_MAX } from "@shared/combat-extras/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { CAMPAIGN_PRESETS_MAX, CHARACTER_PRESETS_MAX } from "@shared/effect-modifiers/schemas";
import { armCrashHook } from "../../commands/crash";
import { modSetup } from "./testing";

const BLESS = [
  { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 },
  { kind: "dice", on: { roll: "save" }, dice: "1d4", sign: 1 },
];
const CURSED = [{ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: -1 }] as const;
const cursed = {
  characterId: null,
  name: "Cursed",
  modifiers: [...CURSED],
  durationRounds: null,
  concentration: false,
};

describe("FR-MOD-06 campaign presets", () => {
  test("FR-MOD-06 create, replace (same seq), customise a built-in; second customisation → conflict; delete = back to the built-in", () => {
    const t = modSetup();
    const id = t.put(cursed);
    const created = t.preset(id);
    expect(created).toMatchObject({
      name: "Cursed",
      key: null,
      characterId: null,
      ownerPlayerId: null,
    });
    t.put({ ...cursed, id, name: "Cursed more", durationRounds: 5 });
    expect(t.preset(id)).toMatchObject({
      name: "Cursed more",
      durationRounds: 5,
      seq: created.seq,
    });
    const house = t.put(t.from("bless", { key: "bless", note: "House" }));
    expect(t.preset(house)).toMatchObject({ key: "bless", note: "House", modifiers: BLESS });
    expect(t.err(() => t.put(t.from("bless", { key: "bless" }))).code).toBe("conflict");
    // Tier 2 built (R1): Shield of Faith is a built-in to customise; an unknown key is not.
    expect(t.err(() => t.put(t.from("bless", { key: "no-such-preset" as never }))).code).toBe(
      "invalid",
    );
    // A preset keeps its key and character.
    expect(t.err(() => t.put({ ...cursed, id, key: "bane" })).code).toBe("invalid");
    const n = t.events.length;
    t.run(MOD_INTENTS.deletePreset, { presetId: house });
    expect(t.typesSince(n)).toEqual(["EffectPresetDeleted"]);
    expect(t.presets().map((p) => p.id)).toEqual([id]);
    // Back to the built-in: the next apply copies the built-in Bless.
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bless" } });
    expect(t.active().at(-1)).toMatchObject({
      label: "Bless",
      presetKey: "bless",
      modifiers: BLESS,
    });
  });

  test(`FR-MOD-06 at most ${CAMPAIGN_PRESETS_MAX} campaign presets (character presets don't count)`, () => {
    const t = modSetup();
    t.put(t.from("rage", { characterId: t.thornId }));
    for (let i = 0; i < CAMPAIGN_PRESETS_MAX; i++) t.put({ ...cursed, name: `Cursed ${i}` });
    const n = t.presets().length;
    expect(t.err(() => t.put(cursed)).code).toBe("conflict");
    expect(t.presets()).toHaveLength(n);
  });
});

describe("FR-MOD-07 character presets", () => {
  test("FR-MOD-07 the owner creates, edits, deletes their own; owner copy set; others / campaign → forbidden / not_found", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    expect(t.preset(rage)).toMatchObject({ characterId: t.thornId, ownerPlayerId: t.h.p2.id });
    t.put({ ...t.from("rage", { characterId: t.thornId }), id: rage, name: "Big Rage" }, t.p2);
    expect(t.preset(rage).name).toBe("Big Rage");
    expect(t.err(() => t.put(cursed, t.p2)).code).toBe("forbidden");
    expect(t.err(() => t.put(t.from("rage", { characterId: t.miraId }), t.p2)).code).toBe(
      "forbidden",
    );
    // Player 1 can't see Thorn's preset.
    expect(t.err(() => t.run(MOD_INTENTS.deletePreset, { presetId: rage }, t.p1)).code).toBe(
      "not_found",
    );
    const camp = t.put(cursed);
    expect(t.err(() => t.run(MOD_INTENTS.deletePreset, { presetId: camp }, t.p2)).code).toBe(
      "not_found",
    );
    // The DM edits any character's presets; an (imported, read-only) monster takes none.
    t.put(t.from("bless", { characterId: t.miraId }));
    expect(t.err(() => t.put(t.from("bless", { characterId: t.h.goblinId }))).code).toBe(
      "forbidden",
    );
    t.run(MOD_INTENTS.deletePreset, { presetId: rage }, t.p2);
    expect(t.presets().map((p) => p.name)).toEqual(["Cursed", "Bless"]);
  });

  test(`FR-MOD-07 at most ${CHARACTER_PRESETS_MAX} per character`, () => {
    const t = modSetup();
    for (let i = 0; i < CHARACTER_PRESETS_MAX; i++) {
      t.put(t.from("rage", { characterId: t.thornId, name: `Rage ${i}` }), t.p2);
    }
    expect(t.err(() => t.put(t.from("rage", { characterId: t.thornId }), t.p2)).code).toBe(
      "conflict",
    );
    t.put(t.from("rage", { characterId: t.miraId }), t.p1);
  });

  test("FR-MOD-07 locked sheet: owner edits and deletes → forbidden 'Locked by the DM'; toggles still work; the DM edits", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.run("char.setLock", { characterId: t.thornId, locked: true });
    const e = t.err(() => t.put({ ...t.from("rage", { characterId: t.thornId }), id: rage }, t.p2));
    expect([e.code, e.message]).toEqual(["forbidden", "Locked by the DM"]);
    expect(t.err(() => t.run(MOD_INTENTS.deletePreset, { presetId: rage }, t.p2)).code).toBe(
      "forbidden",
    );
    expect(t.toggle(t.thornId, rage, true, t.p2).effectId).not.toBeNull();
    t.put({ ...t.from("rage", { characterId: t.thornId }), id: rage, name: "DM Rage" });
    expect(t.preset(rage).name).toBe("DM Rage");
  });

  test("FR-MOD-07 owner change moves the preset rows: old owner gets a delete, new owner an upsert", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    const n = t.events.length;
    t.run("char.edit", { creatureId: t.thornId, set: { ownerPlayerId: t.h.p1.id } });
    expect(t.preset(rage).ownerPlayerId).toBe(t.h.p1.id);
    const ev = t.events[n]?.event;
    const change = ev?.changes.find((c) => c.id === rage);
    expect(change).toBeDefined();
    const viewer = (p: { id: string }) => ({
      connId: p.id,
      campaignId: t.h.campaignId,
      role: "player" as const,
      playerId: p.id,
    });
    expect(t.s.records.filterChange(change as never, viewer(t.h.p2))).toMatchObject({
      op: "delete",
    });
    expect(t.s.records.filterChange(change as never, viewer(t.h.p1))).toMatchObject({
      op: "upsert",
    });
  });
});

describe("FR-MOD-09/10 apply", () => {
  test("FR-MOD-09/10 Bless on 3 targets from Mira, concentration started: one concentration, 3 linked copies, 10 rounds", () => {
    const t = modSetup();
    const n = t.events.length;
    const r = t.apply({
      targets: [
        { combatantId: t.id("Mira") },
        { characterId: t.thornId },
        { combatantId: t.id("Goblin") },
      ],
      preset: { key: "bless" },
      sourceCombatantId: t.id("Mira"),
      startConcentration: true,
    });
    expect(r.skipped).toEqual([]);
    const [conc, ...fx] = t.active();
    expect(conc).toMatchObject({
      kind: "concentration",
      label: "Bless",
      targetCharacterId: t.miraId,
      endsRound: 11,
      anchorCombatantId: t.id("Mira"),
      modifiers: [],
      presetKey: null,
    });
    expect(fx.map((e) => e.id)).toEqual(r.effectIds);
    for (const e of fx) {
      expect(e).toMatchObject({
        kind: "custom",
        label: "Bless",
        modifiers: BLESS,
        presetKey: "bless",
        concentrationId: conc?.id,
        sourceCombatantId: t.id("Mira"),
        endsRound: 11,
        anchorCombatantId: t.id("Mira"),
      });
    }
    expect(t.typesSince(n)).toEqual(["PresetApplied"]);
    expect(t.events.at(-1)?.event.payload).toEqual({
      presetKey: "bless",
      effectIds: r.effectIds,
      concentrationId: conc?.id,
    });
    // Mira loses concentration → Bless ends on all three.
    t.end(conc?.id as string);
    expect(t.active()).toEqual([]);
  });

  test("FR-MOD-09 skip a target with the same preset active; re-cast with start concentration replaces it", () => {
    const t = modSetup();
    t.bless();
    const again = t.apply({
      targets: [{ combatantId: t.id("Mira") }, { combatantId: t.id("Goblin") }],
      preset: { key: "bless" },
      sourceCombatantId: t.id("Mira"),
      linkConcentration: true,
    });
    expect(again.skipped).toEqual(["Mira"]);
    expect(again.effectIds).toHaveLength(1);
    // Re-cast: the old concentration ends `replaced` with its links; fresh copies on both.
    const before = t.active().map((e) => e.id);
    const recast = t.bless();
    expect(recast.skipped).toEqual([]);
    expect(
      t
        .effects()
        .filter((e) => before.includes(e.id))
        .map((e) => e.endedReason),
    ).toEqual(["replaced", "concentration", "concentration", "concentration"]);
    expect(t.active()).toHaveLength(3);
  });

  test("FR-MOD-09 customised and campaign presets: label from the row, presetKey built-in key / preset id; given duration wins, null = none", () => {
    const t = modSetup();
    t.put(t.from("bless", { key: "bless", name: "House Bless", durationRounds: 3 }));
    const cid = t.put(cursed);
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bless" } });
    t.apply({
      targets: [{ combatantId: t.id("Goblin 2") }],
      preset: { presetId: cid },
      durationRounds: 4,
      secret: true,
    });
    t.apply({
      targets: [{ combatantId: t.id("Wolf") }],
      preset: { key: "bless" },
      durationRounds: null,
    });
    expect(
      t.active().map((e) => [e.label, e.presetKey, e.durationRounds, e.endsRound, e.secret]),
    ).toEqual([
      ["House Bless", "bless", 3, 4, false],
      ["Cursed", cid, 4, 5, true],
      ["House Bless", "bless", null, null, false],
    ]);
    // The hidden Wolf's copy is hidden (FR-CBTX-13).
    expect(t.active().at(-1)?.hidden).toBe(true);
  });

  test("FR-MOD-09 out of combat: durations dropped, no conflict; concentration without a source → invalid", () => {
    const t = modSetup();
    t.endEncounter();
    const r = t.apply({
      targets: [{ characterId: t.miraId }, { characterId: t.thornId }],
      preset: { key: "bless" },
    });
    expect(t.active().map((e) => [e.id, e.durationRounds, e.endsRound, e.encounterId])).toEqual(
      r.effectIds.map((id) => [id, null, null, null]),
    );
    expect(
      t.err(() =>
        t.apply({
          targets: [{ characterId: t.miraId }],
          preset: { key: "bless" },
          startConcentration: true,
        }),
      ).code,
    ).toBe("invalid");
  });

  test("FR-MOD-10 link needs the source concentrating; start needs a concentration preset; character presets stay on their character", () => {
    const t = modSetup();
    const link = () =>
      t.apply({
        targets: [{ combatantId: t.id("Goblin") }],
        preset: { key: "bane" },
        sourceCombatantId: t.id("Elite Goblin Warrior"),
        linkConcentration: true,
      });
    expect(t.err(link).code).toBe("conflict");
    const start = t.err(() =>
      t.apply({
        targets: [{ combatantId: t.id("Thorn") }],
        preset: { key: "rage" },
        sourceCombatantId: t.id("Thorn"),
        startConcentration: true,
      }),
    );
    expect([start.code, start.message]).toEqual(["invalid", "Rage is not a concentration preset"]);
    const rage = t.put(t.from("rage", { characterId: t.thornId }));
    expect(
      t.err(() => t.apply({ targets: [{ characterId: t.miraId }], preset: { presetId: rage } }))
        .code,
    ).toBe("invalid");
    expect(t.active()).toEqual([]);
  });

  test("FR-MOD-09 limits: a full target fails the whole apply (no effect, no concentration, no event)", () => {
    const t = modSetup();
    for (let i = 0; i < EFFECTS_PER_TARGET_MAX; i++) {
      t.add({ targets: [{ combatantId: t.id("Goblin") }], kind: "custom", label: `Mark ${i}` });
    }
    const n = t.events.length;
    const fxBefore = t.effects().length;
    const e = t.err(() =>
      t.apply({
        targets: [{ combatantId: t.id("Mira") }, { combatantId: t.id("Goblin") }],
        preset: { key: "bless" },
        sourceCombatantId: t.id("Mira"),
        startConcentration: true,
      }),
    );
    expect(e.code).toBe("conflict");
    expect(t.effects()).toHaveLength(fxBefore);
    expect(t.events.length).toBe(n);
  });

  test("FR-MOD-09 players can't apply (OQ-MOD-04)", () => {
    const t = modSetup();
    expect(
      t.err(() => t.apply({ targets: [{ characterId: t.miraId }], preset: { key: "bless" } }, t.p1))
        .code,
    ).toBe("forbidden");
  });
});

describe("FR-MOD-11 toggle", () => {
  test("FR-MOD-11 on / no-op / off / no-op: effect + activeEffectId in one event; toggled effect on the character", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    const n = t.events.length;
    const on = t.toggle(t.thornId, rage, true, t.p2);
    const e = t.fx(on.effectId as string);
    expect(e).toMatchObject({
      kind: "custom",
      label: "Rage",
      targetCharacterId: t.thornId,
      modifiers: builtinPreset("rage")?.modifiers,
      presetKey: rage,
      durationRounds: 10,
      endsRound: 11,
      anchorCombatantId: t.id("Thorn"),
      sourceCombatantId: null,
    });
    expect(t.preset(rage).activeEffectId).toBe(e.id);
    expect(t.toggle(t.thornId, rage, true, t.p2)).toEqual({ effectId: e.id });
    t.toggle(t.thornId, rage, false, t.p2);
    expect(t.fx(e.id).endedReason).toBe("removed");
    expect(t.preset(rage).activeEffectId).toBeNull();
    expect(t.toggle(t.thornId, rage, false, t.p2)).toEqual({ effectId: null });
    expect(t.typesSince(n)).toEqual(["EffectToggled", "EffectToggled"]);
    const toggled = t.events.slice(n).map((x) => x.event.changes.map((c) => c.type));
    expect(toggled).toEqual([
      ["effect", "effect-preset"],
      ["effect", "effect-preset"],
    ]);
  });

  test("FR-MOD-11 Rage expires on Next → reads off → toggle on again makes a new effect", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId, durationRounds: 1 }), t.p2);
    const first = t.toggle(t.thornId, rage, true, t.p2).effectId as string;
    t.nextTo("Thorn", 2);
    expect(t.fx(first).endedReason).toBe("expired");
    expect(t.preset(rage).activeEffectId).toBe(first);
    const again = t.toggle(t.thornId, rage, true, t.p2).effectId as string;
    expect(again).not.toBe(first);
    expect(t.preset(rage).activeEffectId).toBe(again);
  });

  test("FR-MOD-11 rights: owner and DM; another player forbidden; player force forbidden; DM force ok; campaign presets are applied", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    expect(t.err(() => t.toggle(t.thornId, rage, true, t.p1)).code).toBe("forbidden");
    expect(t.err(() => t.toggle(t.thornId, rage, true, t.p2, true)).code).toBe("forbidden");
    expect(t.toggle(t.thornId, rage, true, t.h.dm, true).effectId).not.toBeNull();
    const camp = t.put(cursed);
    expect(t.err(() => t.toggle(t.thornId, camp, true)).code).toBe("invalid");
    expect(t.err(() => t.toggle(t.miraId, rage, true)).code).toBe("invalid");
  });

  test("FR-MOD-11 out of combat: no duration; End of an encounter ends a timed toggle, which then reads off", () => {
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    const on = t.toggle(t.thornId, rage, true, t.p2).effectId as string;
    t.endEncounter();
    expect(t.fx(on).endedAt).not.toBeNull();
    const out = t.toggle(t.thornId, rage, true, t.p2).effectId as string;
    expect(t.fx(out)).toMatchObject({ durationRounds: null, endsRound: null, encounterId: null });
  });

  test("FR-MOD-30 crash: hard kill before commit → no effect, no activeEffectId; after commit → both", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = modSetup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    try {
      armCrashHook({ point: "before-commit", target: MOD_INTENTS.toggle }, kill);
      expect(() => t.toggle(t.thornId, rage, true, t.p2)).toThrow();
      expect(t.active()).toEqual([]);
      expect(t.preset(rage).activeEffectId).toBeNull();
      armCrashHook({ point: "after-commit", target: MOD_INTENTS.toggle }, kill);
      expect(() => t.toggle(t.thornId, rage, true, t.p2)).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    const [e] = t.active();
    expect(e?.label).toBe("Rage");
    expect(t.preset(rage).activeEffectId).toBe(e?.id ?? "");
  });
});

describe("FR-MOD-08 edit an effect's modifiers", () => {
  test("FR-MOD-08 DM edits an active custom effect (also a CBTX one); copies don't follow the preset", () => {
    const t = modSetup();
    t.bless();
    const [conc, mira] = t.active();
    const n = t.events.length;
    t.run(MOD_INTENTS.setModifiers, { effectId: mira?.id, modifiers: [...CURSED] });
    expect(t.fx(mira?.id as string).modifiers).toEqual([...CURSED]);
    expect(t.typesSince(n)).toEqual(["EffectModifiersSet"]);
    // Same list → no event.
    t.run(MOD_INTENTS.setModifiers, { effectId: mira?.id, modifiers: [...CURSED] });
    expect(t.events.length).toBe(n + 1);
    const [marked] = t.add({
      targets: [{ characterId: t.thornId }],
      kind: "custom",
      label: "Marked",
    }).effectIds;
    t.run(MOD_INTENTS.setModifiers, { effectId: marked, modifiers: BLESS });
    expect(t.fx(marked as string)).toMatchObject({ modifiers: BLESS, presetKey: null });
    expect(
      t.err(() => t.run(MOD_INTENTS.setModifiers, { effectId: conc?.id, modifiers: [] })).code,
    ).toBe("invalid");
    const [prone] = t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "condition",
      condition: "prone",
    }).effectIds;
    expect(
      t.err(() => t.run(MOD_INTENTS.setModifiers, { effectId: prone, modifiers: [] })).code,
    ).toBe("invalid");
    expect(
      t.err(() => t.run(MOD_INTENTS.setModifiers, { effectId: marked, modifiers: [] }, t.p2)).code,
    ).toBe("forbidden");
    t.end(marked as string);
    expect(
      t.err(() => t.run(MOD_INTENTS.setModifiers, { effectId: marked, modifiers: [] })).code,
    ).toBe("conflict");
    // Tier 2 built (R1): a mode part is a valid modifier; an unknown kind is not.
    const bad = [{ kind: "multiply", on: { roll: "check" }, value: 2 }];
    expect(
      t.err(() => t.run(MOD_INTENTS.setModifiers, { effectId: mira?.id, modifiers: bad })).code,
    ).toBe("invalid");
  });
});
