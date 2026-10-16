// Open5e v1 `magicitems` (recorded, `wotc-srd` only): SRD 5.1 by Wizards of the Coast LLC, CC BY 4.0
// (attribution: ../source.ts). Mini subset of the bundled source for fixture `cmp-srd-mini`.
export const magicitems: readonly Record<string, unknown>[] = [
  {
    slug: "potion-of-healing",
    name: "Potion of Healing",
    type: "Potion",
    desc: "You regain hit points when you drink this potion. The number of hit points depends on the potion's rarity, as shown in the Potions of Healing table. Whatever its potency, the potion's red liquid glimmers when agitated.\n\n**Potions of Healing (table)**\n\n| Potion of ...    | Rarity    | HP Regained |\n|------------------|-----------|-------------|\n| Healing          | Common    | 2d4 + 2     |\n| Greater healing  | Uncommon  | 4d4 + 4     |\n| Superior healing | Rare      | 8d4 + 8     |\n| Supreme healing  | Very rare | 10d4 + 20   |",
    rarity: "varies",
    requires_attunement: "",
    document__slug: "wotc-srd",
    document__title: "5e Core Rules",
    document__url: "http://dnd.wizards.com/articles/features/systems-reference-document-srd",
  },
  {
    slug: "bag-of-holding",
    name: "Bag of Holding",
    type: "Wondrous item",
    desc: "This bag has an interior space considerably larger than its outside dimensions, roughly 2 feet in diameter at the mouth and 4 feet deep. The bag can hold up to 500 pounds, not exceeding a volume of 64 cubic feet. The bag weighs 15 pounds, regardless of its contents. Retrieving an item from the bag requires an action.\n\nIf the bag is overloaded, pierced, or torn, it ruptures and is destroyed, and its contents are scattered in the Astral Plane. If the bag is turned inside out, its contents spill forth, unharmed, but the bag must be put right before it can be used again. Breathing creatures inside the bag can survive up to a number of minutes equal to 10 divided by the number of creatures (minimum 1 minute), after which time they begin to suffocate.\n\nPlacing a _bag of holding_ inside an extradimensional space created by a _handy haversack_, _portable hole_, or similar item instantly destroys both items and opens a gate to the Astral Plane. The gate originates where the one item was placed inside the other. Any creature within 10 feet of the gate is sucked through it to a random location on the Astral Plane. The gate then closes. The gate is one-way only and can't be reopened.",
    rarity: "uncommon",
    requires_attunement: "",
    document__slug: "wotc-srd",
    document__title: "5e Core Rules",
    document__url: "http://dnd.wizards.com/articles/features/systems-reference-document-srd",
  },
];
