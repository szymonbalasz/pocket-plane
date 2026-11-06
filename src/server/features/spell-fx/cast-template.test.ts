// FR-VFX-40 (bundle `spell-fx`): a template-anchored preset (Black Tentacles) is cast into a kept
// AoE template placed in the same command; the effect's `fx.templateId` points at it; the
// template goes when the effect ends (End, a replaced concentration) or its map effect changes.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { SpellRow } from "@shared/character-sheet/sheet";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { SCN_INTENTS } from "@shared/scene-tools/schemas";
import { castFromRowMessage, placeFirstMessage, VFX_INTENTS } from "@shared/spell-fx/intents";
import { asc, eq, isNull } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { closeDb, openMemoryDb } from "../../db/client";
import {
  aoeTemplate,
  campaign,
  creatureSheet,
  effect,
  entity,
  eventLog,
  player,
  scene,
} from "../../db/schema";
import type { Actor } from "../../events/types";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices } from "../../testing/services";

const loaded = await loadBundle("spell-fx", { testMode: true });
afterAll(() => {
  try {
    loaded.cleanup();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
  }
});

const bundleBytes = (() => {
  const db = loaded.openDb();
  db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
  const bytes = db.$client.serialize();
  closeDb(db);
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
const spellId = (who: string, spell: string) =>
  (
    (b.db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, entityId(who)))
      .get()?.spells as SpellRow[] | undefined) ?? []
  ).find((s) => s.name === spell)?.id as string;
const TENTACLES = "Evard's Black Tentacles";
const activeScene = () => b.db.select().from(scene).where(eq(scene.active, true)).get()?.id ?? "";
const otherScene = () =>
  b.db
    .select()
    .from(scene)
    .all()
    .find((s) => s.campaignId === cid() && !s.active)?.id;
const templates = () =>
  b.db
    .select()
    .from(aoeTemplate)
    .all()
    .filter((t) => t.label === TENTACLES);
const activeFx = () =>
  b.db
    .select()
    .from(effect)
    .where(isNull(effect.endedAt))
    .all()
    .filter((e) => e.fx);

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

const place = (extra: Record<string, unknown> = {}) => ({
  sceneId: activeScene(),
  x: 4,
  y: 3,
  angle: 0,
  ...extra,
});
const castThorn = (input: Record<string, unknown> = {}, actor: Actor = asPlayer("Player 2")) =>
  run(
    VFX_INTENTS.cast,
    { creatureId: entityId("Thorn"), spellId: spellId("Thorn", TENTACLES), ...input },
    actor,
  ) as { effectId: string };

