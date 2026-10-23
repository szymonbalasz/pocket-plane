// Domain events of party-loot (LOOT §9). All logged; none undoable or transient.
// The endpoint shape lives here so `@shared/party-loot` and the events share one definition.
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);

/** Stored end kinds (LOOT §8; `stores` = a stronghold's Stores, FR-LOOT-30). */
export const ENDPOINT_KINDS = ["party", "world", "character", "stores"] as const;

const endpointOptions = [
  z.strictObject({ kind: z.literal("party") }),
  z.strictObject({ kind: z.literal("world") }),
  z.strictObject({ kind: z.literal("character"), characterId: Id }),
  z.strictObject({ kind: z.literal("stores"), strongholdId: Id }),
] as const;

/**
 * A coin move's end (LOOT §6): `characterId` present iff `kind = character`; *(S9)*
 * `strongholdId` iff `kind = stores` (FR-LOOT-30).
 */
export const Endpoint = z.discriminatedUnion("kind", [...endpointOptions]);
export type Endpoint = z.infer<typeof Endpoint>;

/**
 * A `loot-entry` end on the wire (FR-LOOT-32): an `Endpoint`, or the wire-only `outside` a player
 * gets for a DM-only Stores end ("Outside the party"). Never stored, never accepted in an intent.
 */
export const WireEndpoint = z.discriminatedUnion("kind", [
  ...endpointOptions,
  z.strictObject({ kind: z.literal("outside") }),
]);
export type WireEndpoint = z.infer<typeof WireEndpoint>;

/** `loot-entry` kinds (LOOT §8; `item` = a party-board item move, FR-PARTY-25). */
export const LOOT_ENTRY_KINDS = ["loot", "move", "item"] as const;
export const LootEntryKind = z.enum(LOOT_ENTRY_KINDS);
export type LootEntryKind = z.infer<typeof LootEntryKind>;

const Coin = z.int();
const Coins = { cp: Coin, sp: Coin, ep: Coin, gp: Coin, pp: Coin };
const LootValues = z.strictObject({ text: z.string(), ...Coins });

/** `partyLoot.add`: changes = `loot-entry` (before null) + `party-pot` iff its value changed. */
export const LootAdded = defineEvent({
  type: "LootAdded",
  payload: z.strictObject({ entryId: Id, text: z.string(), ...Coins }),
  logged: true,
  undoable: false,
});

/** `loot.edit`: changes = `loot-entry` + `party-pot` iff its value changed. */
export const LootEdited = defineEvent({
  type: "LootEdited",
  payload: z.strictObject({ entryId: Id, before: LootValues, after: LootValues }),
  logged: true,
  undoable: false,
});

/** `loot.move`: changes = `loot-entry` (before null), `party-pot` iff an end is party, `wallet` per character end. */
export const CoinMoved = defineEvent({
  type: "CoinMoved",
  payload: z.strictObject({
    entryId: Id,
    from: Endpoint,
    to: Endpoint,
    text: z.string(),
    ...Coins,
  }),
  logged: true,
  undoable: false,
});

/**
 * `loot.split` (FR-PARTY-26): one `move` row `party → character` per character, in list order.
 * `shares` = each character's share per coin. Changes = the entries (before null), `party-pot`,
 * each character's `wallet`.
 */
export const CoinSplit = defineEvent({
  type: "CoinSplit",
  payload: z.strictObject({
    entryIds: z.array(Id).min(1),
    characterIds: z.array(Id).min(1),
    shares: z.strictObject(Coins),
  }),
  logged: true,
  undoable: false,
});
