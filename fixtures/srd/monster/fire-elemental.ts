// SRD 5.1 Fire Elemental (CC BY 4.0, see ../source.ts). Creature core only (ENT §8).
import type { MonsterStatBlock } from "@shared/entities/schemas";

export const fireElemental = {
  name: "Fire Elemental",
  statBlock: {
    size: "large",
    ac: 13,
    hpMax: 102,
    hpFormula: "12d10+36",
    initBonus: 3,
    speed: 50,
    abilities: { str: 10, dex: 17, con: 16, int: 6, wis: 10, cha: 7 },
    attacks: [{ name: "Touch", toHit: 6, damage: "2d6+3", damageType: "fire" }],
    cr: "5",
    type: "elemental",
  } satisfies MonsterStatBlock,
};
