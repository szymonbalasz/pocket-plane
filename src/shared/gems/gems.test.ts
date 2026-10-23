// GEM unit tests (GM0): intents, costs, line wording, kind tags.
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { getLogKind } from "@shared/dice-roll-log/kinds";
import { formatEntry } from "@shared/dice-roll-log/line";
import { gemsPhrase } from "./log-kinds";
import {
  combatDiceLevel,
  combatDiceLimit,
  GemAdjustInput,
  GemSpendInput,
  LOG_KIND_GEM_AWARD,
  LOG_KIND_GEM_SPEND,
  spendCost,
} from "./schemas";

const line = (kind: string, actorName: string, payload: unknown) =>
  lineText(formatEntry({ kind, actorName, payload }).segments);

describe("gems schemas and lines (GEM §6)", () => {
  test("FR-GEM-07 FR-GEM-43 adjust input: delta −10…+10 (sprint 9, summed clicks), never 0; known gem", () => {
    const ok = (delta: number) =>
      GemAdjustInput.safeParse({ characterId: "c", gem: "fortune", delta }).success;
    expect([-10, -5, -1, 1, 6, 10].map(ok)).toEqual([true, true, true, true, true, true]);
    expect([-11, 0, 11, 1.5].map(ok)).toEqual([false, false, false, false]);
    expect(GemAdjustInput.safeParse({ characterId: "c", gem: "luck", delta: 1 }).success).toBe(
      false,
    );
  });

  test("FR-GEM-16 action costs 2: bonus / reaction 1, action 2; use only with Action", () => {
    expect(spendCost("action", "bonus")).toBe(1);
    expect(spendCost("action", "reaction")).toBe(1);
    expect(spendCost("action", "action")).toBe(2);
    expect(spendCost("fortune")).toBe(1);
    const spend = (v: object) => GemSpendInput.safeParse({ characterId: "c", ...v }).success;
    expect(spend({ gem: "action", use: "action" })).toBe(true);
    expect(spend({ gem: "action" })).toBe(false);
    expect(spend({ gem: "fortune", use: "bonus" })).toBe(false);
    expect(spend({ gem: "inspiration" })).toBe(true);
    expect(spend({ gem: "divine" })).toBe(true);
    // The Combat gem needs a card and dice (GM2). GM1: `entryId` on Inspiration only; `manual` with it.
    expect(spend({ gem: "combat" })).toBe(false);
    expect(spend({ gem: "inspiration", entryId: "e1" })).toBe(true);
    expect(spend({ gem: "inspiration", entryId: "e1", manual: { diceTotal: 17 } })).toBe(true);
    expect(spend({ gem: "fortune", entryId: "e1" })).toBe(false);
    expect(spend({ gem: "inspiration", manual: { diceTotal: 17 } })).toBe(false);
  });

  test("FR-GEM-13 detail by audience / FR-GEM-19 line wording: a public target names the roll; a DM-only one only for the DM", () => {
    const target = { kind: "entry", id: "e1", label: "Perception", from: 4 };
    const full = (payload: object, dmPayload?: object) =>
      lineText(
        formatEntry({
          kind: LOG_KIND_GEM_SPEND,
          actorName: "Mira",
          payload: { characterId: "c", gem: "inspiration", count: 1, ...payload },
          ...(dmPayload ? { dmPayload } : {}),
        }).segments,
      );
    expect(full({ target })).toBe("Mira spends an Inspiration gem — rerolls Perception (4)");
    const secret = { ...target, label: "DM-SECRET-GEM" };
    expect(full({ target: null })).toBe("Mira spends an Inspiration gem");
    expect(full({ target: null }, { target: secret })).toBe(
      "Mira spends an Inspiration gem — rerolls DM-SECRET-GEM (4)",
    );
    // No target at all: the plain spend (OQ-GEM-06 A).
    expect(full({})).toBe("Mira spends an Inspiration gem — to recall");
  });

  test("FR-GEM-26 levels: 1 die at 1–5, 2 at 6–11, 3 at 12+", () => {
    expect([1, 5, 6, 11, 12, 20].map(combatDiceLimit)).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3].map(combatDiceLevel)).toEqual([1, 6, 12]);
  });

  test("FR-GEM-25 FR-GEM-27 FR-GEM-28 combat input: a card + 1–3 dice (base or an extra part); `known` per part; only Combat", () => {
    const spend = (v: object) =>
      GemSpendInput.safeParse({ characterId: "c", gem: "combat", cardId: "k", ...v }).success;
    const die = { part: "base", index: 0 };
    expect(spend({ dice: [die] })).toBe(true);
    expect(spend({ dice: [die, { part: 0, index: 1 }, { part: 1, index: 0 }] })).toBe(true);
    expect(spend({ dice: [] })).toBe(false);
    expect(spend({ dice: [die, die, die, die] })).toBe(false);
    expect(spend({ dice: [{ part: "mods", index: 0 }] })).toBe(false);
    expect(spend({ dice: [{ part: "triggers", index: 0 }] })).toBe(false);
    expect(spend({ dice: [die], known: [{ part: "base", dice: [3, 5] }] })).toBe(true);
    expect(spend({ dice: [die], known: [{ part: "base", dice: [0] }] })).toBe(false);
    expect(spend({})).toBe(false);
    const other = (v: object) => GemSpendInput.safeParse({ characterId: "c", ...v }).success;
    expect(other({ gem: "fortune", cardId: "k", dice: [die] })).toBe(false);
    expect(other({ gem: "inspiration", entryId: "e", known: [{ part: "base", dice: [3] }] })).toBe(
      false,
    );
  });

  test("FR-GEM-30 line wording: 'Mira spends a Combat gem — Light crossbow: d8 3 → 8 (rolled 7 → 12)'; parts named by type when > 1; DM-only card → no detail for players", () => {
    const target = { kind: "card", id: "k", label: "Light crossbow", from: 7, to: 12 };
    const full = (payload: object, dmPayload?: object) =>
      lineText(
        formatEntry({
          kind: LOG_KIND_GEM_SPEND,
          actorName: "Mira",
          payload: { characterId: "c", gem: "combat", count: 1, ...payload },
          ...(dmPayload ? { dmPayload } : {}),
        }).segments,
      );
    const d8 = { faces: 8, from: 3, to: 8 };
    expect(full({ target, dice: [d8] })).toBe(
      "Mira spends a Combat gem — Light crossbow: d8 3 → 8 (rolled 7 → 12)",
    );
    const flame = { ...target, label: "Flame Tongue greatsword", from: 14, to: 22 };
    const two = [
      { part: "slashing", faces: 6, from: 2, to: 6 },
      { part: "fire", faces: 6, from: 2, to: 6 },
    ];
    expect(full({ target: flame, dice: two })).toBe(
      "Mira spends a Combat gem — Flame Tongue greatsword: slashing d6 2 → 6, fire d6 2 → 6 (rolled 14 → 22)",
    );
    expect(full({ target: null })).toBe("Mira spends a Combat gem");
    expect(full({ target: null }, { target, dice: [d8] })).toBe(
      "Mira spends a Combat gem — Light crossbow: d8 3 → 8 (rolled 7 → 12)",
    );
  });

  test("FR-GEM-09 award line wording", () => {
    const award = (gem: string, count: number, held: number) =>
      line(LOG_KIND_GEM_AWARD, "Mira", { characterId: "c", gem, count, held });
    expect(award("inspiration", 1, 2)).toBe("DM awards Mira an Inspiration gem (2 held)");
    expect(award("fortune", 5, 6)).toBe("DM awards Mira 5 Fortune gems (6 held)");
    expect(award("divine", 1, 1)).toBe("DM awards Mira a Divine Knowledge gem (1 held)");
  });

  test("FR-GEM-14 FR-GEM-15 FR-GEM-16 spend line wording (OQ-GEM-06 A: Inspiration to recall)", () => {
    const spend = (actor: string, gem: string, count: number, use?: string) =>
      line(LOG_KIND_GEM_SPEND, actor, { characterId: "c", gem, count, ...(use ? { use } : {}) });
    expect(spend("Mira", "fortune", 1)).toBe("Mira spends a Fortune gem — searching for treasure");
    expect(spend("Mira", "divine", 1)).toBe(
      "Mira spends a Divine Knowledge gem — asks the gods a question",
    );
    expect(spend("Brakka", "action", 2, "action")).toBe(
      "Brakka spends 2 Action gems — a full action",
    );
    expect(spend("Brakka", "action", 1, "bonus")).toBe(
      "Brakka spends an Action gem — a bonus action",
    );
    expect(spend("Brakka", "action", 1, "reaction")).toBe(
      "Brakka spends an Action gem — a reaction",
    );
    expect(spend("Mira", "inspiration", 1)).toBe("Mira spends an Inspiration gem — to recall");
    expect(gemsPhrase("combat", 1)).toBe("a Combat gem");
  });

  test("FR-DICE-69 gem kinds are tagged with the gems feature; `roll` declares gems' trace", () => {
    expect(getLogKind(LOG_KIND_GEM_AWARD)?.feature).toBe(GEMS_FEATURE);
    expect(getLogKind(LOG_KIND_GEM_SPEND)?.feature).toBe(GEMS_FEATURE);
    expect(getLogKind("roll")?.feature).toBeUndefined();
    const [trace] = getLogKind("roll")?.traces ?? [];
    expect(trace?.feature).toBe(GEMS_FEATURE);
    const entry: { supersededBy: string | null; payload: object[] } = {
      supersededBy: null,
      payload: [{ rollId: "r2", total: 20, replaces: { entryId: "e1", total: 4 } }],
    };
    expect(trace?.hides?.(entry)).toBe(false);
    expect(trace?.hides?.({ ...entry, supersededBy: "e2" })).toBe(true);
    expect(trace?.strip?.(entry)).toEqual({
      supersededBy: null,
      payload: [{ rollId: "r2", total: 20 }],
    });
    // Nothing to strip → the same object (no copy per entry).
    const plain: typeof entry = { supersededBy: null, payload: [{ rollId: "r1", total: 4 }] };
    expect(trace?.strip?.(plain)).toBe(plain);
  });
});
