// FR-DICE-97 / FR-CBT-174 (sprint 15, #385, ADR-0073 decision 2): the DM's game-log actions
// "Use as attack" / "Use as damage" on an unused roll line (players never get them). The client's
// checks mirror the server's `cbt.useRoll` (FR-CBT-173) only to decide what to draw; the server
// decides. `run` resolves the attacker from the line's actor: known and nothing to type → the
// intent at once, then the DM's popup opens on the card; otherwise the popup opens on its "Use
// roll" step. Combat's DM popup listens to `useUseRollRequest` (this side never imports `@dm`).

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  CBT_INTENTS,
  COMBATANT_TYPE,
  type CombatantView,
  type UseRollAs,
  type UseRollInput,
  UseRollResult,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  type GameLogEntryView,
  isUsedRoll,
  RollEntryPayload,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { You } from "@shared/protocol/frames";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { DropletIcon, SwordsIcon } from "lucide-react";
import { create } from "zustand";
import type { EntryAction, EntryActionContext } from "../dice-roll-log/entry-actions";
import { startedIn } from "./store";

/** FR-DICE-97 (as the server's `attackItemOf`): the item tagged `attack`, else the first d20. */
export const attackItemOf = (items: readonly RollPayloadItem[]): RollPayloadItem | undefined =>
  items.find((i) => i.purpose === "attack") ?? items.find((i) => i.natural !== null);

/** FR-DICE-97 (as the server's `damageItemsOf`): tagged `damage`, else every item without a d20. */
export function damageItemsOf(items: readonly RollPayloadItem[]): RollPayloadItem[] {
  const tagged = items.filter((i) => i.purpose === "damage");
  return tagged.length > 0 ? tagged : items.filter((i) => i.natural === null);
}

/** A `roll` line's items ([] when unreadable). */
export function entryItems(entry: GameLogEntryView): RollPayloadItem[] {
  const p = RollEntryPayload.safeParse(entry.payload);
  return p.success ? p.data : [];
}

/** FR-CBT-173: the damage items the DM types in the step (no `part.type` of their own). */
export const untypedItems = (entry: GameLogEntryView): RollPayloadItem[] =>
  damageItemsOf(entryItems(entry)).filter((i) => (i.part?.type ?? null) === null);

/**
 * FR-DICE-97: show Use as `as` on this line? The DM, a started encounter, an unused `roll` line
 * (not undone or rerolled), with an attack item (attack) or 1–3 damage items (damage).
 */
export function canUseRoll(
  as: UseRollAs,
  store: RecordStore,
  entry: GameLogEntryView,
  you: You,
): boolean {
  if (you.role !== "dm" || !startedIn(store)) return false;
  if (entry.kind !== ROLL_KIND || entry.undone || entry.supersededBy !== null) return false;
  if (isUsedRoll(entry)) return false;
  const items = entryItems(entry);
  if (as === "attack") return attackItemOf(items) !== undefined;
  const n = damageItemsOf(items).length;
  return n >= 1 && n <= 3;
}

/** The started encounter's combatants still in the fight, initiative order (DM `position`). */
export function fightersOf(store: RecordStore): CombatantView[] {
  const enc = startedIn(store);
  if (!enc) return [];
  return recordsOf<CombatantView>(store, COMBATANT_TYPE)
    .filter((c) => c.encounterId === enc.id && c.active !== false && !c.removed)
    .sort(
      (a, b) =>
        (a.position ?? a.playerPosition ?? 0) - (b.position ?? b.playerPosition ?? 0) ||
        (a.seq ?? 0) - (b.seq ?? 0),
    );
}

const only = (cs: readonly CombatantView[]): string | null =>
  cs.length === 1 ? (cs[0] as CombatantView).id : null;

/**
 * FR-CBT-174: the attacker a line's actor names, or null (the DM picks). A log line keeps only the
 * actor's name: a player's roll as "me" (their name) → their PC combatant iff exactly one; else
 * the one combatant of that name (a `{combatantId}` roll), the one bound to a token of that name,
 * or the one combatant of an entity of that name.
 */
