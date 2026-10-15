// SRD 5.1 Goblin (CC BY 4.0, see ../source.ts). Creature core only (ENT §8).
import type { MonsterStatBlock } from "@shared/entities/schemas";

export const goblin = {
  name: "Goblin",
  statBlock: {
    size: "small",
    ac: 15,
    hpMax: 7,
    hpFormula: "2d6",
    initBonus: 2,
    speed: 30,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
    cr: "1/4",
  } satisfies MonsterStatBlock,
};
