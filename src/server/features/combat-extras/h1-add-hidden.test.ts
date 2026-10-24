// Sprint 10, H1 (BL-97, sim-13 glitch 1): Add… with "Add hidden" ticked binds a free *visible*
// token of the creature: the combatant joins hidden and the token is hidden as `map.setTokenHidden`
// hides it, so no player frame (add, the next hit line, snapshot) ever names the creature.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { token } from "../../db/schema";
import { placeToken } from "../scenes-map/commands";
import { cbtxSetup } from "./testing";

const NAME = "Elite Goblin Warrior 2";

function setup() {
  const t = cbtxSetup();
  // sim-13 h05: a second Elite placed visible on the battlemap before Add….
  const elite2 = t.run<{ tokenId: string }>(placeToken.name, {
    sceneId: t.sceneId,
    definitionId: t.eliteId,
    col: 18,
    row: 8,
  }).tokenId;
  const tok = () =>
    t.s.db.select().from(token).where(eq(token.id, elite2)).get() as unknown as TokenRecord;
  const players = [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)];
  /** What each player's socket gets for the events since `n` (hub filter). */
  const wire = (v: (typeof players)[number], n: number) =>
    t.events
      .slice(n)
      .flatMap((e) => e.event.changes)
      .map((c) => t.s.records.filterChange(c, v))
      .filter(Boolean);
  const add = (input: Record<string, unknown>) =>
    t.run<{ combatantIds: string[] }>(CBTX_INTENTS.addCombatants, {
      encounterId: t.enc.id,
      ...input,
    });
  return { ...t, elite2, tok, players, wire, add };
}

describe("BL-97 FR-CBTX-44 Add hidden binds a visible token", () => {
  test("FR-CBTX-44 Add hidden binding a free visible token → combatant hidden, token hidden (one event, token row first)", () => {
    const t = setup();
    expect(t.tok().hidden).toBe(false);
    const n = t.events.length;
    const { combatantIds } = t.add({
      items: [{ definitionId: t.eliteId }],
      createTokens: true,
      hidden: true,
    });
    const c = t.combatants(t.enc.id).find((x) => x.id === combatantIds[0]) as CombatantRecord;
    expect([c.name, c.tokenId, c.hidden, c.playerPosition]).toEqual([NAME, t.elite2, true, null]);
    expect(t.tok().hidden).toBe(true);
    expect(t.typesSince(n)).toEqual(["CombatantsAdded"]);
    const types = (t.events.at(-1)?.event.changes ?? []).map((x) => x.type);
    expect(types[0]).toBe(TOKEN_TYPE);
    expect(types.indexOf(TOKEN_TYPE)).toBeLessThan(types.indexOf(COMBATANT_TYPE));
  });

  test("FR-CBTX-44 hidden add never reaches players: token delete only, then the hit line never names it (per player, snapshot)", () => {
    const t = setup();
    const n = t.events.length;
    const { combatantIds } = t.add({
      items: [{ definitionId: t.eliteId }],
      createTokens: true,
      hidden: true,
    });
    const cid = combatantIds[0] as string;
    for (const v of t.players) {
      const sent = t.wire(v, n);
      // At most the token they saw goes away (FR-MAP-19's hide; over WS: h1-add-hidden.sync).
      expect(sent.every((w) => w?.type !== TOKEN_TYPE || w.op === "delete")).toBe(true);
      const raw = JSON.stringify(sent);
      expect(raw).not.toContain(cid);
      expect(raw).not.toContain(NAME);
    }
    // sim-13 h06: Thorn's next hit on it.
    const m = t.events.length;
    t.attackApply("Thorn", [NAME], 3);
    for (const v of t.players) {
      const raw = JSON.stringify(t.wire(v, m));
      expect(raw).not.toContain(NAME);
      expect(raw).not.toContain(cid);
      const snap = JSON.stringify(t.h.snapshot(v));
      expect(snap).not.toContain(NAME);
      expect(snap).not.toContain(cid);
      expect(snap).not.toContain(t.elite2);
    }
  });

  test("FR-CBTX-44 hidden absent or false → a bound visible token keeps its flag (token menu Add to combat unchanged)", () => {
    const t = setup();
    const { combatantIds } = t.add({ items: [{ definitionId: t.eliteId }], createTokens: true });
    const c = t.combatants(t.enc.id).find((x) => x.id === combatantIds[0]) as CombatantRecord;
    expect([c.tokenId, c.hidden]).toEqual([t.elite2, false]);
    expect(t.tok().hidden).toBe(false);
  });
});
