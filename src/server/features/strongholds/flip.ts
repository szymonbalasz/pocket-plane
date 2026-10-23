// FR-HOLD-12 show / hide (a stronghold's `dmOnly` flip), in `hold.update`'s transaction: the
// copies that make a hidden stronghold's things hidden. The DB rewrite covers every row; the
// event's changes carry the reminders, the Stores items (≤ 60), `stores-coin` and **only the loot
// entries inside the current window** (newest 100; review ruling 8). Older rows a client holds
// keep their earlier form until its next snapshot.

import { PARTY_ITEM_TYPE } from "@shared/party-board/schemas";
import {
  LOOT_ENTRY_TYPE,
  LOOT_WINDOW,
  STORES_COIN_TYPE,
  type StoresCoinRecord,
} from "@shared/party-loot/schemas";
import type { StrongholdRecord } from "@shared/strongholds/schemas";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { lootEntry, partyItem, stronghold } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getItem } from "../party-board/commands";
import { holderItems } from "../party-board/rows";
import { getEntry, storesCoinOf, storesEntries } from "../party-loot/rows";
import { refreshLinkHidden } from "../reminders/rows";

/** Ids of the campaign's loot window: the newest `LOOT_WINDOW` entries by `seq` (FR-LOOT-11). */
function windowIds(env: CommandEnv, cid: string): Set<string> {
  return new Set(
    env.tx
      .select({ id: lootEntry.id })
      .from(lootEntry)
      .where(eq(lootEntry.campaignId, cid))
      .orderBy(desc(lootEntry.seq))
      .limit(LOOT_WINDOW)
      .all()
      .map((r) => r.id),
  );
}

/** DM-only strongholds among `ids`, now (after the flip's write). */
function hiddenNow(env: CommandEnv, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  return new Set(
    env.tx
      .select({ id: stronghold.id })
      .from(stronghold)
      .where(and(inArray(stronghold.id, [...ids]), eq(stronghold.dmOnly, true)))
      .all()
      .map((r) => r.id),
  );
}

/**
 * Runs after the stronghold row is written with its new `dmOnly`. `coinBefore` = its
 * `stores-coin` row read before the write.
 */
export function flipChanges(
  env: CommandEnv,
  after: StrongholdRecord,
  coinBefore: StoresCoinRecord | null,
): RecordChange[] {
  const cid = after.campaignId;
  const changes: RecordChange[] = [...refreshLinkHidden(env, after)];

  // Stores items: the copy on every row (≤ 60), each a change.
  for (const item of holderItems(env.tx, cid, after.id)) {
    env.tx
      .update(partyItem)
      .set({ storesHidden: after.dmOnly })
      .where(eq(partyItem.id, item.id))
      .run();
    changes.push({
      type: PARTY_ITEM_TYPE,
      id: item.id,
      before: item,
      after: getItem(env, cid, item.id),
    });
  }

  // Loot entries: every row rewritten (another Stores end keeps its own flag), window rows sent.
  const rows = storesEntries(env.tx, cid, after.id);
  const others = rows.flatMap((r) => [r.fromStrongholdId, r.toStrongholdId]);
  const hidden = hiddenNow(
    env,
    others.filter((id): id is string => id !== null),
  );
  const inWindow = windowIds(env, cid);
  for (const r of rows) {
    const storesHidden =
      (r.fromStrongholdId !== null && hidden.has(r.fromStrongholdId)) ||
      (r.toStrongholdId !== null && hidden.has(r.toStrongholdId));
    if (storesHidden === r.storesHidden) continue;
    const before = inWindow.has(r.id) ? getEntry(env.tx, cid, r.id) : null;
    env.tx.update(lootEntry).set({ storesHidden }).where(eq(lootEntry.id, r.id)).run();
    if (before)
      changes.push({
        type: LOOT_ENTRY_TYPE,
        id: r.id,
        before,
        after: getEntry(env.tx, cid, r.id),
      });
  }

  const coinAfter = storesCoinOf(env.tx, cid, after.id);
  if (coinBefore || coinAfter)
    changes.push({ type: STORES_COIN_TYPE, id: after.id, before: coinBefore, after: coinAfter });
  return changes;
}
