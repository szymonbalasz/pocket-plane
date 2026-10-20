// GEM GM1 / ADR-0043 (rulings-a #19): a reroll never re-runs the roll hooks, so an ADR-0043 rule
// trigger on the rerolled roll doesn't fire again: the new line keeps the part as rolled, no new
// trigger use, no new part roll row.
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import type { GameLogEntryRecord, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { gameLogEntry } from "../../db/schema";
import { setFeature } from "../campaign-management/features";
import { rtSetup } from "../effect-modifiers/trigger-testing";
import { adjustGems, spendGem } from "./commands";

/** A `roll` trigger (FR-MOD-43): + 1d4 + 1 on Brakka's weapon attack rolls, once per turn. */
const savage: TriggerRule = {
  on: "roll",
  when: [{ if: "roll", on: { roll: "attack", via: "weapon" } }],
  every: "turn",
  then: { do: "part", formula: "1d4 + 1" },
};

describe("FR-GEM-19 no hook re-run (ADR-0043 rule trigger)", () => {
  test("FR-GEM-19 no hook re-run: a rerolled to-hit keeps its trigger part as rolled; the trigger doesn't fire again", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    t.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
    t.run(adjustGems.name, { characterId: t.brakkaId, gem: "inspiration", delta: 1 });
    const trig = t.trig({ characterId: t.brakkaId, name: "Savage", rule: savage });
    const { cardId } = t.attack("Brakka", { rolls: "toHit", toHit: 9, actor: t.p1 });
    const toHit = t.card(cardId).toHit;
    const entry = (t.s.db.select().from(gameLogEntry).all() as GameLogEntryRecord[]).find(
      (e) => e.kind === "roll" && e.rollIds.includes(toHit?.rollId as string),
    ) as GameLogEntryRecord;
    const [old] = entry.payload as [RollPayloadItem];
    expect(old.mods?.map((m) => m.label)).toEqual(["Savage"]);
    expect(t.usesOf(trig).map((u) => u.state)).toEqual(["used"]);
    const rolls = t.count("roll");
    const r = t.run<{ rerollEntryId: string }>(
      spendGem.name,
      { characterId: t.brakkaId, gem: "inspiration", entryId: entry.id, manual: { diceTotal: 20 } },
      t.p1,
    );
    const next = t.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.id, r.rerollEntryId))
      .get() as GameLogEntryRecord;
    const [item] = next.payload as [RollPayloadItem];
    // The part as rolled (same roll row), the total = new d20 + 7 + the part.
    expect(item.mods).toEqual(old.mods);
    expect(item.total).toBe(20 + old.constant + (old.total - old.constant - 9));
    expect(next.rollIds).toEqual(entry.rollIds.map((id) => (id === old.rollId ? item.rollId : id)));
    // Only the reroll's own row; the trigger's use unchanged (re-running would have dropped it).
    expect(t.count("roll")).toBe(rolls + 1);
    expect(t.usesOf(trig).map((u) => u.state)).toEqual(["used"]);
    // The card follows with the copied part (FR-CBT-126).
    expect(t.card(cardId).toHit).toMatchObject({
      rollId: item.rollId,
      total: item.total,
      natural: 20,
    });
    expect(t.card(cardId).toHit?.mods).toEqual(toHit?.mods);
  });
});