export function resolveAttacker(store: RecordStore, entry: GameLogEntryView): string | null {
  const fighters = fightersOf(store);
  const name = entry.actorName;
  if (entry.rollerRole === "player" && entry.rollerPlayerId !== null) {
    const me = recordsOf<PlayerRecord>(store, "player").find((p) => p.id === entry.rollerPlayerId);
    if (me?.name === name) {
      const owned = new Set(
        recordsOf<{ id: string; ownerPlayerId?: string | null }>(store, ENTITY_TYPE)
          .filter((e) => e.ownerPlayerId === entry.rollerPlayerId)
          .map((e) => e.id),
      );
      return only(fighters.filter((c) => c.kind === "pc" && owned.has(c.entityId ?? "")));
    }
  }
  const named = only(fighters.filter((c) => c.name === name));
  if (named) return named;
  const tokens = new Set(
    recordsOf<{ id: string; name: string }>(store, TOKEN_TYPE)
      .filter((t) => t.name === name)
      .map((t) => t.id),
  );
  const bound = only(fighters.filter((c) => c.tokenId !== null && tokens.has(c.tokenId)));
  if (bound) return bound;
  const entities = new Set(
    recordsOf<{ id: string; name: string }>(store, ENTITY_TYPE)
      .filter((e) => e.name === name)
      .map((e) => e.id),
  );
  return only(fighters.filter((c) => c.entityId != null && entities.has(c.entityId)));
}

/** The popup's "Use roll" step (FR-CBT-174): the line, as what, the attacker resolved (or null). */
export interface UseRollStepRequest {
  entryId: string;
  as: UseRollAs;
  attackerId: string | null;
}

/** What the DM's popup opens next: the made card, or the step. */
export type UseRollOpen = { cardId: string } | { step: UseRollStepRequest };

interface UseRollRequests {
  open: UseRollOpen | null;
  /** Bumped per request, so the same request again reopens. */
  n: number;
  request(open: UseRollOpen): void;
}

/** Combat's DM popup subscribes (`popup-store.ts`); nothing else reads it. */
export const useUseRollRequest = create<UseRollRequests>()((set) => ({
  open: null,
  n: 0,
  request: (open) => set((s) => ({ open, n: s.n + 1 })),
}));

/** FR-CBT-173: the intent for a step's picks (`types` only when some item is untyped). */
export function intentForRoll(
  entry: GameLogEntryView,
  as: UseRollAs,
  attackerId: string,
  picked: Readonly<Record<string, UseRollType>> = {},
): UseRollInput {
  if (as === "attack") return { entryId: entry.id, as, attackerId };
  const items = damageItemsOf(entryItems(entry));
  const untyped = items.filter((i) => (i.part?.type ?? null) === null);
  if (untyped.length === 0) return { entryId: entry.id, as, attackerId };
  const types = items.map((i) =>
    (i.part?.type ?? null) === null ? (picked[i.rollId] ?? null) : null,
  );
  return { entryId: entry.id, as, attackerId, types };
}
export type UseRollType = NonNullable<NonNullable<UseRollInput["types"]>[number]>;

/**
 * FR-CBT-174: the action's run. Attacker resolved and nothing to type → `cbt.useRoll` at once,
 * the popup on the card; otherwise the popup's step (nothing written before Make card).
 */
export async function runUseRoll(
  as: UseRollAs,
  entry: GameLogEntryView,
  { store, send }: Pick<EntryActionContext, "store" | "send">,
): Promise<void> {
  const attackerId = resolveAttacker(store, entry);
  const { request } = useUseRollRequest.getState();
  if (attackerId === null || (as === "damage" && untypedItems(entry).length > 0)) {
    request({ step: { entryId: entry.id, as, attackerId } });
    return;
  }
  const r = UseRollResult.parse(
    await send(CBT_INTENTS.useRoll, intentForRoll(entry, as, attackerId)),
  );
  request({ cardId: r.cardId });
}

export const USE_AS_ATTACK = "Use as attack";
export const USE_AS_DAMAGE = "Use as damage";

export const useAsAttackAction: EntryAction = {
  id: "cbt.useAsAttack",
  order: 20,
  clients: ["dm"],
  available: (store, entry, you) => canUseRoll("attack", store, entry, you),
  Icon: SwordsIcon,
  label: USE_AS_ATTACK,
  run: (entry, ctx) => runUseRoll("attack", entry, ctx),
};

export const useAsDamageAction: EntryAction = {
  id: "cbt.useAsDamage",
  order: 21,
  clients: ["dm"],
  available: (store, entry, you) => canUseRoll("damage", store, entry, you),
  Icon: DropletIcon,
  label: USE_AS_DAMAGE,
  run: (entry, ctx) => runUseRoll("damage", entry, ctx),
};
