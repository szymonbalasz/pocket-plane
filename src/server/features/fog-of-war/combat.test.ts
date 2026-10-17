// FR-FOG-14 (OQ-FOG-07, decided #196): every write of a combatant's or effect's hidden copy uses
// `tokenHiddenForPlayers` (hidden or fog-hidden). One test per copy site: Start binding, Start's
// created tokens, mid-fight Add binding and created tokens, link, the token hook (fog commands,
// moves, the size refresh) and CBTX's effect copy. Each: the fog-hidden monster's combatant /
// effect / log rows reach no player; a reveal shows token + combatant + ranks in one FogEdited.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS as X } from "@shared/combat-extras/intents";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { FOG_INTENTS as F, type FogShape } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { effect, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { createEncounter } from "../combat-tracker/encounters";
import { combatSetup } from "../combat-tracker/testing";
import { createEntity, UPDATE } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { legacySenses } from "./testing";

const START = "cbt.start";
const rect = (c0: number, r0: number, c1: number, r1: number): FogShape => ({
  kind: "rect",
  c0,
  r0,
  c1,
  r1,
});

/** combatSetup (Goblin Ambush revealed, active) + a fog pocket over (15, 0)–(19, 2). */
function setup() {
  const t = combatSetup();
  legacySenses(t.s.db);
  t.run(I.activateScene, { sceneId: t.sceneId });
  const fog = (op: "reveal" | "hide", shape: FogShape) =>
    t.run<{ editId: string | null }>(F.edit, { sceneId: t.sceneId, op, shape }).editId;
  fog("hide", rect(15, 0, 19, 2));
  const viewers = [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)];
  /** Every change of the events emitted by `fn`. */
  const changesOf = (fn: () => void): RecordChange[] => {
    const n = t.events.length;
    fn();
    return t.events.slice(n).flatMap((e) => e.event.changes);
  };
  /** What each player receives of `changes` (wire changes), as JSON. */
  const playerWire = (changes: RecordChange[]) =>
    viewers.map((v) =>
      JSON.stringify(changes.map((c) => t.s.records.filterChange(c, v)).filter(Boolean)),
    );
  const tok = (id: string) =>
    t.s.db.select().from(token).where(eq(token.id, id)).get() as unknown as TokenRecord;
  const place = (definitionId: string, col: number, row: number) =>
    t.run<{ tokenId: string }>(I.placeToken, { sceneId: t.sceneId, definitionId, col, row })
      .tokenId;
  const encounter = (entries: { definitionId: string; quantity: number }[], extra = {}) =>
    t.run<EncounterRecord>(createEncounter.name, {
      name: "Ambush at the Ford",
      partyCharacterIds: [],
      entries,
      createTokens: false,
      addHidden: false,
      ...extra,
    });
  const combatantOfToken = (encounterId: string, tokenId: string) =>
    t.combatants(encounterId).find((c) => c.tokenId === tokenId) as CombatantRecord;
  /** A monster with no token on the map (so nothing binds before a created / linked one). */
  const bat = () =>
    t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Bat",
      statBlock: goblinBlock,
    }).id;
  return { ...t, fog, changesOf, playerWire, tok, place, encounter, combatantOfToken, bat };
}

