// VFX §13 Integration (in-process, bundle `spell-fx`): `vfx.cast` (FR-VFX-07, -08) through the
// combat-extras paths, `vfx.setEffectFx` (FR-VFX-09) permissions, `fx` visibility (VFX §8,
// FR-CBTX-31), crash before / after commit (state digest).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { CHARX_INTENTS, type SpellRow } from "@shared/character-sheet/sheet";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import { VFX_INTENTS } from "@shared/spell-fx/intents";
import { and, eq, isNull } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { closeDb, openMemoryDb } from "../../db/client";
import { stateDigest } from "../../db/digest";
import {
  campaign,
  combatant,
  creatureSheet,
  effect,
  entity,
  eventLog,
  gameLogEntry,
  player,
} from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { silentLogger } from "../../log";
import { createServices, type Services } from "../../services";
import { createTestServices } from "../../testing/services";
import type { Viewer } from "../../ws/records";

class Killed extends Error {}
const kill = () => {
  throw new Killed();
};

const loaded = await loadBundle("spell-fx", { testMode: true });
afterAll(() => {
  try {
    loaded.cleanup();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
  }
});

// Each test boots a server on a fresh in-memory copy of the bundle as loaded.
const bundleBytes = (() => {
  const db = loaded.openDb();
  db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
  const bytes = db.$client.serialize();
  closeDb(db);
  // A WAL file's header (bytes 18–19 = 2) won't open in memory: mark it rollback-journal.
  bytes[18] = 1;
  bytes[19] = 1;
  return bytes;
})();

