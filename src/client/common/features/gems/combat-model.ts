// FR-GEM-34 (GM2): the Combat gem card action's model: pure reads of the synced store. Which card
// shows "Combat gem" for this viewer, the dice it offers (base + extra weapon parts, never mods /
// triggers), the level limit and the `gem.spend` payload. The server decides (FR-GEM-25–28); the
// client only decides what to draw.

import type { CardPartRef } from "@shared/combat-tracker/schemas";
import {
  COMBATANT_TYPE,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { combatDiceLevel, combatDiceLimit, GEM_SPEND_INTENT } from "@shared/gems/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { You } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import { gemsRow } from "./model";

type Records = Pick<RecordStore, "you" | "records">;

interface CharacterLike {
  id: string;
  kind: string;
  name: string;
  ownerPlayerId: string | null;
  /** Players' view of a character carries `level`; the DM's has the stat block. */
  level?: number;
  statBlock?: { level?: number };
}

/** One die of a part as the picker draws it. */
export interface PickDie {
  part: CardPartRef;
  index: number;
  /** null = unknown (the roll's line is out of the client's window). */
  faces: number | null;
  /** null = entered as a physical total (FR-GEM-28: asked first). */
  value: number | null;
  kept: boolean;
}

export interface PickPart {
  part: CardPartRef;
  /** The part's damage type, shown when the card has more than one part (FR-GEM-30). */
  type: string | null;
  dice: PickDie[];
  /** The dice's kept sum the stored roll holds (a physical total's per-die values must match). */
  diceTotal: number;
}

/** A die's key in the picker (`base:0`, `0:1`). */
export const dieKey = (d: { part: CardPartRef; index: number }) => `${d.part}:${d.index}`;

/** The card's payload if it can take a Combat gem now (pending, damage, not maxed). */
export function openCard(card: NotificationRecord): DamageCardPayload | null {
  if (card.kind !== DAMAGE_CARD_KIND || card.state !== "pending") return null;
  const p = DamageCardPayload.safeParse(card.payload);
  if (!p.success || !p.data.damage || p.data.diceMaxed) return null;
  return p.data;
}

/** The character behind the card's attacker (OQ-GEM-15 A: characters only), if this viewer spends. */
export function cardCharacter(
  store: Records,
  p: DamageCardPayload,
  you: You,
): { id: string; name: string; level: number } | null {
  const c = (store.records[COMBATANT_TYPE] as Record<string, { entityId?: string | null }>)?.[
    p.attackerId
  ];
  const id = c?.entityId;
  if (!id) return null;
  const e = (store.records[ENTITY_TYPE] as Record<string, CharacterLike> | undefined)?.[id];
  if (e?.kind !== "character") return null;
  if (you.role !== "dm" && e.ownerPlayerId !== you.playerId) return null;
  return { id: e.id, name: e.name, level: e.level ?? e.statBlock?.level ?? 1 };
}

/** The roll's dice faces from its log line (the card keeps `[value, kept]` only). */
export function facesOf(store: Records, rollId: string): number[] | null {
  const entries = store.records[GAME_LOG_ENTRY_TYPE] as
    | Record<string, { rollIds: string[]; payload: unknown }>
    | undefined;
  for (const e of Object.values(entries ?? {})) {
    if (!e.rollIds.includes(rollId) || !Array.isArray(e.payload)) continue;
    const item = (e.payload as RollPayloadItem[]).find((i) => i.rollId === rollId);
    if (item) return item.dice.map((d) => d.faces);
  }
  return null;
}

/** FR-GEM-27: the weapon parts the gem may touch: the base part, then each extra part. */
export function pickParts(store: Records, p: DamageCardPayload): PickPart[] {
  const damage = p.damage;
  if (!damage) return [];
  const mods = (damage.mods ?? []).reduce((s, m) => s + m.value, 0);
  const parts = [
    {
      part: "base" as const,
      type: p.damageType,
      roll: damage,
      diceTotal: damage.total - damage.constant - mods,
    },
    ...(damage.extra ?? []).map((x, i) => ({
      part: i as CardPartRef,
      type: x.type as string,
      roll: x,
      diceTotal: x.total - x.constant,
    })),
  ];
  return parts.map(({ part, type, roll, diceTotal }) => {
    const faces = facesOf(store, roll.rollId);
    return {
      part,
      type,
      diceTotal,
      dice: roll.dice.map(([value, kept], index) => ({
        part,
        index,
        faces: faces?.[index] ?? null,
        value,
        kept,
      })),
    };
  });
}

/** A die the gem may still raise (unknown faces: the server decides). */
export const canMax = (d: PickDie, value = d.value) =>
  d.kept && (d.faces === null || value === null || value < d.faces);

/** FR-GEM-34: "Combat gem" on this card for this viewer? */
export function combatAvailable(store: Records, card: NotificationRecord, you: You): boolean {
  const p = openCard(card);
  if (!p) return false;
  const ch = cardCharacter(store, p, you);
  if (!ch || (gemsRow(store, ch.id)?.combat ?? 0) < 1) return false;
  return pickParts(store, p).some((part) => part.dice.some((d) => canMax(d)));
}

/** FR-GEM-26: how many dice this character may max, and the hint past it. */
export function pickLimit(level: number): { limit: number; next: string | null } {
  const limit = combatDiceLimit(level);
  return {
    limit,
    next: limit < 3 ? `Level ${combatDiceLevel(limit + 1)} for ${limit + 1} dice` : null,
  };
}

/**
 * FR-GEM-28 (OQ-GEM-13 A): a physical total's dice as typed: null while incomplete; else the
 * values or the mismatch to show.
 */
export function typedDice(
  part: PickPart,
  texts: readonly string[],
): { values: number[] } | { error: string } | null {
  if (texts.length < part.dice.length || texts.some((t) => t.trim() === "")) return null;
  const values = texts.map((t) => Number(t));
  const bad = values.some(
    (v, i) =>
      !Number.isInteger(v) ||
      v < 1 ||
      (part.dice[i]?.faces !== null && v > (part.dice[i]?.faces ?? Number.POSITIVE_INFINITY)),
  );
  if (bad) return { error: "Each die between 1 and its faces" };
  const sum = values.reduce((s, v, i) => s + (part.dice[i]?.kept ? v : 0), 0);
  if (sum !== part.diceTotal) return { error: `The dice add up to ${sum}, not ${part.diceTotal}` };
  return { values };
}

/** The `gem.spend` payload: the picked dice and the typed values of total-only parts. */
export function combatPayload(
  characterId: string,
  cardId: string,
  picked: readonly { part: CardPartRef; index: number }[],
  known: readonly { part: CardPartRef; dice: number[] }[],
) {
  const parts = new Set(picked.map((d) => d.part));
  const needed = known.filter((k) => parts.has(k.part));
  return {
    name: GEM_SPEND_INTENT,
    payload: {
      characterId,
      gem: "combat" as const,
      cardId,
      dice: picked.map((d) => ({ part: d.part, index: d.index })),
      ...(needed.length ? { known: needed } : {}),
    },
  };
}
