// Test support for reminders + strongholds (REM / HOLD §13): party-loot's seed (two players, Mira +
// Thorn, a second campaign) plus loads per viewer, error codes, a stronghold builder and the
// conservation check (FR-LOOT-39).
import { COINS, type Coins, ZERO_COINS } from "@shared/party-loot/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import type { Db } from "../../db/client";
import { lootEntry, partyItem } from "../../db/schema";
import type { DispatchedEvent } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { partyPot, storesCoins, wallets } from "../party-loot/rows";
import { seedLoot } from "../party-loot/testing";

export function seedRs() {
  const t = seedLoot();
  const src = { db: t.s.db, presence: { list: () => [] } };
  const load = (v: Viewer, type: string) => t.s.records.load(src, v, type)[type] ?? [];
  const dmV = t.viewer("dm");
  const p1V = t.viewer("player", t.p1.id);
  const p2V = t.viewer("player", t.p2.id);
  /** A stronghold through the commands; `shown` flips it visible (FR-HOLD-06 default DM-only). */
  const hold = (name: string, shown = false) => {
    const { strongholdId } = t.run("hold.create", { name }, { actor: t.dm }) as {
      strongholdId: string;
    };
    if (shown) t.run("hold.update", { strongholdId, dmOnly: false }, { actor: t.dm });
    return strongholdId;
  };
  const facility = (strongholdId: string, facility: Record<string, unknown>) =>
    (
      t.run("hold.saveFacility", { strongholdId, facility }, { actor: t.dm }) as {
        facilityId: string;
      }
    ).facilityId;
  const since = (n: number): DispatchedEvent[] => t.events.slice(n);
  return { ...t, src, load, dmV, p1V, p2V, hold, facility, since };
}

export type RsSeed = ReturnType<typeof seedRs>;

/** The command error code of `fn`, or "ok". */
export function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (err) {
    if (err instanceof CommandError) return err.code;
    throw err;
  }
}

/** The command error of `fn` (code and message). */
export function errorOf(fn: () => unknown): { code: string; message: string } | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof CommandError) return { code: err.code, message: err.message };
    throw err;
  }
}

/**
 * FR-LOOT-39: pot + Σ wallets + Σ Stores = net coin from outside (`world` ends), over every
 * entry; returns `[held, fromOutside]` per coin (equal = holds).
 */
export function coinConservation(db: Db, campaignId: string): [Coins, Coins] {
  const held: Coins = { ...ZERO_COINS };
  const pot = partyPot(db, campaignId);
  for (const k of COINS) held[k] += pot[k];
  for (const w of wallets(db, campaignId)) for (const k of COINS) held[k] += w[k];
  for (const s of storesCoins(db, campaignId)) for (const k of COINS) held[k] += s[k];
  const outside: Coins = { ...ZERO_COINS };
  for (const e of db.select().from(lootEntry).where(eq(lootEntry.campaignId, campaignId)).all()) {
    const sign = e.fromKind === "world" ? 1 : e.toKind === "world" ? -1 : 0;
    for (const k of COINS) outside[k] += sign * e[k];
  }
  // A deleted stronghold has no `stores-coin` row: `hold.delete` must have moved its balance to 0
  // (FR-LOOT-38), else the sums differ.
  return [held, outside];
}

/** Σ qty per item name in party_item rows of the campaign (party + every Stores). */
export function itemTotals(db: Db, campaignId: string, ids?: string[]): Record<string, number> {
  const rows = db
    .select()
    .from(partyItem)
    .where(
      ids
        ? and(eq(partyItem.campaignId, campaignId), inArray(partyItem.id, ids))
        : eq(partyItem.campaignId, campaignId),
    )
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.name] = (out[r.name] ?? 0) + r.qty;
  return out;
}
