// FR-ENT-27 (ADR-0050): token `creatureType` — set at placement from the monster's
// `statBlock.type`, copied by duplicate, set by the DM's `map.updateToken`, token-owned after,
// except the one fill when a definition first gains a type (null tokens only, review B7).
import { describe, expect, test } from "bun:test";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { MAP_REST as R } from "../scenes-map/commands";
import { scenesSetup } from "../scenes-map/testing";
import { CREATE, UPDATE } from "./commands";
import { definitionHooksOf } from "./definition-hooks";
import { captureLogger, goblinBlock } from "./testing";

function setup() {
  const t = scenesSetup(captureLogger().log);
  const scene = t.run<SceneRecord>(R.createScene, { name: "Lair", mapAssetId: "map-battle" });
  t.run(FOG_INTENTS.setAll, { sceneId: scene.id, fogged: false }); // FR-FOG-25 ripple
  const row = (id: string) =>
    t.s.db.select().from(token).where(eq(token.id, id)).get() as TokenRecord;
  const place = (definitionId: string, col: number, row_: number) =>
    row(
      t.run<{ tokenId: string }>(I.placeToken, { sceneId: scene.id, definitionId, col, row: row_ })
        .tokenId,
    );
  const monster = (name: string, extra: object = {}) =>
    t.run<{ id: string }>(CREATE, {
      kind: "monster",
      name,
      statBlock: { ...goblinBlock, ...extra },
    }).id;
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, scene, row, place, monster, lastEvent };
}

