// Pact slots (class-resources FR-CRES-01–03): the stat block's `spellcasting.pact`, the sheet's
// `pactUsed` counter through `char.useResource {pact}`, clamping when the maximum drops, and both
// rests giving them back. Owner and DM, also on a locked sheet; another player is refused.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { creatureSheet } from "../../db/schema";
import type { Actor } from "../../events/types";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { toSheetRecord } from "./sheet-rows";

const I = CHARX_INTENTS;

function setup() {
  const { s } = diceServices("cres-pact");
  const t = seedDice(s);
  const run = <R = Record<string, unknown>>(name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor }) as R;
  const fail = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const sheet = (id: string) => {
    const row = s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, id)).get();
    return row ? toSheetRecord(row) : null;
  };
  // Mira as a Sorcerer 5 / Warlock 2: slots 1st ×4, 2nd ×3, 3rd ×2; 2 pact slots of 1st level.
  const spellcasting = (pact?: { level: number; slots: number }) =>
    run(I.edit, {
      creatureId: t.miraId,
      set: {
        spellcasting: {
          ability: "cha",
          slots: { "1": 4, "2": 3, "3": 2 },
          ...(pact ? { pact } : {}),
        },
      },
    });
  spellcasting({ level: 1, slots: 2 });
  const pact = (delta: number, actor: Actor = t.dm) =>
    run<{ before: number; after: number }>(
      I.useResource,
      { characterId: t.miraId, resource: { pact: true }, delta },
      actor,
    );
  const rest = (kind: "short" | "long") => run(I.rest, { characterIds: [t.miraId], kind }, t.dm);
  return { s, t, run, fail, sheet, spellcasting, pact, rest };
}

describe("FR-CRES-01 pact slots on the stat block", () => {
  test("FR-CRES-01 char.edit stores spellcasting.pact; level 6 or 5 slots → invalid", () => {
    const x = setup();
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(0);
    for (const bad of [
      { level: 6, slots: 1 },
      { level: 1, slots: 5 },
      { level: 0, slots: 1 },
    ]) {
      expect(x.fail(() => x.spellcasting(bad)).code).toBe("invalid");
    }
  });
});

describe("FR-CRES-02 pact counter", () => {
  test("FR-CRES-02 useResource {pact}: owner and DM tick, clamp at the maximum and 0, reset", () => {
    const x = setup();
    expect(x.pact(1, x.t.p1Actor)).toEqual({ before: 0, after: 1 });
    expect(x.pact(5)).toEqual({ before: 1, after: 2 });
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(2);
    expect(x.pact(-9)).toEqual({ before: 2, after: 0 });
    x.pact(2);
    x.run(I.useResource, { characterId: x.t.miraId, resource: { pact: true }, reset: true });
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(0);
  });

  test("FR-CRES-02 locked sheet: the owner still ticks; another player is forbidden", () => {
    const x = setup();
    x.run(I.setLock, { characterId: x.t.miraId, locked: true });
    expect(x.pact(1, x.t.p1Actor).after).toBe(1);
    expect(x.fail(() => x.pact(1, x.t.p2Actor)).code).toBe("forbidden");
  });

  test("FR-CRES-02 no pact slots → the counter stays at 0", () => {
    const x = setup();
    x.spellcasting();
    expect(x.pact(1)).toEqual({ before: 0, after: 0 });
  });

  test("FR-CRES-02 lowering pact.slots clamps pactUsed; removing pact clears it", () => {
    const x = setup();
    x.pact(2);
    x.spellcasting({ level: 1, slots: 1 });
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(1);
    x.spellcasting();
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(0);
  });
});

describe("FR-CRES-03 rests give pact slots back", () => {
  test("FR-CRES-03 short rest: pact slots back, spell slots kept; long rest: both back", () => {
    const x = setup();
    x.pact(2);
    x.run(I.useResource, { characterId: x.t.miraId, resource: { slot: 1 }, delta: 3 });
    x.rest("short");
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(0);
    expect(x.sheet(x.t.miraId)?.slotsUsed).toEqual({ "1": 3 });
    x.pact(1);
    x.rest("long");
    expect(x.sheet(x.t.miraId)?.pactUsed).toBe(0);
    expect(x.sheet(x.t.miraId)?.slotsUsed).toEqual({});
  });
});
