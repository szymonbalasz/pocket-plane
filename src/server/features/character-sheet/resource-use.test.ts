// Feature use with a cost over the command bus (class-resources FR-CRES-09–13): spend links on
// feature rows, `char.useFeature` (feature uses, pact slots, any slot, ask amounts, the row's own
// uses, overspend), the `char.resourceUse` line (public or DM + owner) and `char.undoResourceUse`.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { getLogKind } from "@shared/dice-roll-log/kinds";
import { eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { creatureSheet, gameLogEntry } from "../../db/schema";
import type { Actor } from "../../events/types";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { toSheetRecord } from "./sheet-rows";

const I = CHARX_INTENTS;

function setup() {
  const { s } = diceServices("cres-use");
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
  const sheet = () => {
    const row = s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, t.miraId)).get();
    if (!row) throw new Error("no sheet");
    return toSheetRecord(row);
  };
  run(I.edit, {
    creatureId: t.miraId,
    set: {
      spellcasting: { ability: "cha", slots: { "1": 4, "2": 3 }, pact: { level: 1, slots: 2 } },
    },
  });
  const row = (r: Record<string, unknown>) =>
    run<{ rowId: string }>(I.putRow, { creatureId: t.miraId, list: "features", row: r }).rowId;
  const font = row({ name: "Font of Magic", usesMax: 5, reset: "long", pool: "sorcery-points" });
  const quick = row({ name: "Quickened Spell", spend: { from: { feature: font }, amount: 2 } });
  const twin = row({ name: "Twinned Spell", spend: { from: { feature: font }, amount: "ask" } });
  const smite = row({ name: "Eldritch Smite", spend: { from: { pact: true }, amount: 1 } });
  const any = row({ name: "Divine Smite", spend: { from: { slot: "any" }, amount: 1 } });
  const used = (id: string) => sheet().features.find((f) => f.id === id)?.used;
  const use = (rowId: string, o: Record<string, unknown> = {}, actor: Actor = t.p1Actor) =>
    run<{ entryId: string }>(I.useFeature, { characterId: t.miraId, rowId, ...o }, actor);
  const entry = (id: string) => {
    const e = s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();
    if (!e) throw new Error("no entry");
    return e;
  };
  const text = (id: string) => {
    const e = entry(id);
    const kind = getLogKind(e.kind);
    return kind ? lineText(kind.formatLine({ actorName: e.actorName, payload: e.payload })) : "";
  };
  const undo = (entryId: string, actor: Actor = t.p1Actor) =>
    run(I.undoResourceUse, { entryId }, actor);
  return {
    s,
    t,
    run,
    fail,
    sheet,
    row,
    font,
    quick,
    twin,
    smite,
    any,
    used,
    use,
    entry,
    text,
    undo,
  };
}

describe("FR-CRES-09 spend links", () => {
  test("FR-CRES-09 a row can't spend from itself; a missing source refuses the Use", () => {
    const x = setup();
    const id = x.row({ name: "Loop", usesMax: 2 });
    const e = x.fail(() =>
      x.run(I.putRow, {
        creatureId: x.t.miraId,
        list: "features",
        row: { id, name: "Loop", usesMax: 2, spend: { from: { feature: id }, amount: 1 } },
      }),
    );
    expect(e.code).toBe("invalid");
    const dangling = x.row({ name: "Ghost", spend: { from: { feature: "gone" }, amount: 1 } });
    expect(x.fail(() => x.use(dangling)).message).toBe("Spend source missing");
  });
});

