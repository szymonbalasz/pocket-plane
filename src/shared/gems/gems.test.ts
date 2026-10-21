// GEM unit tests (GM0): intents, costs, line wording, kind tags.
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { getLogKind } from "@shared/dice-roll-log/kinds";
import { formatEntry } from "@shared/dice-roll-log/line";
import { gemsPhrase } from "./log-kinds";
import {
  GemAdjustInput,
  GemSpendInput,
  LOG_KIND_GEM_AWARD,
  LOG_KIND_GEM_SPEND,
  spendCost,
} from "./schemas";

const line = (kind: string, actorName: string, payload: unknown) =>
  lineText(formatEntry({ kind, actorName, payload }).segments);

describe("gems schemas and lines (GEM §6)", () => {
  test("FR-GEM-07 adjust input: delta −5…+5, never 0; known gem", () => {
    const ok = (delta: number) =>
      GemAdjustInput.safeParse({ characterId: "c", gem: "fortune", delta }).success;
    expect([-5, -1, 1, 5].map(ok)).toEqual([true, true, true, true]);
    expect([-6, 0, 6, 1.5].map(ok)).toEqual([false, false, false, false]);
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
    // The Combat gem needs a card (GM2). GM1: `entryId` on Inspiration only; `manual` with it.
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