describe("FR-FOG-14 combat copies of fog-hidden", () => {
  test("FR-FOG-14 Start binding: Goblin 2 fog-hidden → hidden combatant, no player row; reveal → token + combatant + ranks in one FogEdited; back into fog → hidden", () => {
    const t = setup();
    t.fog("hide", rect(12, 8, 12, 8)); // Goblin 2 only
    const enc = t.encounter([{ definitionId: t.h.goblinId, quantity: 2 }]);
    const started = t.changesOf(() => t.run(START, { encounterId: enc.id, sceneId: t.sceneId }));
    const g2 = t.combatantOfToken(enc.id, t.tokens.goblin2);
    const g1 = t.combatantOfToken(enc.id, t.tokens.goblin);
    expect([g1.hidden, g2.hidden]).toEqual([false, true]);
    expect(t.tok(t.tokens.goblin2).hidden).toBe(false); // the token's own flag untouched
    for (const wire of t.playerWire(started)) {
      expect(wire).toContain(g1.id);
      expect(wire).not.toContain(g2.id);
      expect(wire).not.toContain(t.tokens.goblin2);
    }
    // Reveal: the token, its combatant and the encounter's ranks in the one FogEdited.
    const n = t.events.length;
    t.fog("reveal", rect(12, 8, 12, 8));
    expect(t.events.length).toBe(n + 1);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("FogEdited");
    // fog row, the token, then its combatant and the reranked rows (FR-CBT-09).
    const types = ev?.changes.map((c) => c.type) ?? [];
    expect(types.slice(0, 3)).toEqual(["fog", "token", "combatant"]);
    expect(types.slice(3).every((x) => x === "combatant" || x === "encounter")).toBe(true);
    expect(t.combatantOfToken(enc.id, t.tokens.goblin2).hidden).toBe(false);
    for (const v of [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)]) {
      const ops = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v)?.op ?? null);
      expect(ops.slice(1, 3)).toEqual(["upsert", "upsert"]);
    }
    // A move back into fog (the pocket) hides it again, in the TokenMoved.
    const moved = t.changesOf(() =>
      t.run(I.moveToken, { tokenId: t.tokens.goblin2, col: 17, row: 1 }),
    );
    expect(t.combatantOfToken(enc.id, t.tokens.goblin2).hidden).toBe(true);
    for (const v of [t.h.viewer("player", t.h.p1.id)]) {
      const ops = moved.map((c) => [c.type, t.s.records.filterChange(c, v)?.op ?? null]);
      expect(ops).toContainEqual(["token", "delete"]);
      expect(ops).toContainEqual(["combatant", "delete"]);
    }
  });

  test("FR-FOG-14 Start's created tokens at a fogged `at` (addHidden off) → hidden combatants", () => {
    const t = setup();
    const enc = t.encounter([{ definitionId: t.h.goblinId, quantity: 3 }], {
      createTokens: true,
      addHidden: false,
    });
    const started = t.changesOf(() =>
      t.run(START, { encounterId: enc.id, sceneId: t.sceneId, at: { col: 17, row: 1 } }),
    );
    const created = t
      .combatants(enc.id)
      .filter((c) => c.tokenId !== t.tokens.goblin && c.tokenId !== t.tokens.goblin2);
    expect(created).toHaveLength(1);
    const c = created[0] as CombatantRecord;
    const made = t.tok(c.tokenId as string);
    expect([made.hidden, made.fogged, c.hidden]).toEqual([false, true, true]);
    for (const wire of t.playerWire(started)) {
      expect(wire).not.toContain(c.id);
      expect(wire).not.toContain(made.id);
    }
  });

  test("FR-FOG-14 mid-fight Add (hidden unticked): a token in fog binds hidden; created tokens in fog too", () => {
    const t = setup();
    const enc = t.encounter([{ definitionId: t.h.goblinId, quantity: 1 }]);
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    const lurker = t.place(t.h.goblinId, 18, 1);
    const bound = t.changesOf(() =>
      t.run(X.addCombatants, { encounterId: enc.id, items: [{ tokenId: lurker }], hidden: false }),
    );
    const c = t.combatantOfToken(enc.id, lurker);
    expect(c.hidden).toBe(true);
    for (const wire of t.playerWire(bound)) expect(wire).not.toContain(c.id);
    // Created tokens at a fogged `at` (a creature with no free placed token).
    const before = new Set(t.combatants(enc.id).map((x) => x.id));
    const added = t.changesOf(() =>
      t.run(X.addCombatants, {
        encounterId: enc.id,
        items: [{ definitionId: t.bat(), quantity: 2 }],
        createTokens: true,
        hidden: false,
        at: { col: 16, row: 1 },
      }),
    );
    const fresh = t.combatants(enc.id).filter((x) => !before.has(x.id));
    expect(fresh).toHaveLength(2);
    for (const x of fresh) {
      expect(x.hidden).toBe(true);
      expect(t.tok(x.tokenId as string)).toMatchObject({ hidden: false, fogged: true });
    }
    for (const wire of t.playerWire(added)) {
      for (const x of fresh) expect(wire).not.toContain(x.id);
    }
  });

  test("FR-FOG-14 link (cbtx.bindToken): a token in fog → the combatant turns hidden (player delete)", () => {
    const t = setup();
    const enc = t.encounter([{ definitionId: t.h.goblinId, quantity: 1 }]);
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    const bat = t.bat();
    t.run(X.addCombatants, { encounterId: enc.id, items: [{ definitionId: bat }] });
    const loose = t.combatants(enc.id).find((c) => c.tokenId === null) as CombatantRecord;
    expect(loose.hidden).toBe(false);
    const inFog = t.place(bat, 16, 2);
    const linked = t.changesOf(() => t.run(X.bindToken, { combatantId: loose.id, tokenId: inFog }));
    expect(t.combatantOfToken(enc.id, inFog).hidden).toBe(true);
    const v = t.h.viewer("player", t.h.p1.id);
    const ops = linked.map((c) => [c.type, c.id, t.s.records.filterChange(c, v)?.op ?? null]);
    expect(ops).toContainEqual(["combatant", loose.id, "delete"]);
  });

  test("FR-FOG-13 / -14 size refresh: Large → Medium leaves only fogged cells → hidden combatant", () => {
    const t = setup();
    const brute = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Brute",
      statBlock: { ...goblinBlock, size: "large" },
    });
    // 2 × 2 at (14, 2): (14, 2) and (15, 2) fogged (with the pocket), (14, 3), (15, 3) clear.
    t.fog("hide", rect(14, 2, 14, 2));
    const b = t.place(brute.id, 14, 2);
    expect(t.tok(b).fogged).toBeFalsy();
    const enc = t.encounter([{ definitionId: brute.id, quantity: 1 }]);
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    expect(t.combatantOfToken(enc.id, b).hidden).toBe(false);
    const refreshed = t.changesOf(() =>
      t.run(UPDATE, { id: brute.id, name: "Brute", statBlock: { ...goblinBlock, size: "medium" } }),
    );
    expect(t.tok(b).fogged).toBe(true);
    const c = t.combatantOfToken(enc.id, b);
    expect(c.hidden).toBe(true);
    const v = t.h.viewer("player", t.h.p2.id);
    const ops = refreshed.map((x) => [x.type, x.id, t.s.records.filterChange(x, v)?.op ?? null]);
    expect(ops).toContainEqual(["token", b, "delete"]);
    expect(ops).toContainEqual(["combatant", c.id, "delete"]);
  });

  test("FR-FOG-14 CBTX effect copy: covering a combatant's token hides its effects; revealing shows them", () => {
    const t = setup();
    const enc = t.encounter([{ definitionId: t.h.goblinId, quantity: 1 }]);
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    const g = t.combatantOfToken(enc.id, t.tokens.goblin);
    t.run(X.addEffect, {
      targets: [{ combatantId: g.id }],
      kind: "condition",
      condition: "poisoned",
    });
    const fx = () => t.s.db.select().from(effect).all();
    expect(fx().map((e) => e.hidden)).toEqual([false]);
    const covered = t.changesOf(() => t.fog("hide", rect(12, 6, 12, 6)));
    expect(fx().map((e) => e.hidden)).toEqual([true]);
    const v = t.h.viewer("player", t.h.p1.id);
    const ops = covered.map((x) => [x.type, t.s.records.filterChange(x, v)?.op ?? null]);
    expect(ops).toEqual([
      ["fog", "upsert"],
      ["token", "delete"],
      ["combatant", "delete"],
      ["effect", "delete"],
    ]);
    t.fog("reveal", rect(12, 6, 12, 6));
    expect(fx().map((e) => e.hidden)).toEqual([false]);
  });
});
