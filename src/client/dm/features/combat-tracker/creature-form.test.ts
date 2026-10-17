// FR-CBT-86 (sprint 4, S4-1a): the creature form's whole `PUT` carries the loaded attack's
// `bonus` / `extraDamage` (and row id) and the attack rows after it; the form edits neither.
import { describe, expect, test } from "bun:test";
import { MonsterStatBlock } from "@shared/entities/schemas";
import { type Fields, formStatBlock } from "./creature-form";

const fields = (o: Partial<Fields> = {}): Fields => ({
  name: "Elite Goblin Warrior",
  size: "small",
  ac: "16",
  hpMax: "15",
  initBonus: "2",
  cr: "1/2",
  portraitAssetId: null,
  attackName: "Flame Scimitar",
  toHit: "5",
  damage: "1d6+3",
  damageType: "slashing",
  speed: "",
  tokenShape: "default",
  abilities: { str: "", dex: "", con: "", int: "", wis: "", cha: "" },
  saves: [],
  ...o,
});

const flame = {
  id: "row-1",
  name: "Flame Scimitar",
  toHit: 5,
  damage: "1d6+3",
  damageType: "slashing",
  bonus: 1,
  extraDamage: [{ damage: "2d6", type: "fire" }],
};
const bow = { id: "row-2", name: "Shortbow", toHit: 4, damage: "1d6+2", damageType: "piercing" };
const source = { size: "small", ac: 16, hpMax: 15, initBonus: 2, cr: "1/2", attacks: [flame, bow] };

describe("FR-CBT-86 creature form keeps the fields", () => {
  test("FR-CBT-86 creature form keeps the fields: Edit sends bonus + extraDamage of the loaded attack and the other rows", () => {
    const r = formStatBlock(fields(), source);
    expect(r.ok).toBe(true);
    const sb = MonsterStatBlock.parse(r.ok ? r.value : null);
    expect(sb.attacks).toEqual([flame, bow] as typeof sb.attacks);
    // The form's own fields still win; the hidden ones ride along.
    const edited = formStatBlock(fields({ toHit: "6", damageType: "__none__" }), source);
    const e = MonsterStatBlock.parse(edited.ok ? edited.value : null);
    const { damageType: _, ...untyped } = flame;
    expect(e.attacks).toEqual([{ ...untyped, toHit: 6 }, bow] as typeof e.attacks);
  });

  test("FR-CBT-86 creature form keeps the fields: New has none; clearing the name drops only that row", () => {
    const fresh = formStatBlock(fields(), null);
    const n = MonsterStatBlock.parse(fresh.ok ? fresh.value : null);
    expect(n.attacks).toEqual([
      { name: "Flame Scimitar", toHit: 5, damage: "1d6+3", damageType: "slashing" },
    ]);
    const cleared = formStatBlock(fields({ attackName: " " }), source);
    const c = MonsterStatBlock.parse(cleared.ok ? cleared.value : null);
    expect(c.attacks).toEqual([bow] as typeof c.attacks);
  });
});