async function boot() {
  const db = openMemoryDb(bundleBytes);
  const s = createServices({ config: createTestServices().config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  return { s, db };
}

let b: Awaited<ReturnType<typeof boot>>;
beforeEach(async () => {
  armCrashHook(null);
  if (b) closeDb(b.db);
  b = await boot();
});

const cid = () => b.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id ?? "";
const dm = (): Actor => ({ role: "dm", playerId: null, campaignId: cid() });
const playerId = (name: string) =>
  b.db.select().from(player).where(eq(player.name, name)).get()?.id as string;
const asPlayer = (name: string): Actor => ({
  role: "player",
  playerId: playerId(name),
  campaignId: cid(),
});
const entityId = (name: string) =>
  b.db.select().from(entity).where(eq(entity.name, name)).get()?.id as string;
const spellsOf = (name: string) =>
  (b.db
    .select()
    .from(creatureSheet)
    .where(eq(creatureSheet.entityId, entityId(name)))
    .get()?.spells as SpellRow[] | undefined) ?? [];
const spellId = (who: string, spell: string) =>
  spellsOf(who).find((s) => s.name === spell)?.id as string;
const fighter = (name: string) =>
  b.db
    .select()
    .from(combatant)
    .where(and(eq(combatant.name, name), eq(combatant.active, true)))
    .get() as typeof combatant.$inferSelect;
const active = () =>
  b.db.select().from(effect).where(isNull(effect.endedAt)).all() as unknown as EffectRecord[];

function run(name: string, input: unknown, actor: Actor = dm()) {
  return b.s.commands.run(name, input, { actor });
}
function err(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a CommandError");
}
function events(s: Services) {
  const out: DispatchedEvent[] = [];
  s.bus.subscribe("test-events", (e) => {
    out.push(e);
  });
  return out;
}
const castMira = (actor: Actor = asPlayer("Player 1")) =>
  run(
    VFX_INTENTS.cast,
    { creatureId: entityId("Mira"), spellId: spellId("Mira", "Spirit Guardians") },
    actor,
  ) as {
    effectId: string;
  };

describe("vfx.cast (FR-VFX-07, -08)", () => {
  test("FR-VFX-07 cast: concentration row → concentration with fx.spellId, the effect's own event", () => {
    const seen = events(b.s);
    const { effectId } = castMira();
    const e = active().find((x) => x.id === effectId);
    expect(e).toMatchObject({
      kind: "concentration",
      label: "Spirit Guardians",
      targetCharacterId: entityId("Mira"),
      fx: {
        preset: "spirit-guardians",
        params: { variant: "radiant", radiusFt: 15 },
        spellId: spellId("Mira", "Spirit Guardians"),
      },
    });
    // One transaction: one event, the concentration's own, its change carrying `fx`.
    expect(seen.map((x) => x.event.type)).toEqual(["ConcentrationSet"]);
    const change = seen[0]?.event.changes.find((c) => c.type === EFFECT_TYPE && c.before === null);
    expect((change?.after as EffectRecord | undefined)?.fx?.spellId).toBe(
      spellId("Mira", "Spirit Guardians"),
    );
  });

  test("FR-VFX-07 cast replaces the current concentration and ends its linked effects", () => {
    const { effectId: bless } = run(CBTX_INTENTS.setConcentration, {
      target: { characterId: entityId("Mira") },
      label: "Bless",
    }) as { effectId: string };
    run(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: fighter("Thorn").id }],
      kind: "custom",
      label: "Blessed",
      sourceCombatantId: fighter("Mira").id,
      linkConcentration: true,
    });
    const { effectId } = castMira();
    const rows = b.db.select().from(effect).all();
    expect(rows.find((r) => r.id === bless)?.endedReason).toBe("replaced");
    expect(rows.find((r) => r.label === "Blessed")?.endedReason).toBe("concentration");
    expect(
      active()
        .filter((e) => e.kind === "concentration")
        .map((e) => e.id),
    ).toEqual([effectId]);
  });

  test("FR-VFX-07 a row without concentration → a custom effect, no duration (OQ-VFX-09 A)", () => {
    run(CHARX_INTENTS.putRow, {
      creatureId: entityId("Thorn"),
      list: "spells",
      row: {
        name: "Darkness Cloak",
        level: 2,
        fx: { preset: "shadow-of-moil", params: { radiusFt: 5 } },
      },
    });
    const id = spellId("Thorn", "Darkness Cloak");
    const { effectId } = run(
      VFX_INTENTS.cast,
      { creatureId: entityId("Thorn"), spellId: id },
      asPlayer("Player 2"),
    ) as {
      effectId: string;
    };
    expect(active().find((e) => e.id === effectId)).toMatchObject({
      kind: "custom",
      label: "Darkness Cloak",
      durationRounds: null,
      targetCharacterId: entityId("Thorn"),
      fx: { preset: "shadow-of-moil", params: { radiusFt: 5 }, spellId: id },
    });
  });

  test("FR-VFX-07 conflicts: no map effect, already active; deleted row → not_found", () => {
    const sgId = spellId("Mira", "Spirit Guardians");
    const fire = spellId("Mira", "Fire Bolt");
    expect(
      err(() => run(VFX_INTENTS.cast, { creatureId: entityId("Mira"), spellId: fire })),
    ).toEqual({
      code: "conflict",
      message: "No map effect on Fire Bolt",
    });
    castMira();
    // Two Casts of the same row: the second loses (§11 concurrent edits).
    expect(err(() => castMira(dm()))).toEqual({
      code: "conflict",
      message: "Spirit Guardians is already active",
    });
    expect(
      err(() => run(VFX_INTENTS.cast, { creatureId: entityId("Mira"), spellId: "gone" })),
    ).toEqual({ code: "not_found", message: "Row was deleted" });
    // Ended → Cast again works.
    const conc = active().find((e) => e.fx?.spellId === sgId) as EffectRecord;
    run(CBTX_INTENTS.endEffect, { effectId: conc.id }, asPlayer("Player 1"));
    expect(castMira().effectId).not.toBe(conc.id);
  });

  test("FR-VFX-07 who: the owner (locked sheet too) and the DM; another player → forbidden", () => {
    run(CHARX_INTENTS.setLock, { characterId: entityId("Mira"), locked: true });
    expect(
      err(() =>
        run(
          VFX_INTENTS.cast,
          { creatureId: entityId("Mira"), spellId: spellId("Mira", "Spirit Guardians") },
          asPlayer("Player 2"),
        ),
      ).code,
    ).toBe("forbidden");
    expect(castMira().effectId).toBeString();
    // DM on Thorn's sheet.
    const { effectId } = run(VFX_INTENTS.cast, {
      creatureId: entityId("Thorn"),
      spellId: spellId("Thorn", "Shadow of Moil"),
    }) as { effectId: string };
    expect(active().find((e) => e.id === effectId)?.targetCharacterId).toBe(entityId("Thorn"));
  });

  test("FR-VFX-08 cast never uses a slot, rolls or changes HP", () => {
    const sheetBefore = b.db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, entityId("Mira")))
      .get();
    const hpBefore = b.db
      .select()
      .from(entity)
      .where(eq(entity.id, entityId("Mira")))
      .get();
    const lines = b.db.select().from(gameLogEntry).all().length;
    castMira();
    const sheetAfter = b.db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, entityId("Mira")))
      .get();
    expect(sheetAfter?.slotsUsed).toEqual(sheetBefore?.slotsUsed ?? {});
    expect(sheetAfter?.spells).toEqual(sheetBefore?.spells ?? []);
    expect(
      b.db
        .select()
        .from(entity)
        .where(eq(entity.id, entityId("Mira")))
        .get()?.statBlock,
    ).toEqual(hpBefore?.statBlock);
    expect(b.db.select().from(gameLogEntry).all().length).toBe(lines);
  });
});

