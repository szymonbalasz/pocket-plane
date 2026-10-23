// *(S9)* Stores ends (FR-LOOT-30, -33; ADR-0066): a `stores` end must be a stronghold of the
// campaign ("Stores are gone"); a player's end must also be shown (a DM-only one answers the same
// `not_found`, never revealing it exists). Changes of the derived `stores-coin` per Stores end.
import { STORES_GONE_MESSAGE } from "@shared/party-board/schemas";
import { STORES_COIN_TYPE, type StoresCoinRecord } from "@shared/party-loot/schemas";
import { and, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import { stronghold } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { storesCoinOf } from "./rows";

/** FR-LOOT-30 / -33: the stronghold behind a Stores end, checked at commit; else `not_found`. */
export function requireStores(
  env: CommandEnv,
  cid: string,
  strongholdId: string,
): { id: string; dmOnly: boolean } {
  const row = env.tx
    .select({ id: stronghold.id, dmOnly: stronghold.dmOnly })
    .from(stronghold)
    .where(and(eq(stronghold.id, strongholdId), eq(stronghold.campaignId, cid)))
    .get();
  if (!row || (env.actor.role === "player" && row.dmOnly)) throw notFound(STORES_GONE_MESSAGE);
  return row;
}

/** `stores-coin` rows of `ids` now (before a write), to diff after it. */
export function storesCoinsBefore(
  env: CommandEnv,
  cid: string,
  ids: readonly string[],
): Map<string, StoresCoinRecord | null> {
  return new Map(ids.map((id) => [id, storesCoinOf(env.tx, cid, id)] as const));
}

/** FR-LOOT-31: one `stores-coin` change per Stores end (before null on its first entry). */
export function storesCoinChanges(
  env: CommandEnv,
  cid: string,
  before: Map<string, StoresCoinRecord | null>,
): RecordChange[] {
  return [...before].map(([id, b]) => ({
    type: STORES_COIN_TYPE,
    id,
    before: b,
    after: storesCoinOf(env.tx, cid, id),
  }));
}

/** The stronghold ids of the Stores ends among `ends`, once each. */
export function storesIds(...ends: readonly { kind: string; strongholdId?: string }[]): string[] {
  return [
    ...new Set(
      ends.flatMap((e) => (e.kind === "stores" && e.strongholdId ? [e.strongholdId] : [])),
    ),
  ];
}
