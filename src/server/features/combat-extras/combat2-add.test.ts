// Sprint 2 (fix/combat2-add): the Add dialog's options (FR-CBTX-44) and linking a token to a
// token-less combatant (FR-CBTX-45), in-process on combat-extras' started ambush.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { token } from "../../db/schema";
import { combatRuleHooksOf } from "../combat-tracker/rule-hooks";
import { placeToken } from "../scenes-map/commands";
import { cbtxSetup } from "./testing";

const ADD = CBTX_INTENTS.addCombatants;
const BIND = CBTX_INTENTS.bindToken;

function setup() {
  const t = cbtxSetup();
  // Imported definitions are read-only: Goblin's SRD formula set in the test DB (FR-ENT-25).
  t.s.db.$client.run(
    "update entity set stat_block = json_set(stat_block, '$.hpFormula', '2d6') where id = ?",
    [t.h.goblinId],
  );
  const add = (input: Record<string, unknown>) =>
    t.run<{ combatantIds: string[] }>(ADD, { encounterId: t.enc.id, ...input });
  const sceneTokens = () =>
    t.s.db
      .select()
      .from(token)
      .where(eq(token.sceneId, t.sceneId))
      .all() as unknown as TokenRecord[];
  const row = (id: string) => t.combatants(t.enc.id).find((c) => c.id === id) as CombatantRecord;
  const players = [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)];
  const wire = (v: (typeof players)[number]) =>
    (t.events.at(-1)?.event.changes ?? []).map((c) => t.s.records.filterChange(c, v));
  return { ...t, add, sceneTokens, row, players, wire };
}

