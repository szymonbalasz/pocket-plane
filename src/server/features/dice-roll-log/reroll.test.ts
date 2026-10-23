// FR-DICE-91 (sprint 9, FX2, BL-62): `dice.reroll` takes the caller's other items and roll ids
// (`others`); absent → copied as before (FR-DICE-62). In-process, over a two-item `roll` entry.
import { describe, expect, test } from "bun:test";
import type { GameLogEntryRecord, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { manualClock } from "../../commands/context";
import { gameLogEntry } from "../../db/schema";
import type { Actor } from "../../events/types";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { dice, gameLog } from "./index";
import type { OldEntry } from "./reroll";

/** A hidden two-item line: "1d20+3" then "1d6+1", as an attack + damage line. */
const twoItems = defineCommand({
  name: "test.twoItems",
  input: z.object({}),
  execute(_input, env) {
    const roll = (expression: string) =>
      dice.evaluate(env, {
        expression,
        mode: "normal",
        category: "attack",
        actor: { kind: "entity", id: "mira", name: "Mira" },
        source: "char",
      });
    const rolls = [roll("1d20+3"), roll("1d6+1")];
    return gameLog.append(env, {
      kind: "roll",
      category: "attack",
      actorName: "Mira",
      payload: rolls.map((r) => dice.rollPayloadItem(r)),
      rollIds: rolls.map((r) => r.id),
      public: false,
    }).id;
  },
});

const MODES = z.enum(["copy", "replace", "drop"]);

/** Rerolls the d20 item; `replace`: the damage item relabelled; `drop`: the damage item left out. */
const rerollStep = defineCommand({
  name: "test.rerollStep",
  input: z.object({ entryId: z.string(), rollId: z.string(), mode: MODES }),
  execute({ entryId, rollId, mode }, env) {
    const r = dice.reroll(env, {
      entryId,
      rollId,
      ...(mode === "copy"
        ? {}
        : {
            others: (item: RollPayloadItem, old: OldEntry) => {
              const dmg = old.items[1] as RollPayloadItem;
              return mode === "replace"
                ? {
                    items: [null, { ...dmg, label: "Maxed", total: 7 }],
                    rollIds: [item.rollId, dmg.rollId],
                  }
                : { items: [null, null], rollIds: [item.rollId] };
            },
          }),
    });
    return r.entry.id;
  },
});

function setup() {
  const s = createTestServices({ clock: manualClock() });
  const seed = seedSyncProbe(s);
  s.commands.register(twoItems);
  s.commands.register(rerollStep);
  const dm: Actor = { ...DM_ACTOR, campaignId: seed.campaignId };
  const entry = (id: string) =>
    s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as GameLogEntryRecord;
  const line = () => entry(s.commands.run(twoItems, {}, { actor: dm }) as string);
  const reroll = (old: GameLogEntryRecord, mode: z.infer<typeof MODES>) =>
    entry(
      s.commands.run(
        rerollStep,
        { entryId: old.id, rollId: old.rollIds[0] as string, mode },
        { actor: dm },
      ) as string,
    );
  return { line, reroll, entry };
}

describe("FR-DICE-91 reroll takes the caller's items", () => {
  test("FR-DICE-91 reroll items override", () => {
    const t = setup();
    // Absent → every other item and roll id copied (FR-DICE-62).
    const a = t.line();
    const [hit, dmg] = a.payload as RollPayloadItem[];
    const copied = t.reroll(a, "copy");
    const c = copied.payload as RollPayloadItem[];
    expect(c).toHaveLength(2);
    expect(c[1]).toEqual(dmg as RollPayloadItem);
    expect(c[0]?.replaces).toEqual({ entryId: a.id, total: hit?.total as number });
    expect(copied.rollIds).toEqual([c[0]?.rollId as string, dmg?.rollId as string]);
    // Override: the caller's item in its slot, its roll ids as given.
    const b = t.line();
    const replaced = t.reroll(b, "replace");
    const r = replaced.payload as RollPayloadItem[];
    expect(r.map((x) => [x.label, x.total])).toEqual([
      [null, r[0]?.total as number],
      ["Maxed", 7],
    ]);
    expect(replaced.rollIds).toEqual([
      r[0]?.rollId as string,
      (b.payload as RollPayloadItem[])[1]?.rollId as string,
    ]);
    // A dropped item leaves the line; the new to-hit alone.
    const d = t.line();
    const dropped = t.reroll(d, "drop");
    const x = dropped.payload as RollPayloadItem[];
    expect(x).toHaveLength(1);
    expect(x[0]?.replaces?.entryId).toBe(d.id);
    expect(dropped.rollIds).toEqual([x[0]?.rollId as string]);
    // Audience copied and the old line superseded, whatever the items.
    for (const [old, next] of [
      [a, copied],
      [b, replaced],
      [d, dropped],
    ] as const) {
      expect([next.public, next.audiencePlayerId]).toEqual([old.public, old.audiencePlayerId]);
      expect(t.entry(old.id).supersededBy).toBe(next.id);
    }
  });
});
