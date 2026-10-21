// Gems UI model (GEM §7, CHARX FR-CHARX-71–73, CAMP FR-CAMP-43): pure reads of the synced store
// and the Spend menu's choices. No rule lives here: the server checks owner, counts and the switch;
// the client only decides what to draw and which `gem.spend` payload a menu item sends.
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  ACTION_USES,
  type ActionUse,
  CHARACTER_GEMS_TYPE,
  type CharacterGemsRecord,
  GEM_KINDS,
  GEM_NAME,
  type GemKind,
  spendCost,
} from "@shared/gems/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { isFeatureOn } from "../campaign-management/use-feature";

type Records = Pick<RecordStore, "you" | "records">;

export type GemCounts = Record<GemKind, number>;

const ZERO: GemCounts = { inspiration: 0, fortune: 0, combat: 0, divine: 0, action: 0 };

/** FR-GEM-06: a character's `character-gems` row (a stable reference for selectors), if any. */
export function gemsRow(store: Records, characterId: string): CharacterGemsRecord | undefined {
  const byId = store.records[CHARACTER_GEMS_TYPE] as
    | Record<string, CharacterGemsRecord>
    | undefined;
  return byId?.[characterId];
}

/** A row's counts; no row yet (created on the first award) = all 0. */
export function countsOf(row: CharacterGemsRecord | undefined): GemCounts {
  if (!row) return ZERO;
  return {
    inspiration: row.inspiration,
    fortune: row.fortune,
    combat: row.combat,
    divine: row.divine,
    action: row.action,
  };
}

/** FR-CHARX-71 `available`: gems on (FR-CAMP-45) and the creature is a character. */
export function gemSectionAvailable(store: Records, creatureId: string): boolean {
  if (!isFeatureOn(store, GEMS_FEATURE)) return false;
  const e = (store.records.entity as Record<string, { kind?: string }> | undefined)?.[creatureId];
  return e?.kind === "character";
}

/** FR-GEM-12, OQ-GEM-14 A: the DM spends for anyone; a player only for their own character. */
export function maySpend(store: Records, characterId: string): boolean {
  const you = store.you;
  if (you?.role === "dm") return true;
  const e = (
    store.records.entity as Record<string, { ownerPlayerId?: string | null }> | undefined
  )?.[characterId];
  return !!you?.playerId && e?.ownerPlayerId === you.playerId;
}

/** FR-GEM-35 (OQ-GEM-03 B): the lucide icon per gem, by name (the component maps it). */
export const GEM_ICON: Record<GemKind, "sparkles" | "coins" | "swords" | "eye" | "zap"> = {
  inspiration: "sparkles",
  fortune: "coins",
  combat: "swords",
  divine: "eye",
  action: "zap",
};

/** FR-CHARX-72: chip Tooltips name the gem and say where it is spent. */
export const GEM_TIP: Record<GemKind, string> = {
  inspiration: "Inspiration: reroll a d20 from its log line, or spend it to recall",
  fortune: "Fortune: searching for treasure",
  combat: "Combat: max a damage die on a pending damage card",
  divine: "Divine Knowledge: ask the gods a question",
  action: "Action: a bonus action or reaction (1), a full action (2)",
};

/** FR-GEM-08 (OQ-GEM-11 D): the static label and its Tooltip; nothing else marks a count over 5. */
export const MAX_LABEL = "max 5";
export const MAX_TIP = "A table rule, not enforced";

export interface GemChip {
  gem: GemKind;
  name: string;
  count: number;
  /** Zeros muted (FR-CHARX-72); never an over-limit style (FR-GEM-08). */
  muted: boolean;
  /** `aria-label` (FR-GEM-35): the name and the count. */
  label: string;
}

/** FR-CHARX-72: the five chips in the fixed order. */
export function gemChips(counts: GemCounts): GemChip[] {
  return GEM_KINDS.map((gem) => ({
    gem,
    name: GEM_NAME[gem],
    count: counts[gem],
    muted: counts[gem] === 0,
    label: `${GEM_NAME[gem]}: ${counts[gem]}`,
  }));
}

/** A plain spend (GM0's `gem.spend`): the menu item, its payload and its cost. */
export interface SpendChoice {
  /** `gem-spend` `data-value`: the gem, or `action:<use>`. */
  value: string;
  gem: GemKind;
  use?: ActionUse;
  /** Menu text. */
  label: string;
  /** The confirm's question. */
  ask: string;
  cost: number;
}

const ACTION_LABEL: Record<ActionUse, string> = {
  bonus: "Bonus action",
  reaction: "Reaction",
  action: "Action",
};

/**
 * FR-CHARX-72, FR-GEM-14–16, OQ-GEM-06 A, -12 A: Fortune, Divine Knowledge, Action (Bonus action
 * (1) / Reaction (1) / Action (2)), Inspiration "to recall". The reroll and the Combat gem are the
 * log's and the card's actions (GM1 / GM2), never this menu.
 */
export const SPEND_CHOICES: readonly SpendChoice[] = [
  {
    value: "fortune",
    gem: "fortune",
    label: "Fortune",
    ask: "Spend a Fortune gem?",
    cost: 1,
  },
  {
    value: "divine",
    gem: "divine",
    label: "Divine Knowledge",
    ask: "Spend a Divine Knowledge gem?",
    cost: 1,
  },
  ...ACTION_USES.map((use) => {
    const cost = spendCost("action", use);
    return {
      value: `action:${use}`,
      gem: "action" as const,
      use,
      label: `${ACTION_LABEL[use]} (${cost})`,
      ask: cost === 1 ? "Spend an Action gem?" : `Spend ${cost} Action gems?`,
      cost,
    };
  }),
  {
    value: "inspiration",
    gem: "inspiration",
    label: "Inspiration: to recall",
    ask: "Spend an Inspiration gem?",
    cost: 1,
  },
];

/** The `gem.spend` payload a choice sends (`GemSpendInput`). */
export const spendPayload = (characterId: string, c: SpendChoice) => ({
  characterId,
  gem: c.gem,
  ...(c.use ? { use: c.use } : {}),
});

/** A choice is offered while enough are held (the server still decides, FR-GEM-12). */
export const affordable = (counts: GemCounts, c: SpendChoice) => counts[c.gem] >= c.cost;

/** FR-GEM-17: the confirm waits this long, then resets. */
export const CONFIRM_MS = 4000;