describe("FR-CBTX-44 add dialog options", () => {
  test("FR-CBTX-44 add with tokens: Goblin × 2 rolled, hidden, at (12, 6) → two hidden tokens near at, bound; seeded HP + initiative DM-only; ranked; tokens first", () => {
    const t = setup();
    const before = t.sceneTokens().length;
    const { combatantIds } = t.add({
      items: [{ definitionId: t.h.goblinId, quantity: 2, hpMode: "rolled" }],
      createTokens: true,
      hidden: true,
      at: { col: 12, row: 6 },
    });
    const made = t.sceneTokens().slice(before);
    // (12, 6) holds Goblin: the d = 5 ring by row, then col.
    expect(made.map((x) => [x.name, x.col, x.row, x.hidden])).toEqual([
      ["Goblin 3", 11, 5, true],
      ["Goblin 4", 12, 5, true],
    ]);
    const added = combatantIds.map(t.row);
    expect(added.map((c) => [c.name, c.tokenId, c.hidden])).toEqual([
      ["Goblin 3", made[0]?.id as string, true],
      ["Goblin 4", made[1]?.id as string, true],
    ]);
    for (const c of added) {
      expect(c.initiative).toBeNumber();
      expect(c.hpMax).toBe(c.hpCurrent);
      expect(c.hpMax).toBeGreaterThanOrEqual(2);
      expect(c.hpMax).toBeLessThanOrEqual(12);
    }
    // Ranked at once: positions 1…8 without gaps.
    expect(
      t
        .combatants(t.enc.id)
        .map((c) => c.position)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("CombatantsAdded");
    const types = (ev?.changes ?? []).map((c) => c.type);
    expect(types.slice(0, 2)).toEqual([TOKEN_TYPE, TOKEN_TYPE]);
    expect(types.slice(2, 4)).toEqual([COMBATANT_TYPE, COMBATANT_TYPE]);
    const lines = (ev?.changes ?? [])
      .filter((c) => c.type === GAME_LOG_ENTRY_TYPE)
      .map((c) => c.after as GameLogEntryRecord);
    expect(lines.map((l) => [l.category, l.public])).toEqual([
      ["other", false],
      ["other", false],
      ["initiative", false],
      ["initiative", false],
    ]);
  });

  test("FR-CBTX-44 hidden add never reaches players", () => {
    const t = setup();
    const { combatantIds } = t.add({
      items: [{ definitionId: t.h.goblinId, quantity: 2, hpMode: "rolled" }],
      createTokens: true,
      hidden: true,
    });
    const tokenIds = combatantIds.map((id) => t.row(id).tokenId as string);
    for (const v of t.players) {
      const sent = t.wire(v).filter(Boolean);
      const raw = JSON.stringify(sent);
      for (const id of [...combatantIds, ...tokenIds]) expect(raw).not.toContain(id);
      expect(sent.some((w) => w?.type === GAME_LOG_ENTRY_TYPE)).toBe(false);
      const snap = JSON.stringify(t.h.snapshot(v));
      for (const id of [...combatantIds, ...tokenIds]) expect(snap).not.toContain(id);
    }
  });

  test("FR-CBTX-44 one transaction: a throwing added hook → no token, no combatant, no roll", () => {
    const t = setup();
    combatRuleHooksOf(t.s).register("test.fail", {
      added: () => {
        throw conflict("hook failed");
      },
    });
    const counts = () => [t.sceneTokens().length, t.count("combatant"), t.count("roll")];
    const before = counts();
    const e = t.err(() =>
      t.add({ items: [{ definitionId: t.h.goblinId, quantity: 2 }], createTokens: true }),
    );
    expect(e.code).toBe("conflict");
    expect(counts()).toEqual(before);
  });

  test("FR-CBTX-44 defaults: createTokens absent → token-less; hidden absent → visible created tokens; free placed token binds first and keeps its flag", () => {
    const t = setup();
    const n = t.sceneTokens().length;
    const plain = t.add({ items: [{ definitionId: t.h.goblinId }] });
    expect(t.row(plain.combatantIds[0] as string)).toMatchObject({ tokenId: null, hidden: false });
    expect(t.sceneTokens().length).toBe(n);
    const free = t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: t.sceneId,
      definitionId: t.h.wolfId,
      col: 1,
      row: 1,
      hidden: false,
    }).tokenId;
    const two = t.add({ items: [{ definitionId: t.h.wolfId, quantity: 2 }], createTokens: true });
    const [a, b] = two.combatantIds.map(t.row);
    expect(a).toMatchObject({ tokenId: free, hidden: false });
    expect(b?.tokenId).not.toBeNull();
    expect(b?.hidden).toBe(false);
  });

  test("FR-CBTX-44 encounter scene deleted → createTokens ignored, token-less; rolled without a formula → invalid", () => {
    const t = setup();
    const bad = t.err(() => t.add({ items: [{ definitionId: t.eliteId, hpMode: "rolled" }] }));
    expect([bad.code, bad.message]).toEqual(["invalid", "Elite Goblin Warrior has no HP formula"]);
    expect(t.err(() => t.add({ items: [{ definitionId: t.h.goblinId, quantity: 21 }] })).code).toBe(
      "invalid",
    );
    t.s.db.$client.run("update encounter set scene_id = null where id = ?", [t.enc.id]);
    const n = t.count("token");
    const { combatantIds } = t.add({
      items: [{ definitionId: t.h.goblinId, quantity: 2 }],
      createTokens: true,
      hidden: true,
    });
    expect(t.count("token")).toBe(n);
    expect(combatantIds.map((id) => [t.row(id).tokenId, t.row(id).hidden])).toEqual([
      [null, false],
      [null, false],
    ]);
  });
});

