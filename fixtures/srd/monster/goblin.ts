// SRD 5.1 Goblin (CC BY 4.0, see ../source.ts). Creature core only (ENT §8).
import type { MonsterStatBlock } from "@shared/entities/schemas";

export const goblin = {
  name: "Goblin",
  statBlock: {
    size: "small",
    ac: 15,
    hpMax: 7,
    initBonus: 2,
    attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
    cr: "1/4",
  } satisfies MonsterStatBlock,
};
