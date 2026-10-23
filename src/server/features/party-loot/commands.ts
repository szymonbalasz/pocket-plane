// party-loot commands (LOOT §6, §9): `loot.add` / `loot.edit` (DM), `loot.move` (DM, player),
// `loot.split` (DM, FR-PARTY-26), and the internal helper `partyLoot.add` (FR-LOOT-03) that runs
// in the caller's transaction. *(S9)* `loot.move` takes Stores ends (FR-LOOT-30, -33).
import { CoinMoved, CoinSplit, LootAdded, LootEdited } from "@shared/events/party-loot";
import {
  ITEM_EDIT_MESSAGE,
  LootSplitIntent,
  type LootSplitResult,
  SPLIT_TEXT,
} from "@shared/party-board/schemas";
import { splitCoins } from "@shared/party-board/split";
import { lootNotificationText, notifiesLoot } from "@shared/party-loot/format";
import {
  type Coins,
  coinsOf,
  type Endpoint,
  LOOT_ENTRY_TYPE,
  LOOT_RECEIVED_KIND,
  LootAddIntent,
  LootEditIntent,
  type LootEntryRecord,
  LootMoveIntent,
  type LootResult,
  PARTY_POT_TYPE,
  type PartyPotRecord,
  playerMayMove,
  WALLET_TYPE,
  type WalletRecord,
} from "@shared/party-loot/schemas";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound, zodIssues } from "../../commands/errors";
import { entity, lootEntry } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { notify } from "../notifications/helpers";
import { getEntry, insertLootEntry, partyPot, wallets } from "./rows";
import { requireStores, storesCoinChanges, storesCoinsBefore, storesIds } from "./stores";

export const LOOT_ADD = "loot.add";
export const LOOT_EDIT = "loot.edit";
export const LOOT_MOVE = "loot.move";
export const LOOT_SPLIT = "loot.split";

function campaignOf(env: CommandEnv): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

export const potChange = (before: PartyPotRecord, after: PartyPotRecord): RecordChange => ({
  type: PARTY_POT_TYPE,
  id: after.id,
  before,
  after,
});

const sameCoins = (a: Coins, b: Coins) =>
  a.cp === b.cp && a.sp === b.sp && a.ep === b.ep && a.gp === b.gp && a.pp === b.pp;

function insertEntry(
  env: CommandEnv,
  cid: string,
  kind: LootEntryRecord["kind"],
  from: Endpoint,
  to: Endpoint,
  text: string,
  coins: Coins,
): LootEntryRecord {
  return insertLootEntry(env, cid, { kind, from, to, text, coins: coinsOf(coins) });
}

/**
 * FR-LOOT-03: inserts a `loot` row (`world → party`), emits `LootAdded`, then `notify`s
 * `loot-received` iff no coin < 0 (FR-LOOT-13). In the caller's transaction: any failure rolls
 * all of it back. Input as `loot.add`; a bad input → `invalid`.
 */
export function add(env: CommandEnv, raw: LootAddIntent): LootResult {
  const parsed = LootAddIntent.safeParse(raw);
  if (!parsed.success) throw invalid("Invalid loot entry", zodIssues(parsed.error));
  const input = parsed.data;
  const cid = campaignOf(env);
  const coins = coinsOf(input);
  const potBefore = partyPot(env.tx, cid);
  const entry = insertEntry(
    env,
    cid,
    "loot",
    { kind: "world" },
    { kind: "party" },
    input.text,
    coins,
  );
  const potAfter = partyPot(env.tx, cid);
  const changes: RecordChange[] = [
    { type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry },
  ];
  // As edits: the pot only when its value changed (text-only loot leaves it as is).
  if (!sameCoins(potBefore, potAfter)) changes.push(potChange(potBefore, potAfter));
  env.emit({
    type: LootAdded.type,
    campaignId: cid,
    payload: { entryId: entry.id, text: entry.text, ...coins },
    changes,
  });
  if (notifiesLoot(coins)) {
    notify(env, {
      kind: LOOT_RECEIVED_KIND,
      audience: "all",
      text: lootNotificationText(entry.text, coins),
      payload: { entryId: entry.id },
    });
  }
  return { entryId: entry.id };
}

export const lootAdd = defineCommand({
  name: LOOT_ADD,
  input: LootAddIntent,
  execute: (input, env): LootResult => add(env, input),
});

export const lootEdit = defineCommand({
  name: LOOT_EDIT,
  input: LootEditIntent,
  execute({ entryId, text, ...rest }, env): void {
    const cid = campaignOf(env);
    const before = getEntry(env.tx, cid, entryId);
    if (!before) throw notFound("Loot entry not found");
    if (before.kind === "move") throw conflict("Moves can't be edited — move the coin back");
    // FR-PARTY-25: item rows are moves of things, corrected by a reverse move.
    if (before.kind === "item") throw conflict(ITEM_EDIT_MESSAGE);
    const coins = coinsOf(rest);
    // FR-LOOT-04: same values → ack, no write, no event.
    if (before.text === text && sameCoins(before, coins)) return;
    const potBefore = partyPot(env.tx, cid);
    env.tx
      .update(lootEntry)
      .set({ text, ...coins, editedAt: env.ctx.clock.iso() })
      .where(eq(lootEntry.id, entryId))
      .run();
    const after = getEntry(env.tx, cid, entryId) as LootEntryRecord;
    const potAfter = partyPot(env.tx, cid);
    const changes: RecordChange[] = [{ type: LOOT_ENTRY_TYPE, id: entryId, before, after }];
    if (!sameCoins(potBefore, potAfter)) changes.push(potChange(potBefore, potAfter));
    env.emit({
      type: LootEdited.type,
      campaignId: cid,
      payload: {
        entryId,
        before: { text: before.text, ...coinsOf(before) },
        after: { text, ...coins },
      },
      changes,
    });
  },
});