describe("vfx.setEffectFx (FR-VFX-09)", () => {
  const SG = { preset: "spirit-guardians", params: { variant: "necrotic" } };

  test("FR-VFX-09 DM: any active effect (a monster's); event EffectFxSet logged; null clears", () => {
    const { effectIds } = run(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: fighter("Goblin Sneak").id }],
      kind: "custom",
      label: "Cultist aura",
    }) as { effectIds: string[] };
    const id = effectIds[0] as string;
    const seen = events(b.s);
    run(VFX_INTENTS.setEffectFx, { effectId: id, fx: SG });
    expect(active().find((e) => e.id === id)?.fx).toEqual({
      preset: "spirit-guardians",
      params: { variant: "necrotic", radiusFt: 15 },
    });
    expect(seen.map((e) => e.event.type)).toEqual(["EffectFxSet"]);
    expect(b.db.select().from(eventLog).where(eq(eventLog.type, "EffectFxSet")).all()).toHaveLength(
      1,
    );
    // The same value again → no event.
    run(VFX_INTENTS.setEffectFx, { effectId: id, fx: SG });
    expect(seen).toHaveLength(1);
    run(VFX_INTENTS.setEffectFx, { effectId: id, fx: null });
    expect(active().find((e) => e.id === id)?.fx).toBeNull();
  });

  test("FR-VFX-09 player: own character's non-secret effects only; FR-VFX-03 bad fx → invalid", () => {
    const { effectId: own } = run(CBTX_INTENTS.setConcentration, {
      target: { characterId: entityId("Mira") },
      label: "Bless",
    }) as { effectId: string };
    run(VFX_INTENTS.setEffectFx, { effectId: own, fx: SG }, asPlayer("Player 1"));
    expect(active().find((e) => e.id === own)?.fx?.preset).toBe("spirit-guardians");
    // Another player's character's effect: forbidden.
    expect(
      err(() => run(VFX_INTENTS.setEffectFx, { effectId: own, fx: null }, asPlayer("Player 2")))
        .code,
    ).toBe("forbidden");
    // A monster's visible effect: forbidden; a secret one: not_found (never confirmed).
    const add = (secret: boolean) =>
      (
        run(CBTX_INTENTS.addEffect, {
          targets: [{ combatantId: fighter("Goblin Sneak").id }],
          kind: "custom",
          label: secret ? "Hex" : "Marked",
          secret,
        }) as { effectIds: string[] }
      ).effectIds[0] as string;
    expect(
      err(() =>
        run(VFX_INTENTS.setEffectFx, { effectId: add(false), fx: SG }, asPlayer("Player 1")),
      ).code,
    ).toBe("forbidden");
    expect(
      err(() => run(VFX_INTENTS.setEffectFx, { effectId: add(true), fx: SG }, asPlayer("Player 1")))
        .code,
    ).toBe("not_found");
    // A secret effect on their own character: not_found too.
    const { effectIds } = run(CBTX_INTENTS.addEffect, {
      targets: [{ characterId: entityId("Mira") }],
      kind: "custom",
      label: "Cursed",
      secret: true,
    }) as { effectIds: string[] };
    expect(
      err(() =>
        run(VFX_INTENTS.setEffectFx, { effectId: effectIds[0], fx: SG }, asPlayer("Player 1")),
      ).code,
    ).toBe("not_found");
    expect(
      err(() =>
        run(VFX_INTENTS.setEffectFx, { effectId: own, fx: { preset: "fireball", params: {} } }),
      ).code,
    ).toBe("invalid");
    expect(
      err(() =>
        run(VFX_INTENTS.setEffectFx, {
          effectId: own,
          fx: { preset: "shadow-of-moil", params: { radiusFt: 40 } },
        }),
      ).code,
    ).toBe("invalid");
    // Ended → not_found.
    run(CBTX_INTENTS.endEffect, { effectId: own });
    expect(err(() => run(VFX_INTENTS.setEffectFx, { effectId: own, fx: null })).code).toBe(
      "not_found",
    );
  });
});