describe("FR-VFX-40 cast into a kept template", () => {
  test("FR-VFX-40 player cast places a 20 ft cube (placer = them, label = spell) and links it", () => {
    const before = b.db.select().from(eventLog).all().length;
    const { effectId } = castThorn({ place: place({ angle: 90 }) });
    const [t] = templates();
    expect(t).toMatchObject({
      sceneId: activeScene(),
      shape: "cube",
      size: 20,
      x: 4,
      y: 3,
      angle: 90,
      label: TENTACLES,
      placedByPlayerId: playerId("Player 2"),
      hidden: false,
    });
    const e = b.db.select().from(effect).where(eq(effect.id, effectId)).get();
    expect(e?.kind).toBe("concentration");
    expect(e?.fx).toEqual({
      preset: "black-tentacles",
      params: {},
      spellId: spellId("Thorn", TENTACLES),
      templateId: t?.id,
    });
    // One command: the template's event, then the effect's.
    const types = b.db
      .select()
      .from(eventLog)
      .orderBy(asc(eventLog.seq))
      .all()
      .slice(before)
      .map((x) => x.type);
    expect(types[0]).toBe("TemplatePlaced");
    expect(types.length).toBeGreaterThan(1);
  });

  test("FR-VFX-40 no place → conflict; place on a token preset → invalid; nothing written", () => {
    expect(err(() => castThorn())).toEqual({
      code: "conflict",
      message: placeFirstMessage(TENTACLES),
    });
    const moil = () =>
      run(
        VFX_INTENTS.cast,
        {
          creatureId: entityId("Thorn"),
          spellId: spellId("Thorn", "Shadow of Moil"),
          place: place(),
        },
        asPlayer("Player 2"),
      );
    expect(err(moil).code).toBe("invalid");
    expect(templates()).toHaveLength(0);
    expect(activeFx()).toHaveLength(0);
  });

  test("FR-VFX-40 a player places on the active scene only and never sets hidden", () => {
    const other = otherScene();
    if (other)
      expect(err(() => castThorn({ place: place({ sceneId: other }) })).code).toBe("invalid");
    expect(err(() => castThorn({ place: place({ hidden: true }) })).code).toBe("invalid");
    expect(templates()).toHaveLength(0);
  });

  test("FR-VFX-40 the DM casting a character's spell places it for the owner; hidden is theirs", () => {
    castThorn({ place: place({ hidden: true }) }, dm());
    expect(templates()[0]).toMatchObject({
      placedByPlayerId: playerId("Player 2"),
      hidden: true,
    });
  });

  test("FR-VFX-40 the owner may move it (scn.updateTemplate), the DM too", () => {
    castThorn({ place: place() });
    const id = templates()[0]?.id as string;
    run(SCN_INTENTS.updateTemplate, { templateId: id, x: 6, y: 5 }, asPlayer("Player 2"));
    run(SCN_INTENTS.updateTemplate, { templateId: id, angle: 45 });
    expect(templates()[0]).toMatchObject({ x: 6, y: 5, angle: 45 });
    expect(
      err(() => run(SCN_INTENTS.updateTemplate, { templateId: id, x: 1 }, asPlayer("Player 1")))
        .code,
    ).toBe("forbidden");
  });

  test("FR-VFX-40 End removes the template in the same command", () => {
    const { effectId } = castThorn({ place: place() });
    expect(templates()).toHaveLength(1);
    run(CBTX_INTENTS.endEffect, { effectId }, asPlayer("Player 2"));
    expect(templates()).toHaveLength(0);
    expect(activeFx()).toHaveLength(0);
  });

  test("FR-VFX-40 a new concentration ends the old one and its template", () => {
    castThorn({ place: place() });
    run(
      VFX_INTENTS.cast,
      { creatureId: entityId("Thorn"), spellId: spellId("Thorn", "Shadow of Moil") },
      asPlayer("Player 2"),
    );
    expect(templates()).toHaveLength(0);
    expect(activeFx().map((e) => e.fx?.preset)).toEqual(["shadow-of-moil"]);
  });

  test("FR-VFX-40 a deleted template leaves the effect running (nothing drawn); End still works", () => {
    const { effectId } = castThorn({ place: place() });
    run(SCN_INTENTS.deleteTemplate, { templateId: templates()[0]?.id }, asPlayer("Player 2"));
    expect(activeFx()).toHaveLength(1);
    run(CBTX_INTENTS.endEffect, { effectId }, asPlayer("Player 2"));
    expect(activeFx()).toHaveLength(0);
  });

  test("FR-VFX-40 setEffectFx refuses a template preset; clearing the map effect removes the template", () => {
    const { effectId } = castThorn({ place: place() });
    const tentacles = { preset: "black-tentacles", params: {} };
    // On another effect (Mira's Spirit Guardians) → conflict.
    const sg = run(
      VFX_INTENTS.cast,
      { creatureId: entityId("Mira"), spellId: spellId("Mira", "Spirit Guardians") },
      asPlayer("Player 1"),
    ) as { effectId: string };
    expect(
      err(() => run(VFX_INTENTS.setEffectFx, { effectId: sg.effectId, fx: tentacles })),
    ).toEqual({ code: "conflict", message: castFromRowMessage("Black Tentacles") });
    // The same preset again (the effect dialog saved unchanged) → no-op, template kept.
    run(VFX_INTENTS.setEffectFx, { effectId, fx: tentacles });
    expect(templates()).toHaveLength(1);
    run(VFX_INTENTS.setEffectFx, { effectId, fx: null });
    expect(templates()).toHaveLength(0);
    expect(b.db.select().from(effect).where(eq(effect.id, effectId)).get()?.endedAt).toBeNull();
  });
});
