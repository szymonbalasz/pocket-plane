// `cbtx.addCombatants` in-process (FR-CBTX-26/27): token / character / definition items,
// binding, numbering, ranks, all-or-nothing, initiative rolled once (FR-CBT-46/47), `added` hook.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { rollInitiative } from "../combat-tracker/initiative";
import { createEntity } from "../entities/commands";
import { thornBlock } from "../entities/testing";
import { placeToken } from "../scenes-map/commands";
import { cbtxSetup } from "./testing";

const ADD = CBTX_INTENTS.addCombatants;

function reinforced() {
  const t = cbtxSetup();
  const place = (definitionId: string, col: number, row: number, hidden = false) =>
    t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: t.sceneId,
      definitionId,
      col,
      row,
      hidden,
    }).tokenId;
  const goblin3 = place(t.h.goblinId, 14, 8);
  const wolf2 = place(t.h.wolfId, 15, 3, true);
  const add = (items: unknown[]) =>
    t.run<{ combatantIds: string[] }>(ADD, { encounterId: t.enc.id, items });
  return { ...t, goblin3, wolf2, add };
}

describe("FR-CBTX-26 FR-CBTX-27 add combatants mid-fight", () => {
  test("FR-CBTX-27 tokens bind with their name / hidden flag; initiative null sorts last; ranks rewritten", () => {
    const t = reinforced();
    const n = t.events.length;
    const { combatantIds } = t.add([{ tokenId: t.goblin3 }, { tokenId: t.wolf2 }]);
    expect(t.typesSince(n)).toEqual(["CombatantsAdded"]);
    expect(t.events.at(-1)?.event.payload).toEqual({ encounterId: t.enc.id, combatantIds });
    const rows = t.byName(t.enc.id);
    expect(rows["Goblin 3"]).toMatchObject({
      kind: "monster",
      tokenId: t.goblin3,
      hidden: false,
      initiative: null,
      hpCurrent: 7,
      hpMax: 7,
      tempHp: 0,
      position: 7,
      playerPosition: 5,
    });
    expect(rows["Wolf 2"]).toMatchObject({ hidden: true, position: 8, playerPosition: null });
    // FR-CBT-46/47: rolled once from round 1, then refused.
    t.run(rollInitiative.name, { combatantIds: [combatantIds[0]], manual: { diceTotal: 10 } });
    expect(t.byName(t.enc.id)["Goblin 3"]?.initiative).toBe(12);
    const again = t.err(() => t.run(rollInitiative.name, { combatantIds: [combatantIds[0]] }));
    expect(again.code).toBe("conflict");
  });

  test("FR-CBTX-27 definition items take the next unbound token, else token-less numbered", () => {
    const t = reinforced();
    const { combatantIds } = t.add([
      { definitionId: t.h.goblinId },
      { definitionId: t.h.goblinId },
    ]);
    const added = t.combatants(t.enc.id).filter((c) => combatantIds.includes(c.id));
    expect(added.map((c) => [c.name, c.tokenId])).toEqual([
      ["Goblin 3", t.goblin3],
      ["Goblin 4", null],
    ]);
  });

  test("FR-CBTX-26 characters: a PC already in combat → conflict; a new one joins; all or nothing", () => {
    const t = reinforced();
    const before = t.combatants(t.enc.id).length;
    const dup = t.err(() => t.add([{ tokenId: t.goblin3 }, { characterId: t.miraId }]));
    expect([dup.code, dup.message]).toEqual(["conflict", "Mira is already in combat"]);
    expect(t.combatants(t.enc.id).length).toBe(before);
    const bram = t.run<{ id: string }>(createEntity.name, {
      kind: "character",
      name: "Bram",
      ownerPlayerId: t.h.p1.id,
      statBlock: thornBlock,
    });
    const { combatantIds } = t.add([{ characterId: bram.id }]);
    expect(t.combatants(t.enc.id).find((c) => c.id === combatantIds[0])).toMatchObject({
      kind: "pc",
      entityId: bram.id,
      tokenId: null,
      hpCurrent: null,
    });
    expect(t.err(() => t.add([{ characterId: bram.id }])).code).toBe("conflict");
    // A bound token can't join twice; an unknown token → not_found.
    t.add([{ tokenId: t.goblin3 }]);
    expect(t.err(() => t.add([{ tokenId: t.goblin3 }])).code).toBe("conflict");
    expect(t.err(() => t.add([{ tokenId: "nope" }])).code).toBe("not_found");
  });

  test("FR-CBTX-26 not started → conflict; players forbidden; > 56 combatants → conflict", () => {
    const t = reinforced();
    expect(
      t.err(() => t.run(ADD, { encounterId: t.enc.id, items: [{ tokenId: t.goblin3 }] }, t.p1))
        .code,
    ).toBe("forbidden");
    const many = Array.from({ length: 20 }, () => ({ definitionId: t.h.goblinId }));
    t.add(many);
    t.add(many);
    expect(t.err(() => t.add(many)).code).toBe("conflict");
    t.endEncounter();
    expect(t.err(() => t.add([{ tokenId: t.goblin3 }])).code).toBe("conflict");
  });

  test("FR-CBTX-13 added hook: a hidden PC token copies onto the character's effects", () => {
    const t = reinforced();
    const bram = t.run<{ id: string }>(createEntity.name, {
      kind: "character",
      name: "Bram",
      ownerPlayerId: t.h.p1.id,
      statBlock: thornBlock,
    });
    const [marked] = t.run<{ effectIds: string[] }>(CBTX_INTENTS.addEffect, {
      targets: [{ characterId: bram.id }],
      kind: "custom",
      label: "Marked",
    }).effectIds as [string];
    const tok = t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: t.sceneId,
      definitionId: bram.id,
      col: 3,
      row: 3,
      hidden: true,
    }).tokenId;
    const n = t.events.length;
    t.add([{ tokenId: tok }]);
    expect(t.fx(marked).hidden).toBe(true);
    expect(t.events[n]?.event.changes.some((c) => c.id === marked)).toBe(true);
  });
});