describe("fx visibility (VFX §8, FR-CBTX-31)", () => {
  const viewer = (role: "dm" | "player", name?: string): Viewer => ({
    connId: "t",
    campaignId: cid(),
    role,
    playerId: name ? playerId(name) : null,
  });
  const effectsFor = (v: Viewer) =>
    (b.s.records.snapshot({ db: b.db, presence: { list: () => [] } }, v)[EFFECT_TYPE] ?? []) as {
      id: string;
      fx?: unknown;
    }[];

  test("VFX §8 fx rides the effect's rule: players get it on received effects; secret / hidden never", () => {
    const { effectId: sg } = castMira();
    const add = (secret: boolean) =>
      (
        run(CBTX_INTENTS.addEffect, {
          targets: [{ combatantId: fighter("Goblin Sneak").id }],
          kind: "custom",
          label: secret ? "Secret aura" : "Hidden aura",
          secret,
        }) as { effectIds: string[] }
      ).effectIds[0] as string;
    const secret = add(true);
    const hiddenOne = add(false);
    run(VFX_INTENTS.setEffectFx, {
      effectId: secret,
      fx: { preset: "shadow-of-moil", params: {} },
    });
    run(VFX_INTENTS.setEffectFx, {
      effectId: hiddenOne,
      fx: { preset: "shadow-of-moil", params: {} },
    });
    // Hide the goblin: its effects' `hidden` copy follows (FR-CBTX-13).
    run("map.setTokenHidden", { tokenId: fighter("Goblin Sneak").tokenId, hidden: true });
    const dmIds = effectsFor(viewer("dm")).map((e) => e.id);
    expect(dmIds).toEqual(expect.arrayContaining([sg, secret, hiddenOne]));
    for (const p of ["Player 1", "Player 2"]) {
      const got = effectsFor(viewer("player", p));
      expect(got.find((e) => e.id === sg)?.fx).toMatchObject({ preset: "spirit-guardians" });
      expect(got.some((e) => e.id === secret || e.id === hiddenOne)).toBe(false);
      expect(JSON.stringify(got)).not.toContain("shadow-of-moil");
    }
  });
});

describe("crash (VFX §11)", () => {
  test("VFX §11 vfx.cast crash: before-commit → nothing (digest equal); after-commit → effect + fx", async () => {
    const before = stateDigest(b.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: VFX_INTENTS.cast }, kill);
    expect(() => castMira()).toThrow();
    armCrashHook(null);
    expect(stateDigest(b.db.$client).sha256).toBe(before);
    expect(active().some((e) => e.fx !== null)).toBe(false);
    armCrashHook({ point: "after-commit", target: VFX_INTENTS.cast }, kill);
    expect(() => castMira()).toThrow(Killed);
    armCrashHook(null);
    expect(stateDigest(b.db.$client).sha256).not.toBe(before);
    const fx = active().filter((e) => e.fx !== null);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ kind: "concentration", label: "Spirit Guardians" });
    expect(
      b.db.select().from(eventLog).where(eq(eventLog.type, "ConcentrationSet")).all(),
    ).toHaveLength(1);
  });
});
