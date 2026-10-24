// Sprint 6 track CP, CP0 (ENT §13 / CBT §13.3): pets (FR-ENT-31–38), the companion card copy
// (FR-CHARX-60, -70) and the map seams (FR-MAP-74, -78, -79).
import { describe, expect, test } from "bun:test";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import {
  companionCard,
  ENTITY_TYPE,
  EntityRecord,
  type MonsterStatBlock,
  RedactedPet,
} from "@shared/entities/schemas";
import { MAP_INTENTS, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import { creatureSheet, entity } from "../../db/schema";
import { TEST_SECRET } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { cpSetup, owlbearBlock } from "../combat-tracker/cp-testing";
import { summonSetup } from "../combat-tracker/summon-testing";
import { sceneSources } from "../fog-of-war/sight";
import { createScene } from "../scenes-map/commands";

const ids = (n: number) => {
  let i = 0;
  return () => `id-${n}-${++i}`;
};

describe("FR-ENT-31 / FR-CHARX-60 shapes", () => {
  test("FR-ENT-31 pet fields", () => {
    const base = {
      id: "p",
      kind: "monster",
      name: "Owlbear",
      campaignId: "c",
      portraitAssetId: null,
      tokenShape: null,
      derivedFromId: null,
      createdAt: "t",
      updatedAt: "t",
      statBlock: owlbearBlock,
    };
    // A monster with companionOf + hpCurrent parses; an old monster row (no pet fields) too.
    expect(
      EntityRecord.safeParse({
        ...base,
        ownerPlayerId: "p1",
        hpCurrent: 45,
        companionOf: "mira",
        turnMode: "after-owner",
        petPresent: true,
      }).success,
    ).toBe(true);
    expect(EntityRecord.parse({ ...base, ownerPlayerId: null, hpCurrent: null })).toMatchObject({
      companionOf: null,
      turnMode: null,
      petPresent: false,
    });
    // The other players' view is a strict whitelist.
    expect(Object.keys(RedactedPet.shape).sort()).toEqual(
      ["band", "companionOf", "id", "kind", "name", "ownerPlayerId", "portraitAssetId"].sort(),
    );
  });

  test("FR-CHARX-60 card fields", () => {
    const card = companionCard(owlbearBlock, ids(1));
    expect(card).toMatchObject({
      size: "large",
      type: "monstrosity",
      ac: 13,
      hpMax: 59,
      speed: 40,
    });
    expect(card.attacks.map((a) => [a.name, a.toHit, a.damage, a.damageType])).toEqual([
      ["Beak", 7, "1d10+5", "piercing"],
      ["Claws", 7, "2d8+5", "slashing"],
    ]);
    // 9 attacks → 8 + "+1 more"; no speed → absent.
    const { speed: _s, ...noSpeed } = owlbearBlock;
    const nine = {
      ...noSpeed,
      attacks: Array.from({ length: 9 }, (_, i) => ({ name: `A${i}`, toHit: 1, damage: "1d4" })),
    } as MonsterStatBlock;
    const c9 = companionCard(nine, ids(2));
    expect([c9.attacks.length, c9.more, c9.speed]).toEqual([8, 1, undefined]);
    // Stable ids: a refresh keeps an id while the row at that index keeps its name.
    const again = companionCard(owlbearBlock, ids(3), card);
    expect(again.attacks.map((a) => a.id)).toEqual(card.attacks.map((a) => a.id));
    const [beak, clawsRow] = owlbearBlock.attacks;
    const renamed = companionCard(
      { ...owlbearBlock, attacks: [beak, { ...clawsRow, name: "Talons" }] } as MonsterStatBlock,
      ids(4),
      card,
    );
    expect(renamed.attacks[0]?.id).toBe(card.attacks[0]?.id);
    expect(renamed.attacks[1]?.id).not.toBe(card.attacks[1]?.id);
    // ≤ 2,038 B measured at the max (CBT §12).
    expect(JSON.stringify(c9).length).toBeLessThan(2_100);
  });
});

describe("FR-ENT-32 / -33 / -35 make, release, caps", () => {
  test("FR-ENT-32 make pet", async () => {
    const t = cpSetup({ start: false });
    // Server copy of an imported base: block (rows get ids), shape, derivedFromId; HP full.
    const wolf = t.pet({ baseDefinitionId: t.h.wolfId, companionOf: t.miraId });
    expect(wolf).toMatchObject({
      kind: "monster",
      name: "Wolf",
      companionOf: t.miraId,
      ownerPlayerId: t.h.p1.id,
      turnMode: "after-owner",
      derivedFromId: t.h.wolfId,
      hpCurrent: 11,
    });
    if (wolf.kind !== "monster") throw new Error("monster");
    expect(wolf.statBlock.attacks.every((a) => a.id !== undefined)).toBe(true);
    // Name taken → "Wolf (Mira)", then " 2".
    expect(t.pet({ baseDefinitionId: t.h.wolfId, companionOf: t.miraId }).name).toBe("Wolf (Mira)");
    // Mira now has 3 (Owlbear + 2 wolves): a 4th → conflict.
    const e = t.err(() => t.pet({ baseDefinitionId: t.h.wolfId, companionOf: t.miraId }));
    expect([e.code, e.message]).toEqual(["conflict", "Mira already has 3 pets"]);
    expect(t.pet({ baseDefinitionId: t.h.wolfId, companionOf: t.thornId }).name).toBe(
      "Wolf (Thorn)",
    );
    // A character base → invalid; companionOf a monster → invalid.
    expect(t.err(() => t.pet({ baseDefinitionId: t.thornId, companionOf: t.miraId })).code).toBe(
      "invalid",
    );
    expect(t.err(() => t.pet({ baseDefinitionId: t.base, companionOf: t.base })).code).toBe(
      "invalid",
    );
    // REST: DM 201; no DM secret → 401.
    const app = createApp(t.s);
    const body = JSON.stringify({ baseDefinitionId: t.base, companionOf: t.thornId, name: "Hoot" });
    const no = await app.request("/api/pets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(no.status).toBe(401);
    const ok = await app.request("/api/pets", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}`, "content-type": "application/json" },
      body,
    });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { entity: { name: string } }).entity.name).toBe("Hoot");
  });

  test("FR-ENT-33 release", () => {
    const t = cpSetup();
    const pet = t.entityRow(t.owlbear);
    if (pet.kind !== "monster") throw new Error("monster");
    const put = (companionOf: string | null) =>
      t.run("entities.update", {
        id: t.owlbear,
        name: pet.name,
        statBlock: pet.statBlock,
        companionOf,
        turnMode: pet.turnMode,
      });
    // In a fight → conflict.
    const e = t.err(() => put(null));
    expect([e.code, e.message]).toEqual(["conflict", "Dismiss it from the fight first"]);
    t.endEncounter();
    put(null);
    expect(t.entityRow(t.owlbear)).toMatchObject({
      companionOf: null,
      ownerPlayerId: null,
      turnMode: null,
      hpCurrent: null,
      petPresent: false,
    });
    expect(t.tokenRow(t.petTokens.owlbear).ownerPlayerId).toBeNull();
    // A character with companionOf → invalid.
    const mira = t.entityRow(t.miraId);
    if (mira.kind !== "character") throw new Error("character");
    const bad = t.err(() =>
      t.run("entities.update", {
        id: t.miraId,
        name: mira.name,
        statBlock: mira.statBlock,
        ownerPlayerId: mira.ownerPlayerId,
        companionOf: t.thornId,
      }),
    );
    expect(bad.code).toBe("invalid");
  });
});

describe("FR-ENT-34 owner copies", () => {
  test("FR-ENT-34 owner change rewrites copies", () => {
    const t = cpSetup();
    // Goblin 2: Mira's companion in the fight (its token is bound).
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: t.owner(t.miraId) });
    const mira = t.entityRow(t.miraId);
    if (mira.kind !== "character") throw new Error("character");
    const n = t.events.length;
    t.run("entities.update", {
      id: t.miraId,
      name: mira.name,
      statBlock: mira.statBlock,
      ownerPlayerId: t.h.p2.id,
    });
    const ev = t.events.slice(n).find((e) => e.event.type === "EntityUpdated")?.event;
    const listed = (type: string) =>
      ev?.changes.filter((c) => c.type === type).map((c) => c.id) ?? [];
    expect(listed(ENTITY_TYPE)).toContain(t.owlbear);
    expect(listed(COMBATANT_TYPE)).toEqual(
      expect.arrayContaining([t.id("Owlbear"), t.id("Goblin 2")]),
    );
    expect(listed(TOKEN_TYPE)).toEqual(
      expect.arrayContaining([t.petTokens.owlbear, t.tokens.goblin2]),
    );
    expect(t.entityRow(t.owlbear).ownerPlayerId).toBe(t.h.p2.id);
    expect(t.combatantNamed("Owlbear").ownerPlayerId).toBe(t.h.p2.id);
    expect(t.combatantNamed("Goblin 2").ownerPlayerId).toBe(t.h.p2.id);
    expect(t.tokenRow(t.petTokens.owlbear).ownerPlayerId).toBe(t.h.p2.id);
    expect(t.tokenRow(t.tokens.goblin2).ownerPlayerId).toBe(t.h.p2.id);
    // player-2 can now move the Owlbear; player-1 can't. player-1 gets the redacted pet.
    t.run(MAP_INTENTS.moveToken, { tokenId: t.petTokens.owlbear, col: 0, row: 5 }, t.p2);
    expect(
      t.err(() =>
        t.run(MAP_INTENTS.moveToken, { tokenId: t.petTokens.owlbear, col: 0, row: 4 }, t.p1),
      ).code,
    ).toBe("forbidden");
    expect(Object.keys(t.playerEntity(t.p1V, t.owlbear) ?? {})).toContain("band");
    expect(Object.keys(t.playerEntity(t.p2V, t.owlbear) ?? {})).toContain("statBlock");
    expect(t.playerCombatant(t.p2V, t.id("Owlbear"))).toHaveProperty("card");
    expect(t.playerCombatant(t.p1V, t.id("Owlbear"))).not.toHaveProperty("card");
  });
});

describe("FR-ENT-37 visibility and presence", () => {
  const view = (t: ReturnType<typeof cpSetup>, v: Viewer, id: string) =>
    t.playerEntity(v, id) as Record<string, unknown> | undefined;

  test("FR-ENT-37 pet visibility", () => {
    const t = cpSetup({ start: false });
    const own = view(t, t.p1V, t.owlbear);
    expect(own).toMatchObject({ kind: "monster", hpCurrent: 59, turnMode: "after-owner" });
    expect(Object.keys(own ?? {})).not.toContain("derivedFromId");
    expect(Object.keys(own ?? {})).not.toContain("petPresent");
    // Other players: the whitelist only, band at 59, 29, 0.
    const band = () => view(t, t.p2V, t.owlbear)?.band;
    expect(RedactedPet.parse(view(t, t.p2V, t.owlbear))).toBeTruthy();
    expect(band()).toBe("healthy");
    t.s.db.update(entity).set({ hpCurrent: 29 }).where(eq(entity.id, t.owlbear)).run();
    expect(band()).toBe("bloodied");
    t.s.db.update(entity).set({ hpCurrent: 0 }).where(eq(entity.id, t.owlbear)).run();
    expect(band()).toBe("down");
    const json = JSON.stringify(view(t, t.p2V, t.owlbear));
    for (const leak of ["statBlock", "hpCurrent", "turnMode", "derivedFromId", "petPresent"]) {
      expect(json).not.toContain(leak);
    }
    // DM full.
    const dm = (t.snap(t.dmV, ENTITY_TYPE) as Record<string, unknown>[]).find(
      (e) => e.id === t.owlbear,
    );
    expect(dm).toMatchObject({ petPresent: true, derivedFromId: t.base });
  });

  test("FR-ENT-37 pet presence", () => {
    const t = cpSetup({ start: false });
    const hawk = t.pet({ baseDefinitionId: t.h.wolfId, companionOf: t.miraId, name: "Hawk" }).id;
    const n0 = t.events.length;
    // New, no token: player-2 gets nothing; never the prepared name.
    expect(view(t, t.p2V, hawk)).toBeUndefined();
    expect(t.framesSince(n0, t.p2V)).not.toContain("Hawk");
    const last = (v: Viewer) =>
      t
        .wire(t.lastEvent()?.changes ?? [], v)
        .filter((w) => typeof w !== "string" && w.type === ENTITY_TYPE && w.id === hawk);
    // Its token placed on the active scene → upsert.
    const tok = t.run<{ tokenId: string }>(MAP_INTENTS.placeToken, {
      sceneId: t.sceneId,
      definitionId: hawk,
      col: 6,
      row: 6,
    }).tokenId;
    expect(last(t.p2V)).toMatchObject([{ op: "upsert" }]);
    // Hidden → delete; revealed → upsert.
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: tok, hidden: true });
    expect(last(t.p2V)).toMatchObject([{ op: "delete" }]);
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: tok, hidden: false });
    expect(last(t.p2V)).toMatchObject([{ op: "upsert" }]);
    // Scene switched away → delete.
    const other = t.run<{ id: string }>(createScene.name, {
      name: "Elsewhere",
      mapAssetId: "map-town",
    });
    t.run(MAP_INTENTS.activateScene, { sceneId: other.id });
    expect(last(t.p2V)).toMatchObject([{ op: "delete" }]);
    // Joins a fight token-less (its token is on the inactive scene) → upsert; End → delete.
    t.run(MAP_INTENTS.deleteToken, { tokenId: tok });
    t.run("cbt.start", { encounterId: t.enc.id, sceneId: t.sceneId, petIds: [hawk] });
    expect(t.entityRow(hawk)).toMatchObject({ petPresent: true });
    expect(view(t, t.p2V, hawk)).toMatchObject({ name: "Hawk" });
    t.endEncounter();
    expect(last(t.p2V)).toMatchObject([{ op: "delete" }]);
    expect(view(t, t.p2V, hawk)).toBeUndefined();
    // The owner had it all along.
    expect(view(t, t.p1V, hawk)).toMatchObject({ name: "Hawk" });
  });

  test("FR-ENT-37 BL-114 a pet hidden in a fight: other players get its delete and no snapshot row; back on show; owner and DM unchanged", () => {
    const t = cpSetup();
    const n0 = t.events.length;
    const last = (v: Viewer) =>
      t
        .wire(t.lastEvent()?.changes ?? [], v)
        .filter((w) => typeof w !== "string" && w.type === ENTITY_TYPE && w.id === t.owlbear);
    expect(view(t, t.p2V, t.owlbear)).toMatchObject({ name: "Owlbear", band: "healthy" });
    // The DM hides the Owlbear's token (its combatant follows, FR-CBT-24): a delete for player 2.
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.petTokens.owlbear, hidden: true });
    expect(t.combatantNamed("Owlbear").hidden).toBe(true);
    expect(last(t.p2V)).toMatchObject([{ op: "delete" }]);
    expect(view(t, t.p2V, t.owlbear)).toBeUndefined();
    expect(t.framesSince(n0, t.p2V)).not.toContain("Owlbear");
    // Owner: full row, unchanged; DM: full row (petPresent false while hidden).
    expect(last(t.p1V)).toEqual([]);
    expect(view(t, t.p1V, t.owlbear)).toMatchObject({ name: "Owlbear", hpCurrent: 59 });
    expect(t.entityRow(t.owlbear)).toMatchObject({ petPresent: false });
    // A turn step while hidden never brings it back.
    t.step("next");
    expect(view(t, t.p2V, t.owlbear)).toBeUndefined();
    // Shown → upsert of the redacted row, as before.
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.petTokens.owlbear, hidden: false });
    expect(last(t.p2V)).toMatchObject([{ op: "upsert" }]);
    expect(RedactedPet.parse(view(t, t.p2V, t.owlbear))).toMatchObject({ band: "healthy" });
    expect(t.entityRow(t.owlbear)).toMatchObject({ petPresent: true });
  });
});

describe("FR-ENT-38 owner edits own pet", () => {
  test("FR-ENT-38 owner edits own pet", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const pet = t.entityRow(t.owlbear);
    if (pet.kind !== "monster") throw new Error("monster");
    const claws = pet.statBlock.attacks.find((a) => a.name === "Claws");
    const n = t.events.length;
    t.run("char.edit", { creatureId: t.owlbear, set: { ac: 14 } }, t.p1);
    t.run(
      "char.putRow",
      { creatureId: t.owlbear, list: "attacks", row: { ...(claws as object), toHit: 8 } },
      t.p1,
    );
    const evs = t.events.slice(n).map((e) => e.event);
    expect(evs.map((e) => e.type)).toEqual(["CharacterSheetEdited", "CharacterSheetEdited"]);
    // The active combatant's card is refreshed in the same events.
    expect(evs.every((e) => e.changes.some((c) => c.type === COMBATANT_TYPE && c.id === ob))).toBe(
      true,
    );
    expect(t.combatantRow(ob).card).toMatchObject({ ac: 14 });
    expect(t.combatantRow(ob).card?.attacks.find((a) => a.name === "Claws")?.toHit).toBe(8);
    // HP max 59 → 40 at 45 kept HP → 40.
    t.s.db.update(entity).set({ hpCurrent: 45 }).where(eq(entity.id, t.owlbear)).run();
    t.run("char.edit", { creatureId: t.owlbear, set: { hpMax: 40 } }, t.p1);
    expect(t.entityRow(t.owlbear).hpCurrent).toBe(40);
    // A 9th attack row → conflict.
    for (let i = 0; i < 6; i++) {
      t.run(
        "char.putRow",
        { creatureId: t.owlbear, list: "attacks", row: { name: `X${i}`, toHit: 1, damage: "1d4" } },
        t.p1,
      );
    }
    const full = t.err(() =>
      t.run(
        "char.putRow",
        { creatureId: t.owlbear, list: "attacks", row: { name: "X9", toHit: 1, damage: "1d4" } },
        t.p1,
      ),
    );
    expect(full.code).toBe("conflict");
    // Other fields → forbidden; another player → forbidden; a summon's definition → not_found.
    for (const set of [
      { name: "Hooty" },
      { abilities: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } },
    ]) {
      expect(t.err(() => t.run("char.edit", { creatureId: t.owlbear, set }, t.p1)).code).toBe(
        "forbidden",
      );
    }
    expect(
      t.err(() => t.run("char.edit", { creatureId: t.owlbear, set: { ac: 9 } }, t.p2)).code,
    ).toBe("forbidden");
    expect(
      t.err(() => t.run("char.edit", { creatureId: t.h.goblinId, set: { ac: 9 } }, t.p1)).code,
    ).toBe("not_found");
    // player-2's frames: the redacted row only, no AC or attack values.
    const p2 = t.framesSince(n, t.p2V);
    for (const leak of ['"ac"', "Claws", '"toHit"']) expect(p2).not.toContain(leak);
  });

  test("FR-CHARX-70 pet NPC sheet DM-only", () => {
    const t = cpSetup({ start: false });
    // An owner's attack-row write creates the pet's sheet row: its owner copy stays null.
    t.run(
      "char.putRow",
      { creatureId: t.owlbear, list: "attacks", row: { name: "Hug", toHit: 7, damage: "2d6" } },
      t.p1,
    );
    const sheet = t.s.db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, t.owlbear))
      .get();
    expect(sheet?.ownerPlayerId).toBeNull();
    expect(t.snap(t.p1V, "creature-sheet").map((r) => (r as { id: string }).id)).not.toContain(
      t.owlbear,
    );
  });
});

describe("FR-MAP-74 / -78 / -79 map seams", () => {
  test("FR-MAP-74 owner default", () => {
    const t = cpSetup({ start: false });
    // Placing a pet's token: owned by the pet's player; an explicit owner still wins.
    expect(t.tokenRow(t.petTokens.owlbear).ownerPlayerId).toBe(t.h.p1.id);
    const tok = t.run<{ tokenId: string }>(MAP_INTENTS.placeToken, {
      sceneId: t.sceneId,
      definitionId: t.owlbear,
      col: 8,
      row: 2,
      ownerPlayerId: null,
    }).tokenId;
    expect(t.tokenRow(tok).ownerPlayerId).toBeNull();
    // Duplicate copies the owner.
    const dup = t.run<{ tokenId: string }>(MAP_INTENTS.duplicateToken, {
      tokenId: t.petTokens.owlbear,
    }).tokenId;
    expect(t.tokenRow(dup).ownerPlayerId).toBe(t.h.p1.id);
  });

  test("FR-MAP-78 companion is a vision source", () => {
    const t = cpSetup({ start: false });
    // player-1: Mira's token and the Owlbear's; PC first, then companions by seq.
    const order = (pid: string) =>
      (sceneSources(t.s.db, t.sceneId, [t.h.p1.id, t.h.p2.id]).get(pid) ?? []).map(
        (s) => s.tokenId,
      );
    expect(order(t.h.p1.id)).toEqual([t.tokens.mira, t.petTokens.owlbear]);
    // Four more owned non-PC tokens placed before... the PC still sees: cap 4 keeps Mira first.
    for (let i = 0; i < 4; i++) {
      t.run(MAP_INTENTS.placeToken, {
        sceneId: t.sceneId,
        definitionId: t.owlbear,
        col: 6 + i,
        row: 1,
      });
    }
    const four = order(t.h.p1.id);
    expect(four).toHaveLength(4);
    expect(four[0]).toBe(t.tokens.mira);
  });

  test("FR-MAP-79 summon token deleted", () => {
    const t = summonSetup();
    const [fe] = t.summon();
    const feToken = t.combatantRow(fe as string).tokenId as string;
    const n = t.events.length;
    t.endEncounter();
    // `deleteTokenIn` ran in End's transaction after the combatant went inactive: no conflict,
    // the token delete rides on `EncounterEnded`, players get it, the FK clears `tokenId`.
    const ended = t.events.slice(n).find((e) => e.event.type === "EncounterEnded")?.event;
    const del = ended?.changes.find((c) => c.type === TOKEN_TYPE && c.id === feToken);
    expect(del?.after).toBeNull();
    expect(t.wire(del ? [del] : [], t.p2V)).toEqual([
      { type: TOKEN_TYPE, id: feToken, op: "delete" },
    ]);
    expect(t.combatantRow(fe as string).tokenId).toBeNull();
    // The pet's token stays.
    expect(t.tokenRow(t.petTokens.owlbear).id).toBe(t.petTokens.owlbear);
  });
});
