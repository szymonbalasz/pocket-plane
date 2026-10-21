// FR-GEM-33 (GM1): the game log's "Inspiration: reroll" entry action (FR-DICE-68) on an eligible
// line, for the owner and the DM, while the character holds ≥ 1 Inspiration gem and gems are on.
// The client's check mirrors the server's (FR-GEM-18) only to decide what to draw; the server
// decides. Physical-dice mode asks for the new d20 (adv / dis: both) or "Roll for me" (FR-GEM-21).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  HIT_RULING_TYPE,
  type HitRulingRecord,
} from "@shared/combat-tracker/schemas";
import { inRerollWindow, rerollableRoll } from "@shared/dice-roll-log/reroll";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  RollEntryPayload,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import {
  CHARACTER_GEMS_TYPE,
  type CharacterGemsRecord,
  GEM_SPEND_INTENT,
} from "@shared/gems/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { You } from "@shared/protocol/frames";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { SparklesIcon } from "lucide-react";
import type { EntryAction } from "../dice-roll-log/entry-actions";

interface CharacterLike {
  id: string;
  kind: string;
  name: string;
  ownerPlayerId: string | null;
}

/** The d20 item a reroll takes (FR-DICE-70), or null. */
export function rerollItem(entry: GameLogEntryView): RollPayloadItem | null {
  const rollId = rerollableRoll(entry);
  const items = RollEntryPayload.safeParse(entry.payload);
  if (!rollId || !items.success) return null;
  return items.data.find((i) => i.rollId === rollId) ?? null;
}

/** The character the line is for (its actor), if this viewer may spend its gems. */
export function rerollCharacter(
  store: RecordStore,
  entry: GameLogEntryView,
  you: You,
): CharacterLike | null {
  const ch = recordsOf<CharacterLike>(store, ENTITY_TYPE).find(
    (e) => e.kind === "character" && e.name === entry.actorName,
  );
  if (!ch) return null;
  return you.role === "dm" || ch.ownerPlayerId === you.playerId ? ch : null;
}

/** FR-GEM-18: a combat to-hit only while its card is pending and unruled (what this viewer holds). */
function cardOpen(store: RecordStore, rollId: string): boolean {
  let card: NotificationRecord | undefined;
  let ruled = false;
  for (const n of recordsOf<NotificationRecord>(store, "notification")) {
    if (n.kind !== DAMAGE_CARD_KIND) continue;
    const p = DamageCardPayload.safeParse(n.payload);
    if (p.success && p.data.toHit?.rollId === rollId) {
      card = n;
      ruled = p.data.ruled === true;
      break;
    }
  }
  if (card?.state !== "pending" || ruled) return false;
  // The DM's own record (cards ruled before the `ruled` flag existed).
  const id = card.id;
  return !recordsOf<HitRulingRecord>(store, HIT_RULING_TYPE).some((r) => r.cardId === id);
}

const newestCache = new WeakMap<object, number>();

/** The newest entry `n` this client holds (the store's entry map, cached per map). */
function newestN(store: RecordStore): number {
  const map = store.records[GAME_LOG_ENTRY_TYPE];
  if (!map) return 0;
  let n = newestCache.get(map);
  if (n === undefined) {
    n = 0;
    for (const e of Object.values(map) as { n: number }[]) if (e.n > n) n = e.n;
    newestCache.set(map, n);
  }
  return n;
}

/** FR-GEM-33: show "Inspiration: reroll" on this line for this viewer? */
export function rerollAvailable(store: RecordStore, entry: GameLogEntryView, you: You): boolean {
  const item = rerollItem(entry);
  // OQ-GEM-20 A: death / concentration saves state their outcome (`note`) and stay as rolled.
  if (!item || item.note !== undefined) return false;
  // The server's window rule on this client's newest line (live logs outgrow the snapshot's 100).
  if (!inRerollWindow(entry.n, Math.max(entry.n, newestN(store)))) return false;
  const ch = rerollCharacter(store, entry, you);
  if (!ch) return false;
  const gems = recordsOf<CharacterGemsRecord>(store, CHARACTER_GEMS_TYPE).find(
    (g) => g.characterId === ch.id,
  );
  if (!gems || gems.inspiration < 1) return false;
  if (entry.category === "attack" && entry.encounterId !== null)
    return cardOpen(store, item.rollId);
  return true;
}

export const gemRerollAction: EntryAction = {
  id: "gem.reroll",
  order: 10,
  feature: GEMS_FEATURE,
  available: rerollAvailable,
  Icon: SparklesIcon,
  label: "Inspiration: reroll",
  confirm: "Spend?",
  roll(entry) {
    const item = rerollItem(entry);
    if (!item) return null;
    return {
      expression: "1d20",
      mode: item.mode,
      category: entry.category,
      label: `${entry.actorName} — ${item.label ?? item.expression} (reroll)`,
    };
  },
  run(entry, { store, send, manual }) {
    const you = store.you;
    const ch = you ? rerollCharacter(store, entry, you) : null;
    if (!ch) return Promise.resolve(undefined);
    return send(GEM_SPEND_INTENT, {
      characterId: ch.id,
      gem: "inspiration",
      entryId: entry.id,
      ...(manual ? { manual } : {}),
    });
  },
};
