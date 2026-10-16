// Open5e v1 `weapons` (recorded, `wotc-srd` only): SRD 5.1 by Wizards of the Coast LLC, CC BY 4.0
// (attribution: ../source.ts). Mini subset of the bundled source for fixture `cmp-srd-mini`.
export const weapons: readonly Record<string, unknown>[] = [
  {
    name: "Longsword",
    slug: "longsword",
    category: "Martial Melee Weapons",
    document__slug: "wotc-srd",
    document__title: "5e Core Rules",
    document__license_url: "http://open5e.com/legal",
    document__url: "http://dnd.wizards.com/articles/features/systems-reference-document-srd",
    cost: "15 gp",
    damage_dice: "1d8",
    damage_type: "slashing",
    weight: "3 lb.",
    properties: ["versatile (1d10)"],
  },
];
