// SRD 5.1 Wolf (CC BY 4.0, see ../source.ts). Creature core only (ENT §8).
import type { MonsterStatBlock } from "@shared/entities/schemas";

export const wolf = {
  name: "Wolf",
  statBlock: {
    size: "medium",
    ac: 13,
    hpMax: 11,
    hpFormula: "2d8+2",
    initBonus: 2,
    speed: 40,
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", damageType: "piercing" }],
    cr: "1/4",
  } satisfies MonsterStatBlock,
};
