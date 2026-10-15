// FR-MOD-21/22 visibility on the `effect-modifiers` bundle (MOD §13 leak strings): player
// snapshots and live changes never carry campaign presets, other players' presets, preset ids
// on effects, or monster-effect modifiers; the DM gets everything.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { EFFECT_PRESET_TYPE, type EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { servicesFromBundle, snapshotFrames } from "../../ws/testing/snapshot-size";
import { presetVisibility } from "./records";

const LEAKS = ["Cursed", "House: Bless (test)"];

let b: Awaited<ReturnType<typeof servicesFromBundle>>;
beforeAll(async () => {
  b = await servicesFromBundle(await loadBundle("effect-modifiers", { testMode: true }));
}, 30_000);
afterAll(() => b.cleanup());

const frames = () => snapshotFrames(b.s);
const dmFrame = () => frames().find((f) => f.viewer.role === "dm");
const presetsOf = (f: ReturnType<typeof frames>[number] | undefined) =>
  (f?.records[EFFECT_PRESET_TYPE] ?? []) as EffectPresetRecord[];

function playerChecks(json: string, records: Record<string, unknown[]>, viewer: Viewer) {
  for (const s of LEAKS) expect(json).not.toContain(s);
  const dmPresets = presetsOf(dmFrame());
  // No preset id on any effect; others' preset ids nowhere.
  const fx = (records[EFFECT_TYPE] ?? []) as Record<string, unknown>[];
  for (const p of dmPresets) {
    expect(JSON.stringify(fx)).not.toContain(p.id);
    if (p.ownerPlayerId !== viewer.playerId) expect(json).not.toContain(p.id);
  }
  for (const e of fx) {
    if (e.targetCombatantId !== null) {
      expect(Object.keys(e)).not.toContain("modifiers");
      expect(Object.keys(e)).not.toContain("presetKey");
    }
  }
  for (const p of (records[EFFECT_PRESET_TYPE] ?? []) as EffectPresetRecord[]) {
    expect(p.characterId).not.toBeNull();
    expect(p.ownerPlayerId).toBe(viewer.playerId);
  }
}

describe("FR-MOD-21/22 snapshots", () => {
  test("FR-MOD-22 DM gets every preset; player-2 only Thorn's Rage; player-1 none", () => {
    const fs = frames();
    expect(fs.map((f) => [f.label, presetsOf(f).map((p) => p.name)])).toEqual([
      ["DM", ["Bless", "Cursed", "Rage"]],
      ["P1", []],
      ["P2", ["Rage"]],
    ]);
    expect(presetsOf(fs[0]).map((p) => p.note)).toContain("House: Bless (test)");
  });

  test("FR-MOD-21 players: PC Bless with modifiers + built-in key; monster Bane / Cursed without; no leak string", () => {
    for (const f of frames().filter((x) => x.viewer.role === "player")) {
      const fx = (f.records[EFFECT_TYPE] ?? []) as Record<string, unknown>[];
      const pcBless = fx.filter((e) => e.kind === "custom" && e.label === "Bless");
      expect(pcBless).toHaveLength(2);
      for (const e of pcBless) expect(e).toMatchObject({ presetKey: "bless" });
      // Bane on the visible Goblin shows as a chip (no modifiers); secret Cursed not at all.
      expect(
        fx.filter((e) => e.label === "Bane").map((e) => Object.keys(e).includes("modifiers")),
      ).toEqual([false]);
      playerChecks(JSON.stringify(f.records), f.records, f.viewer);
    }
  });

  test("FR-MOD-22 visibility fn: owner full, everyone else hidden", () => {
    const v = (playerId: string | null): Viewer => ({
      connId: "c",
      campaignId: "k",
      role: playerId ? "player" : "dm",
      playerId,
    });
    const own = { ownerPlayerId: "p2" } as EffectPresetRecord;
    const camp = { ownerPlayerId: null } as EffectPresetRecord;
    expect(presetVisibility(own, v("p2"))).toBe("full");
    expect(presetVisibility(own, v("p1"))).toBe("hidden");
    expect(presetVisibility(camp, v("p1"))).toBe("hidden");
  });
});

describe("FR-MOD-21/22 live changes", () => {
  test("FR-MOD-21/22 apply, toggle, preset edits, modifier edits: no leak in any player's changes; DM sees ids", () => {
    const dm = frames()[0]?.viewer as Viewer;
    const players = frames()
      .filter((f) => f.viewer.role === "player")
      .map((f) => f.viewer);
    const events: DispatchedEvent[] = [];
    b.s.bus.subscribe("mod-leak-scan", (e) => events.push(e));
    const actor: Actor = { role: "dm", playerId: null, campaignId: dm.campaignId };
    const run = <R>(name: string, input: unknown) => b.s.commands.run(name, input, { actor }) as R;
    const [house, cursed, rage] = presetsOf(dmFrame());
    run(MOD_INTENTS.putPreset, {
      preset: {
        ...pickInput(house as EffectPresetRecord),
        id: house?.id,
        note: "House: Bless (test)",
      },
    });
    run(MOD_INTENTS.putPreset, {
      preset: { ...pickInput(cursed as EffectPresetRecord), id: cursed?.id },
    });
    run(MOD_INTENTS.toggle, { characterId: rage?.characterId, presetId: rage?.id, on: true });
    const fx = (frames()[0]?.records[EFFECT_TYPE] ?? []) as {
      id: string;
      label: string;
      targetCharacterId: string | null;
    }[];
    const thornBless = fx.find(
      (e) => e.label === "Bless" && e.targetCharacterId === rage?.characterId,
    );
    run(MOD_INTENTS.setModifiers, {
      effectId: thornBless?.id,
      modifiers: [{ kind: "flat", on: { roll: "attack" }, value: 1 }],
    });
    const goblin2 = fx.find((e) => e.label === "Cursed");
    run(MOD_INTENTS.setModifiers, { effectId: goblin2?.id, modifiers: [] });
    run(MOD_INTENTS.toggle, { characterId: rage?.characterId, presetId: rage?.id, on: false });
    expect(events.map((e) => e.event.type)).toEqual([
      "EffectPresetSaved",
      "EffectPresetSaved",
      "EffectToggled",
      "EffectModifiersSet",
      "EffectModifiersSet",
      "EffectToggled",
    ]);
    const changes = events.flatMap((e) => e.event.changes);
    for (const v of players) {
      const wire = changes.map((c) => b.s.records.filterChange(c, v)).filter(Boolean);
      const json = JSON.stringify(wire);
      for (const s of LEAKS) expect(json).not.toContain(s);
      for (const p of [house, cursed]) expect(json).not.toContain(p?.id as string);
      const effects = wire.filter((w) => w?.type === EFFECT_TYPE);
      expect(JSON.stringify(effects)).not.toContain(rage?.id as string);
      const presetWire = wire.filter((w) => w?.type === EFFECT_PRESET_TYPE);
      expect(presetWire.length > 0).toBe(v.playerId === rage?.ownerPlayerId);
    }
    expect(JSON.stringify(changes.map((c) => b.s.records.filterChange(c, dm)))).toContain(
      "House: Bless (test)",
    );
  });
});

const pickInput = (p: EffectPresetRecord) => ({
  characterId: p.characterId,
  key: p.key,
  name: p.name,
  modifiers: p.modifiers,
  durationRounds: p.durationRounds,
  concentration: p.concentration,
  note: p.note,
});
