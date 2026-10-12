// SRD 5.1 Wolf (CC BY 4.0, see ../source.ts). Creature core only (ENT §8).
import type { MonsterStatBlock } from "@shared/entities/schemas";

export const wolf = {
  name: "Wolf",
  statBlock: {
    size: "medium",
    ac: 13,
    hpMax: 11,
    initBonus: 2,
    attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", damageType: "piercing" }],
    cr: "1/4",
  } satisfies MonsterStatBlock,
};