describe("FR-ENT-27 token creature type", () => {
  test("FR-ENT-27 art per creature type: place copies statBlock.type (characters null); duplicate copies it; a later type change doesn't propagate", () => {
    const t = setup();
    const ogreId = t.monster("Cave Ogre", { size: "large", type: "giant" });
    const derivedId = t.run<{ id: string }>(CREATE, {
      kind: "monster",
      name: "Elite Cave Ogre",
      derivedFromId: ogreId,
      statBlock: { ...goblinBlock, size: "large", type: "giant", ac: 16 },
    }).id;
    expect(t.place(ogreId, 1, 1).creatureType).toBe("giant");
    expect(t.place(derivedId, 4, 1).creatureType).toBe("giant");
    expect(t.place(t.miraId, 7, 1).creatureType).toBeNull();
    // Imported definitions without a type (stored before S4): null.
    const gob = t.place(t.h.goblinId, 9, 1);
    expect(gob.creatureType).toBeNull();
    expect(t.lastEvent()?.changes[0]?.after).toMatchObject({ creatureType: null });

    const humanoid = t.monster("Cultist", { type: "humanoid" });
    const a = t.place(humanoid, 1, 5);
    t.run(I.updateToken, { tokenId: a.id, creatureType: "initials" });
    const dup = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: a.id });
    expect(t.row(dup.tokenId).creatureType).toBe("initials");
    const b = t.place(humanoid, 5, 5);
    const dupB = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: b.id });
    expect(t.row(dupB.tokenId).creatureType).toBe("humanoid");
    // FR-MAP-04: a scene copy keeps every token's creatureType.
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.scene.id });
    const copied = t.s.db.select().from(token).where(eq(token.sceneId, copy.id)).all();
    expect(copied.filter((r) => r.creatureType === "initials")).toHaveLength(2);

    // humanoid → fiend: placed tokens keep theirs; no token in the event (token-owned).
    t.run(UPDATE, { id: humanoid, name: "Cultist", statBlock: { ...goblinBlock, type: "fiend" } });
    expect(t.row(b.id).creatureType).toBe("humanoid");
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["entity"]);
    expect(t.place(humanoid, 9, 5).creatureType).toBe("fiend");
  });

  test("FR-ENT-27 map.updateToken {creatureType}: type or initials stored, TokenUpdated logged; null → invalid; player → forbidden", () => {
    const t = setup();
    const g = t.place(t.monster("Ogre", { size: "large", type: "giant" }), 1, 1);
    const n = readEventLog(t.s.db).length;
    t.run(I.updateToken, { tokenId: g.id, creatureType: "initials" });
    expect(t.row(g.id)).toMatchObject({ creatureType: "initials", name: "Ogre", shape: "round" });
    expect(t.lastEvent()?.type).toBe("TokenUpdated");
    expect(t.lastEvent()?.changes[0]?.after).toMatchObject({ creatureType: "initials" });
    t.run(I.updateToken, { tokenId: g.id, creatureType: "giant" });
    expect(t.row(g.id).creatureType).toBe("giant");
    expect(
      readEventLog(t.s.db)
        .slice(n)
        .map((l) => l.type),
    ).toEqual(["TokenUpdated", "TokenUpdated"]);
    const bad = (creatureType: unknown) =>
      t.err(() => t.run(I.updateToken, { tokenId: g.id, creatureType })).code;
    expect(bad(null)).toBe("invalid");
    expect(bad("swarm")).toBe("invalid");
    expect(bad("Giant")).toBe("invalid");
    expect(
      t.err(() =>
        t.run(I.updateToken, { tokenId: g.id, creatureType: "initials" }, t.player(t.h.p1)),
      ).code,
    ).toBe("forbidden");
    // Placement never takes it (FR-MAP-13): not even fixtures.
    expect(
      t.err(() =>
        t.run(I.placeToken, {
          sceneId: t.scene.id,
          definitionId: t.h.wolfId,
          col: 5,
          row: 5,
          creatureType: "beast",
        }),
      ).code,
    ).toBe("invalid");
    expect(t.row(g.id).creatureType).toBe("giant");
  });

  test("FR-ENT-27 fill: a definition gaining a type fills its null tokens in the same commit (listed in EntityUpdated.changes); Initials kept and not listed", () => {
    const t = setup();
    const brute = t.monster("Plain Brute");
    const plain = t.place(brute, 1, 1);
    const initials = t.place(brute, 3, 1);
    t.run(I.updateToken, { tokenId: initials.id, creatureType: "initials" });
    const other = t.place(t.monster("Bystander"), 5, 1);
    const n = readEventLog(t.s.db).length;
    t.run(UPDATE, { id: brute, name: "Plain Brute", statBlock: { ...goblinBlock, type: "fiend" } });
    expect(t.row(plain.id).creatureType).toBe("fiend");
    expect(t.row(initials.id).creatureType).toBe("initials");
    expect(t.row(other.id).creatureType).toBeNull();
    const ev = t.lastEvent();
    expect(ev?.type).toBe("EntityUpdated");
    const tokens = ev?.changes.filter((c) => c.type === TOKEN_TYPE) ?? [];
    expect(tokens.map((c) => c.id)).toEqual([plain.id]);
    expect(tokens[0]?.before).toMatchObject({ creatureType: null });
    expect(tokens[0]?.after).toMatchObject({ creatureType: "fiend" });
    // One commit: one log row (the update), the fill inside it.
    const log = readEventLog(t.s.db).slice(n);
    expect(log.map((l) => l.type)).toEqual(["EntityUpdated"]);
    // fiend → undead: no fill (the type wasn't absent); tokens keep fiend.
    t.run(UPDATE, {
      id: brute,
      name: "Plain Brute",
      statBlock: { ...goblinBlock, type: "undead" },
    });
    expect(t.row(plain.id).creatureType).toBe("fiend");
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["entity"]);
    // Type removed, then added back: the null tokens of that moment fill again (only nulls).
    t.run(UPDATE, { id: brute, name: "Plain Brute", statBlock: goblinBlock });
    const late = t.place(brute, 7, 1);
    expect(late.creatureType).toBeNull();
    t.run(UPDATE, { id: brute, name: "Plain Brute", statBlock: { ...goblinBlock, type: "ooze" } });
    expect([plain, initials, late].map((x) => t.row(x.id).creatureType)).toEqual([
      "fiend",
      "initials",
      "ooze",
    ]);
  });

  test("FR-ENT-27 fill rolls back with its update: a throwing later hook leaves tokens null", () => {
    const t = setup();
    const brute = t.monster("Plain Brute");
    const plain = t.place(brute, 1, 1);
    definitionHooksOf(t.s).register("test.throw", () => {
      throw new Error("boom");
    });
    expect(
      t.err(() =>
        t.run(UPDATE, {
          id: brute,
          name: "Plain Brute",
          statBlock: { ...goblinBlock, type: "beast" },
        }),
      ).code,
    ).toBe("internal");
    expect(t.row(plain.id).creatureType).toBeNull();
  });
});
