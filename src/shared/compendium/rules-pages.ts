// Rules window pages (FR-CMP-64, OQ-CMP-45 A): curated, ordered lists of card `sourceKey`s. Only
// the list and its order are ours; every card's text is the SRD's (FR-CMP-61). The recorder and the
// adapter keep exactly the sections these pages draw on plus `RULES_EXTRA` (FR-CMP-60, review-a
// ruling 19): a new page section is one list entry. A test resolves every key against the bundled
// source (FR-CMP-64). Pure data, no dependency.

/** The Open5e `sections` the pages use (FR-CMP-60). */
export const RULES_SECTIONS = [
  "actions-in-combat",
  "attacking",
  "cover",
  "damage-and-healing",
  "combat-sequence",
  "mounted-combat",
  "underwater-combat",
  "abilities",
  "saving-throws",
  "inspiration",
  "movement",
  "environment",
  "rest",
  "time",
  "objects",
  "spellcasting",
  "traps",
  "poisons",
  "diseases",
  "madness",
] as const;

/** FR-CMP-60: kept though no page lists them (searchable; open in the search view, FR-CMP-69). */
export const RULES_EXTRA = ["between-adventures"] as const;

export const RULE_SECTION_SLUGS: readonly string[] = [...RULES_SECTIONS, ...RULES_EXTRA];

/** `rule/<section-slug>/<card-slug>` (FR-CMP-59). */
export const ruleKey = (section: string, card: string) => `rule/${section}/${card}`;

const cards = (section: (typeof RULES_SECTIONS)[number], ...slugs: string[]) =>
  slugs.map((c) => ruleKey(section, c));

const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
];

/** The house rules page (FR-CMP-67): the campaign's homebrew `rule` entries, by name. */
export const HOUSE_PAGE_ID = "house";
/** The pinned page (FR-CMP-66): client only, per browser; never a server page. */
export const PINNED_PAGE_ID = "pinned";

export interface RulesPageDef {
  id: string;
  title: string;
  /** Card `sourceKey`s in page order (rule cards and, for Conditions, condition entries). */
  items: readonly string[];
}

/** FR-CMP-64: the curated pages, in tab order (then House rules, then Pinned). */
export const RULE_PAGES: readonly RulesPageDef[] = [
  {
    id: "combat",
    title: "Combat",
    items: [
      ...cards(
        "actions-in-combat",
        "actions-in-combat",
        "attack",
        "cast-a-spell",
        "dash",
        "disengage",
        "dodge",
        "help",
        "hide",
        "ready",
        "search",
        "use-an-object",
      ),
      ...cards("combat-sequence", "initiative", "your-turn", "bonus-actions", "reactions"),
      ...cards(
        "attacking",
        "attack-rolls",
        "modifiers-to-the-roll",
        "rolling-1-or-20",
        "unseen-attackers-and-targets",
        "ranged-attacks-in-close-combat",
        "opportunity-attacks",
        "two-weapon-fighting",
        "grappling",
        "shoving-a-creature",
      ),
      ...cards("cover", "cover"),
      ...cards(
        "damage-and-healing",
        "critical-hits",
        "damage-resistance-and-vulnerability",
        "dropping-to-0-hit-points",
        "death-saving-throws",
        "stabilizing-a-creature",
        "instant-death",
        "knocking-a-creature-out",
        "temporary-hit-points",
      ),
      ...cards(
        "mounted-combat",
        "mounted-combat",
        "mounting-and-dismounting",
        "controlling-a-mount",
      ),
      ...cards("underwater-combat", "underwater-combat"),
    ],
  },
  {
    id: "conditions",
    title: "Conditions",
    items: CONDITIONS.map((c) => `condition/${c}`),
  },
  {
    id: "checks",
    title: "Checks",
    items: [
      ...cards(
        "abilities",
        "advantage-and-disadvantage",
        "proficiency-bonus",
        "ability-checks",
        "contests",
        "passive-checks",
        // Holds "Group Checks" (a deeper heading stays inside its card, FR-CMP-61).
        "working-together",
      ),
      ...cards("saving-throws", "saving-throws"),
      ...cards("inspiration", "inspiration", "gaining-inspiration", "using-inspiration"),
    ],
  },
  {
    id: "exploration",
    title: "Exploration",
    items: [
      ...cards(
        "movement",
        "movement",
        "speed",
        "travel-pace",
        "difficult-terrain",
        "special-types-of-movement",
        "climbing-swimming-and-crawling",
        "jumping",
      ),
      ...cards(
        "environment",
        "falling",
        "suffocating",
        "vision-and-light",
        "blindsight",
        "darkvision",
        "truesight",
        "food-and-water",
        "food",
        "water",
      ),
      ...cards("rest", "rest", "short-rest", "long-rest"),
      ...cards("time", "time"),
      ...cards("objects", "objects", "statistics-for-objects"),
    ],
  },
  {
    id: "spellcasting",
    title: "Spellcasting",
    items: cards(
      "spellcasting",
      "casting-a-spell",
      "casting-time",
      "bonus-action",
      "reactions",
      "longer-casting-times",
      "spell-range",
      "components",
      "verbal-v",
      "somatic-s",
      "material-m",
      "duration",
      "instantaneous",
      "concentration",
      "targets",
      "a-clear-path-to-the-target",
      "targeting-yourself",
      "areas-of-effect",
      "cone",
      "cube",
      "cylinder",
      "line",
      "sphere",
      "spell-saving-throws",
      "spell-attack-rolls",
      "combining-magical-effects",
    ),
  },
  {
    id: "hazards",
    title: "Hazards",
    items: [
      ...cards(
        "traps",
        "traps",
        "traps-in-play",
        "triggering-a-trap",
        "detecting-and-disabling-a-trap",
        "trap-effects",
        "complex-traps",
        "sample-traps",
        "collapsing-roof",
        "falling-net",
        "fire-breathing-statue",
        "pits",
        "poison-darts",
        "poison-needle",
        "rolling-sphere",
        "sphere-of-annihilation",
      ),
      ...cards("poisons", "poisons", "sample-poisons"),
      ...cards(
        "diseases",
        "diseases",
        "sample-diseases",
        "cackle-fever",
        "sewer-plague",
        "sight-rot",
      ),
      ...cards("madness", "madness", "going-mad", "madness-effects", "curing-madness"),
    ],
  },
];

/** Every page id in tab order (FR-CMP-66): the curated ones, House rules, Pinned. */
export const RULE_PAGE_TABS: readonly { id: string; title: string }[] = [
  ...RULE_PAGES.map((p) => ({ id: p.id, title: p.title })),
  { id: HOUSE_PAGE_ID, title: "House rules" },
  { id: PINNED_PAGE_ID, title: "Pinned" },
];

/** FR-CMP-66: pins per browser and campaign, ≤ 30 ids. */
export const RULES_PINS_MAX = 30;
export const rulesPinsKey = (campaignId: string) => `pp.rules.pins.v1.${campaignId}`;
