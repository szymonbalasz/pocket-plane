// Trigger badges on Initiative rows and tokens (FR-CBTX-52, -53; MOD §6.5), pure over the store,
// both clients: one chip per `trigger-state` row the viewer holds for an active combatant that is
// `armed` (DM: every row; a player: own PCs' only, FR-MOD-55), in MOD's badge words
// (`triggerBadge`, FR-MOD-60). Uses left come from the sheet the viewer holds; the window's words
// ("… this round") from the `rule-trigger` row when loaded (lazy), else "this turn". MOD's token
// overlay line `mod-triggers` adds one lightning icon per token (seams S9).
import type { CombatantView } from "@shared/combat-tracker/schemas";
import {
  type PlayerRuleTriggerRecord,
  RULE_TRIGGER_TYPE,
} from "@shared/effect-modifiers/trigger-records";
import {
  TRIGGER_STATE_TYPE,
  type TriggerStateRecord,
  triggerBadge,
} from "@shared/effect-modifiers/trigger-state";
import type { TriggerEvery } from "@shared/effect-modifiers/triggers";
import type { RecordStore } from "@shared/protocol/store";
import { useMemo } from "react";
import { useSync } from "../../sync/store";
import { boundCombatant } from "../combat-tracker/token-overlay";
import type { TokenIcon, TokenOverlay } from "../scenes-map/token-overlays";
import { useTriggerRows } from "./roll-preview";
import { sheetIn } from "./store";

/** `data-state` of a chip: `uses` = a `feature` trigger showing its uses left (not waiting). */
export type TriggerChipState = "ready" | "used" | "waiting" | "uses";

export interface TriggerChip {
  /** The `trigger-state` row id (`data-record-id`). */
  id: string;
  triggerId: string;
  name: string;
  /** Uses left after the name ("2", "−1"), `feature` triggers only. */
  uses: { left: number; text: string } | null;
  state: TriggerChipState;
  /** Muted + check: used this window, or no use left. */
  muted: boolean;
  /** Uses below zero (FR-MOD-59): `hp.down`. */
  down: boolean;
  /** The state sentence (FR-MOD-60's words): "Ready", "Used this turn", "On Brakka's turn". */
  tooltip: string;
}

/** "−1" with a real minus sign. */
const count = (n: number) => (n < 0 ? `−${-n}` : String(n));

/** The rule's window: the loaded `rule-trigger` row, else `feature` from the copy, else a turn. */
function everyOf(store: RecordStore, row: TriggerStateRecord): TriggerEvery {
  const t = store.records[RULE_TRIGGER_TYPE]?.[row.triggerId] as
    | PlayerRuleTriggerRecord
    | undefined;
  if (t) return t.rule.every;
  return row.featureId ? { feature: row.featureId } : "turn";
}

/** `armed` rows the viewer holds for this combatant, by name. */
export function triggerRowsFor(store: RecordStore, combatantId: string): TriggerStateRecord[] {
  return (Object.values(store.records[TRIGGER_STATE_TYPE] ?? {}) as TriggerStateRecord[])
    .filter((r) => r.combatantId === combatantId && r.armed)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** FR-CBTX-52: the chips of one Initiative row (none for a removed combatant). */
export function triggerChipsFor(
  store: RecordStore,
  c: Pick<CombatantView, "id" | "name" | "active">,
): TriggerChip[] {
  if (c.active === false) return [];
  return triggerRowsFor(store, c.id).map((row) => {
    const every = everyOf(store, row);
    const feature =
      typeof every === "object"
        ? sheetIn(store, row.characterId)?.features.find((f) => f.id === every.feature)
        : undefined;
    const uses = feature?.usesMax
      ? { left: feature.usesMax - feature.used, max: feature.usesMax }
      : null;
    const badge = triggerBadge(row, { every, ownerName: c.name, needs: null, uses });
    const shown = uses && badge.state !== "waiting" ? uses.left : null;
    return {
      id: row.id,
      triggerId: row.triggerId,
      name: row.name,
      uses: shown === null ? null : { left: shown, text: count(shown) },
      state: shown === null ? (badge.state as TriggerChipState) : "uses",
      muted: badge.state === "used",
      down: badge.down === true,
      tooltip: badge.text,
    };
  });
}

/**
 * A used chip's words need its rule's window ("Used this round"): the lazy `rule-trigger` type is
 * asked for once a row the viewer holds is used (FR-MOD-47; until then "Used this turn").
 */
export function useTriggerWords(): void {
  const used = useSync((s) =>
    Object.values(s.store.records[TRIGGER_STATE_TYPE] ?? {}).some(
      (r) => (r as TriggerStateRecord).armed && (r as TriggerStateRecord).charge === "used",
    ),
  );
  useTriggerRows(used);
}

/** A row's chips (`useTriggerWords` included). */
export function useTriggerChips(c: Pick<CombatantView, "id" | "name" | "active">): TriggerChip[] {
  const store = useSync((s) => s.store);
  useTriggerWords();
  return useMemo(() => triggerChipsFor(store, c), [store, c]);
}

/** A chip in a list: "Divine Fury — ready", "Sneak Attack — used this turn". */
export const triggerLine = (t: TriggerChip) =>
  `${t.name} — ${t.tooltip.charAt(0).toLowerCase()}${t.tooltip.slice(1)}`;

export const TOKEN_TRIGGER_ID = "cbtx-token-trigger";

/** A ready-looking chip: ready (incl. `each`) or uses left > 0. */
const ready = (t: TriggerChip) => t.state === "ready" || (t.state === "uses" && !t.muted);

/**
 * FR-CBTX-53: one lightning icon for the token's triggers, or null. `value` = `ready` while any
 * is ready, else `used` (muted). Its label is the hover list; the icon row draws a label's first
 * glyph, so it leads with "↯" (the lightning) until M5's icon chips draw `icon` itself.
 */
export function tokenTriggerIcon(chips: readonly TriggerChip[]): TokenIcon | null {
  if (chips.length === 0) return null;
  return {
    id: TOKEN_TRIGGER_ID,
    icon: "zap",
    tone: "neutral",
    label: ["↯ Triggers", ...chips.map(triggerLine)].join("\n"),
    value: chips.some(ready) ? "ready" : "used",
  };
}

/** MOD's token overlay line (seams S9): the icon on a token bound to an active combatant. */
export const modTriggersOverlay: TokenOverlay = {
  id: "mod-triggers",
  decorate(token, store) {
    const c = boundCombatant(store, token.id);
    const icon = c ? tokenTriggerIcon(triggerChipsFor(store, c)) : null;
    return icon ? { icons: [icon] } : null;
  },
};