/** Owner of a character of the campaign, or `not_found` (FR-LOOT-06). */
function characterOwner(env: CommandEnv, cid: string, characterId: string): string | null {
  const row = env.tx
    .select({ kind: entity.kind, owner: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, cid)))
    .get();
  if (row?.kind !== "character") throw notFound("Character not found");
  return row.owner;
}

/**
 * Changes of one or more coin entries: the entries, `party-pot` iff touched, one `wallet` per
 * character, *(S9)* one `stores-coin` per Stores (FR-LOOT-08, -31).
 */
export function coinMoveChanges(
  env: CommandEnv,
  cid: string,
  entries: readonly LootEntryRecord[],
  before: {
    pot: PartyPotRecord | null;
    wallets: Map<string, WalletRecord>;
    characterIds: readonly string[];
    stores: ReturnType<typeof storesCoinsBefore>;
  },
): RecordChange[] {
  const changes: RecordChange[] = entries.map((entry) => ({
    type: LOOT_ENTRY_TYPE,
    id: entry.id,
    before: null,
    after: entry,
  }));
  if (before.pot) changes.push(potChange(before.pot, partyPot(env.tx, cid)));
  const walletsAfter = new Map(wallets(env.tx, cid).map((w) => [w.id, w] as const));
  for (const characterId of before.characterIds) {
    changes.push({
      type: WALLET_TYPE,
      id: characterId,
      before: before.wallets.get(characterId) ?? null,
      after: walletsAfter.get(characterId) as WalletRecord,
    });
  }
  changes.push(...storesCoinChanges(env, cid, before.stores));
  return changes;
}

export const lootMove = defineCommand({
  name: LOOT_MOVE,
  input: LootMoveIntent,
  roles: ["dm", "player"],
  execute({ from, to, text, ...rest }, env): LootResult {
    const cid = campaignOf(env);
    const owners = new Map<string, string | null>();
    for (const e of [from, to]) {
      if (e.kind === "character")
        owners.set(e.characterId, characterOwner(env, cid, e.characterId));
      // FR-LOOT-30 / -33: a gone Stores, or a hidden one for a player → `not_found`.
      if (e.kind === "stores") requireStores(env, cid, e.strongholdId);
    }
    if (env.actor.role === "player") {
      const me = env.actor.playerId;
      const owns = (e: Endpoint) =>
        e.kind === "character" && me !== null && owners.get(e.characterId) === me;
      if (!playerMayMove(from, to, owns)) throw forbidden("You can't move that coin");
    }
    const coins = coinsOf(rest);
    const touchesParty = from.kind === "party" || to.kind === "party";
    const before = {
      pot: touchesParty ? partyPot(env.tx, cid) : null,
      wallets: new Map(wallets(env.tx, cid).map((w) => [w.id, w] as const)),
      characterIds: [...owners.keys()],
      stores: storesCoinsBefore(env, cid, storesIds(from, to)),
    };
    const entry = insertEntry(env, cid, "move", from, to, text, coins);
    env.emit({
      type: CoinMoved.type,
      campaignId: cid,
      payload: { entryId: entry.id, from, to, text, ...coins },
      changes: coinMoveChanges(env, cid, [entry], before),
    });
    return { entryId: entry.id };
  },
});

/**
 * FR-PARTY-26: ⌊coin / n⌋ per denomination to each character, the remainder stays in the pot. One
 * `move` row `party → character` (text "Split") per character, in list order; no balance check
 * (#150). Changes: the entries, `party-pot`, each character's `wallet`. No notification.
 */
export const lootSplit = defineCommand({
  name: LOOT_SPLIT,
  input: LootSplitIntent,
  execute({ characterIds, ...rest }, env): LootSplitResult {
    const cid = campaignOf(env);
    for (const id of characterIds) characterOwner(env, cid, id);
    // The intent guarantees a non-empty list and some share > 0 ("Nothing to split").
    const { share } = splitCoins(coinsOf(rest), characterIds.length) as { share: Coins };
    const before = {
      pot: partyPot(env.tx, cid),
      wallets: new Map(wallets(env.tx, cid).map((w) => [w.id, w] as const)),
      characterIds,
      stores: new Map(),
    };
    const party: Endpoint = { kind: "party" };
    const created = characterIds.map((characterId) =>
      insertEntry(env, cid, "move", party, { kind: "character", characterId }, SPLIT_TEXT, share),
    );
    const entryIds = created.map((e) => e.id);
    env.emit({
      type: CoinSplit.type,
      campaignId: cid,
      payload: { entryIds, characterIds, shares: share },
      changes: coinMoveChanges(env, cid, created, before),
    });
    return { entryIds };
  },
});
