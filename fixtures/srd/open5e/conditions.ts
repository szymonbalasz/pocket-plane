// Open5e v1 `conditions` (recorded, `wotc-srd` only): SRD 5.1 by Wizards of the Coast LLC, CC BY 4.0
// (attribution: ../source.ts). Mini subset of the bundled source for fixture `cmp-srd-mini`.
export const conditions: readonly Record<string, unknown>[] = [
  {
    slug: "poisoned",
    name: "Poisoned",
    desc: "* A poisoned creature has disadvantage on attack rolls and ability checks.",
    document__slug: "wotc-srd",
    document__title: "5e Core Rules",
    document__url: "http://dnd.wizards.com/articles/features/systems-reference-document-srd",
  },
  {
    slug: "prone",
    name: "Prone",
    desc: "* A prone creature's only movement option is to crawl, unless it stands up and thereby ends the condition.\n* The creature has disadvantage on attack rolls.\n* An attack roll against the creature has advantage if the attacker is within 5 feet of the creature. Otherwise, the attack roll has disadvantage.",
    document__slug: "wotc-srd",
    document__title: "5e Core Rules",
    document__url: "http://dnd.wizards.com/articles/features/systems-reference-document-srd",
  },
  {
    slug: "grappled",
    name: "Grappled",
    desc: "* A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.\n* The condition ends if the grappler is incapacitated (see the condition).\n* The condition also ends if an effect removes the grappled creature from the reach of the grappler or grappling effect, such as when a creature is hurled away by the *thunder-wave* spell.",
    document__slug: "wotc-srd",
    document__title: "5e Core Rules",
    document__url: "http://dnd.wizards.com/articles/features/systems-reference-document-srd",
  },
];