describe("FR-CBTX-45 link a token", () => {
  /** A token-less Goblin 3 (Create tokens off) and a goblin token dropped on the map later. */
  function unlinked() {
    const t = setup();
    const [gid] = t.add({ items: [{ definitionId: t.h.goblinId }] }).combatantIds as [string];
    const dropped = t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: t.sceneId,
      definitionId: t.h.goblinId,
      col: 5,
      row: 5,
    }).tokenId;
    return { ...t, gid, dropped };
  }

  test("FR-CBTX-45 bind token: binds, copies, movedFt 0; a move then counts; wrong creature invalid; bound token conflict", () => {
    const t = unlinked();
    expect(t.row(t.gid)).toMatchObject({ name: "Goblin 3", tokenId: null });
    t.run(BIND, { combatantId: t.gid, tokenId: t.dropped });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("CombatantBound");
    expect(ev?.payload).toEqual({ combatantId: t.gid, tokenId: t.dropped });
    expect(t.row(t.gid)).toMatchObject({ tokenId: t.dropped, name: "Goblin 3", movedFt: 0 });
    t.run(MAP_INTENTS.moveToken, { tokenId: t.dropped, col: 7, row: 5 });
    const moved = t.events.at(-1)?.event;
    expect(moved?.type).toBe("TokenMoved");
    expect(
      moved?.changes.find((c) => c.type === COMBATANT_TYPE && c.id === t.gid)?.after,
    ).toMatchObject({ movedFt: 10 });

    const other = t.add({ items: [{ definitionId: t.h.goblinId }] }).combatantIds[0] as string;
    const wolfTok = t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: t.sceneId,
      definitionId: t.h.wolfId,
      col: 6,
      row: 6,
    }).tokenId;
    const wrong = t.err(() => t.run(BIND, { combatantId: other, tokenId: wolfTok }));
    expect([wrong.code, wrong.message]).toEqual(["invalid", "Token is a different creature"]);
    expect(t.err(() => t.run(BIND, { combatantId: other, tokenId: t.dropped })).code).toBe(
      "conflict",
    );
    // The combatant no longer token-less (second DM tab) → invalid.
    const other2 = t.run<{ tokenId: string }>(placeToken.name, {
      sceneId: t.sceneId,
      definitionId: t.h.goblinId,
      col: 8,
      row: 8,
    }).tokenId;
    expect(t.err(() => t.run(BIND, { combatantId: t.gid, tokenId: other2 })).code).toBe("invalid");
    expect(t.err(() => t.run(BIND, { combatantId: t.gid, tokenId: null }, t.p1)).code).toBe(
      "forbidden",
    );
  });

  test("FR-CBTX-45 unlink: tokenId null, copies kept, token stays, players get the upsert; token-less or inactive → conflict", () => {
    const t = unlinked();
    t.run(MAP_INTENTS.updateToken, { tokenId: t.dropped, name: "Sneaky" });
    t.run(BIND, { combatantId: t.gid, tokenId: t.dropped });
    t.run(BIND, { combatantId: t.gid, tokenId: null });
    expect(t.events.at(-1)?.event.payload).toEqual({ combatantId: t.gid, tokenId: null });
    expect(t.row(t.gid)).toMatchObject({ tokenId: null, name: "Sneaky", hidden: false });
    expect(t.sceneTokens().some((x) => x.id === t.dropped)).toBe(true);
    for (const v of t.players) {
      expect(t.wire(v)).toContainEqual(
        expect.objectContaining({
          type: COMBATANT_TYPE,
          id: t.gid,
          op: "upsert",
          data: expect.objectContaining({ tokenId: null }),
        }),
      );
    }
    const e = t.err(() => t.run(BIND, { combatantId: t.gid, tokenId: null }));
    expect(e.code).toBe("conflict");
    t.endEncounter();
    expect(t.err(() => t.run(BIND, { combatantId: t.gid, tokenId: t.dropped })).code).toBe(
      "conflict",
    );
  });

  test("FR-CBTX-45 hidden token → combatant hidden, players get a delete; ranks rewritten", () => {
    const t = unlinked();
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.dropped, hidden: true });
    expect(t.row(t.gid).playerPosition).toBeNumber();
    t.run(BIND, { combatantId: t.gid, tokenId: t.dropped });
    expect(t.row(t.gid)).toMatchObject({ hidden: true, playerPosition: null });
    for (const v of t.players) {
      expect(t.wire(v)).toContainEqual(
        expect.objectContaining({ type: COMBATANT_TYPE, id: t.gid, op: "delete" }),
      );
    }
  });
});
