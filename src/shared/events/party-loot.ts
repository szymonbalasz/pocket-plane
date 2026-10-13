// Domain events of party-loot (LOOT §9). All logged; none undoable or transient.
// The endpoint shape lives here so `@shared/party-loot` and the events share one definition.
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);

/** A coin move's end (LOOT §6): `characterId` present iff `kind = character`. */
export const Endpoint = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party") }),
  z.strictObject({ kind: z.literal("world") }),
  z.strictObject({ kind: z.literal("character"), characterId: Id }),
]);
export type Endpoint = z.infer<typeof Endpoint>;

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
