// SRD 5.1 Owlbear (CC BY 4.0, see ../source.ts). Creature core only (ENT §8).
import type { MonsterStatBlock } from "@shared/entities/schemas";

export const owlbear = {
  name: "Owlbear",
  statBlock: {
    size: "large",
    ac: 13,
    hpMax: 59,
    hpFormula: "7d10+21",
    initBonus: 1,
    speed: 40,
    abilities: { str: 20, dex: 12, con: 17, int: 3, wis: 12, cha: 7 },
    attacks: [
      { name: "Beak", toHit: 7, damage: "1d10+5", damageType: "piercing" },
      { name: "Claws", toHit: 7, damage: "2d8+5", damageType: "slashing" },
    ],
    cr: "3",
    type: "monstrosity",
  } satisfies MonsterStatBlock,
};