describe("FR-CRES-11 char.useFeature", () => {
  test("FR-CRES-11 Quickened Spell spends 2 sorcery points; the public line says so", () => {
    const x = setup();
    const { entryId } = x.use(x.quick);
    expect(x.used(x.font)).toBe(2);
    expect(x.text(entryId)).toBe("Mira · Quickened Spell · −2 sorcery points (3 left)");
    expect(x.entry(entryId).public).toBe(true);
  });

  test("FR-CRES-11 ask: amount required; a fixed row refuses another amount", () => {
    const x = setup();
    expect(x.fail(() => x.use(x.twin)).message).toBe("Enter an amount");
    x.use(x.twin, { amount: 3 });
    expect(x.used(x.font)).toBe(3);
    expect(x.fail(() => x.use(x.quick, { amount: 1 })).code).toBe("invalid");
  });

  test("FR-CRES-11 pact slot: spent; none left → conflict", () => {
    const x = setup();
    const { entryId } = x.use(x.smite);
    expect(x.sheet().pactUsed).toBe(1);
    expect(x.text(entryId)).toBe("Mira · Eldritch Smite · −1 pact slot (1 pact slot left)");
    x.use(x.smite);
    expect(x.fail(() => x.use(x.smite)).code).toBe("conflict");
  });

  test("FR-CRES-11 any slot: needs a level; created slots first", () => {
    const x = setup();
    expect(x.fail(() => x.use(x.any)).message).toBe("Pick a slot level");
    x.run(I.createSlot, { characterId: x.t.miraId, level: 1 });
    x.use(x.any, { slotLevel: 1 });
    expect([x.sheet().slotsCreated, x.sheet().slotsUsed]).toEqual([{}, {}]);
    x.use(x.any, { slotLevel: 2 });
    expect(x.sheet().slotsUsed).toEqual({ "2": 1 });
  });

  test("FR-CRES-11 not enough points → conflict; overspend goes below zero", () => {
    const x = setup();
    x.use(x.twin, { amount: 4 });
    const e = x.fail(() => x.use(x.quick));
    expect([e.code, e.message]).toEqual(["conflict", "Not enough sorcery points (1 left)"]);
    x.use(x.quick, { overspend: true });
    expect(x.used(x.font)).toBe(6);
  });

  test("FR-CRES-11 a row with its own uses spends 1 of them too", () => {
    const x = setup();
    const cd = x.row({ name: "Channel Divinity", usesMax: 2, reset: "short" });
    const turn = x.row({
      name: "Turn Undead",
      usesMax: 1,
      reset: "long",
      spend: { from: { feature: cd }, amount: 1 },
    });
    x.use(turn);
    expect([x.used(cd), x.used(turn)]).toEqual([1, 1]);
  });

  test("FR-CRES-11 another player is refused; the owner uses on a locked sheet", () => {
    const x = setup();
    expect(x.fail(() => x.use(x.quick, {}, x.t.p2Actor)).code).toBe("forbidden");
    x.run(I.setLock, { characterId: x.t.miraId, locked: true });
    x.use(x.quick);
    expect(x.used(x.font)).toBe(2);
  });
});

describe("FR-CRES-12 lines and Undo", () => {
  test("FR-CRES-12 public: false → the DM and the owner only", () => {
    const x = setup();
    const { entryId } = x.use(x.quick, { public: false });
    const e = x.entry(entryId);
    expect([e.public, e.audiencePlayerId]).toEqual([false, x.t.p1.id]);
  });

  test("FR-CRES-12 conversions and created slots write lines too", () => {
    const x = setup();
    x.use(x.quick);
    const conv = x.run<{ entryId: string }>(I.convertSlot, {
      characterId: x.t.miraId,
      from: { pact: true },
    });
    expect(x.text(conv.entryId)).toBe(
      "Mira · Pact slot → sorcery points · +1 sorcery point (4 / 5 sorcery points)",
    );
    const made = x.run<{ entryId: string }>(I.createSlot, { characterId: x.t.miraId, level: 1 });
    expect(x.text(made.entryId)).toBe(
      "Mira · Sorcery points → 1st-level slot · −2 sorcery points (2 / 5 sorcery points)",
    );
  });

  test("FR-CRES-12 Undo gives the exact spend back, once; sender or DM only", () => {
    const x = setup();
    const a = x.use(x.quick).entryId;
    const b = x.use(x.smite).entryId;
    expect(x.fail(() => x.undo(a, x.t.p2Actor)).code).toBe("forbidden");
    x.undo(a);
    expect(x.used(x.font)).toBe(0);
    expect(x.entry(a).undone).toBe(true);
    expect(x.fail(() => x.undo(a)).message).toBe("Already undone");
    x.undo(b, x.t.dm);
    expect(x.sheet().pactUsed).toBe(0);
  });

  test("FR-CRES-12 Undo of a convert / create; a spent created slot or a long rest blocks it", () => {
    const x = setup();
    x.use(x.twin, { amount: 3 });
    const conv = x.run<{ entryId: string }>(I.convertSlot, {
      characterId: x.t.miraId,
      from: { slot: 2 },
    }).entryId;
    x.undo(conv, x.t.dm);
    expect([x.used(x.font), x.sheet().slotsUsed]).toEqual([3, {}]);
    const made = x.run<{ entryId: string }>(I.createSlot, {
      characterId: x.t.miraId,
      level: 1,
    }).entryId;
    x.run(I.useResource, { characterId: x.t.miraId, resource: { slot: 1 }, delta: 1 });
    expect(x.fail(() => x.undo(made, x.t.dm)).message).toBe("That created slot was already spent");
    const late = x.use(x.smite).entryId;
    x.run(I.rest, { characterIds: [x.t.miraId], kind: "long" });
    expect(x.fail(() => x.undo(late)).message).toBe("A long rest came after this: nothing to undo");
  });
});
