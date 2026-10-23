// Rows → wire records, and the derived balances (FR-LOOT-09): one grouped SUM over the
// campaign's entries, all of them (not just the window). *(S9)* `stores` ends (FR-LOOT-30), the
// derived `stores-coin` (FR-LOOT-31) and the one insert every entry writer shares (strictly
// increasing `createdAt`, the `stores_hidden` copy, FR-LOOT-32).
import {
  type Coins,
  type Endpoint,
  type LootEntryRecord,
  type PartyPotRecord,
  type StoresCoinRecord,
  type WalletRecord,
  ZERO_COINS,
} from "@shared/party-loot/schemas";
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { CommandEnv } from "../../commands/commands";
import type { Db, Tx } from "../../db/client";
import { lootEntry, lootEntrySeqNext, stronghold } from "../../db/schema";
import { nextCreatedAt } from "../reminders/created-at";

type Reader = Pick<Db | Tx, "select">;
type EntryRow = typeof lootEntry.$inferSelect;

function endpoint(
  kind: EntryRow["fromKind"],
  characterId: string | null,
  strongholdId: string | null,
): Endpoint {
  if (kind === "character") return { kind, characterId: characterId ?? "" };
  if (kind === "stores") return { kind, strongholdId: strongholdId ?? "" };
  return { kind };
}

export function toEntryRecord(r: EntryRow): LootEntryRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    kind: r.kind,
    from: endpoint(r.fromKind, r.fromCharacterId, r.fromStrongholdId),
    to: endpoint(r.toKind, r.toCharacterId, r.toStrongholdId),
    text: r.text,
    cp: r.cp,
    sp: r.sp,
    ep: r.ep,
    gp: r.gp,
    pp: r.pp,
    // FR-PARTY-25: item rows only; absent (not null) on the wire otherwise.
    ...(r.qty === null ? {} : { qty: r.qty }),
    // *(S9)* DM-only copies, on the wire only when true (FR-LOOT-32, -36).
    ...(r.storesHidden ? { storesHidden: true as const } : {}),
    ...(r.itemHidden ? { itemHidden: true as const } : {}),
    createdAt: r.createdAt,
    editedAt: r.editedAt,
  };
}

/** Endpoint → its three columns. */
export function endpointColumns(e: Endpoint): {
  kind: Endpoint["kind"];
  characterId: string | null;
  strongholdId: string | null;
} {
  return {
    kind: e.kind,
    characterId: e.kind === "character" ? e.characterId : null,
    strongholdId: e.kind === "stores" ? e.strongholdId : null,
  };
}

/** The strongholds of `ids` that are DM-only now (FR-LOOT-32 copy). */
function hiddenStrongholds(db: Reader, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = db
    .select({ id: stronghold.id })
    .from(stronghold)
    .where(and(inArray(stronghold.id, [...ids]), eq(stronghold.dmOnly, true)))
    .all();
  return new Set(rows.map((r) => r.id));
}

export interface NewEntry {
  kind: LootEntryRecord["kind"];
  from: Endpoint;
  to: Endpoint;
  text: string;
  coins?: Coins;
  qty?: number;
  /** FR-LOOT-36: adds / removes a DM-only Stores item. */
  itemHidden?: boolean;
}

/**
 * Inserts one entry in the caller's transaction: `seq` by the DB (CON-20), `createdAt` strictly
 * increasing per campaign (FR-LOOT-32), `stores_hidden` from the Stores ends' strongholds now.
 */
export function insertLootEntry(env: CommandEnv, cid: string, e: NewEntry): LootEntryRecord {
  const id = env.ctx.ids.next();
  const f = endpointColumns(e.from);
  const t = endpointColumns(e.to);
  const stores = [f.strongholdId, t.strongholdId].filter((s): s is string => s !== null);
  env.tx
    .insert(lootEntry)
    .values({
      id,
      campaignId: cid,
      seq: lootEntrySeqNext,
      kind: e.kind,
      fromKind: f.kind,
      fromCharacterId: f.characterId,
      fromStrongholdId: f.strongholdId,
      toKind: t.kind,
      toCharacterId: t.characterId,
      toStrongholdId: t.strongholdId,
      text: e.text,
      ...(e.coins ?? ZERO_COINS),
      qty: e.qty ?? null,
      storesHidden: hiddenStrongholds(env.tx, stores).size > 0,
      itemHidden: e.itemHidden === true,
      createdAt: nextCreatedAt(env.tx, lootEntry, cid, env.ctx.clock.iso()),
      editedAt: null,
    })
    .run();
  return getEntry(env.tx, cid, id) as LootEntryRecord;
}

export function getEntry(db: Reader, campaignId: string, id: string): LootEntryRecord | null {
  const row = db
    .select()
    .from(lootEntry)
    .where(and(eq(lootEntry.id, id), eq(lootEntry.campaignId, campaignId)))
    .get();
  return row ? toEntryRecord(row) : null;
}

/** Every entry of the campaign, oldest first (the registry cuts the window, ADR-0029). */
export function listEntries(db: Reader, campaignId: string): LootEntryRecord[] {
  return db
    .select()
    .from(lootEntry)
    .where(eq(lootEntry.campaignId, campaignId))
    .orderBy(asc(lootEntry.seq))
    .all()
    .map(toEntryRecord);
}

/** Every entry with a `stores` end of `strongholdId`, oldest first (FR-HOLD-12 flip rewrite). */
export function storesEntries(db: Reader, campaignId: string, strongholdId: string): EntryRow[] {
  return db
    .select()
    .from(lootEntry)
    .where(
      and(
        eq(lootEntry.campaignId, campaignId),
        or(
          eq(lootEntry.fromStrongholdId, strongholdId),
          eq(lootEntry.toStrongholdId, strongholdId),
        ),
      ),
    )
    .orderBy(asc(lootEntry.seq))
    .all();
}

const total = (expr: SQL) => sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number);
const coinSums = (signed: (col: AnySQLiteColumn) => SQL) => ({
  cp: total(signed(lootEntry.cp)),
  sp: total(signed(lootEntry.sp)),
  ep: total(signed(lootEntry.ep)),
  gp: total(signed(lootEntry.gp)),
  pp: total(signed(lootEntry.pp)),
});

/** FR-LOOT-09: per coin, Σ `to = party` − Σ `from = party`; zeros when there are no entries. */
export function partyPot(db: Reader, campaignId: string): PartyPotRecord {
  const sums = db
    .select(
      coinSums(
        (c) =>
          sql`case when ${lootEntry.toKind} = 'party' then ${c} when ${lootEntry.fromKind} = 'party' then -${c} else 0 end`,
      ),
    )
    .from(lootEntry)
    .where(eq(lootEntry.campaignId, campaignId))
    .get();
  return { id: campaignId, campaignId, ...(sums ?? ZERO_COINS) };
}

const add = (a: Coins, b: Coins, sign: 1 | -1): Coins => ({
  cp: a.cp + sign * b.cp,
  sp: a.sp + sign * b.sp,
  ep: a.ep + sign * b.ep,
  gp: a.gp + sign * b.gp,
  pp: a.pp + sign * b.pp,
});

/** Σ to − Σ from, per id of `kind` ends (wallets: characters; `stores-coin`: strongholds). */
function balancesBy(
  db: Reader,
  campaignId: string,
  kind: "character" | "stores",
  only?: string,
): Map<string, Coins> {
  const plain = (c: AnySQLiteColumn) => sql`${c}`;
  const toId = kind === "character" ? lootEntry.toCharacterId : lootEntry.toStrongholdId;
  const fromId = kind === "character" ? lootEntry.fromCharacterId : lootEntry.fromStrongholdId;
  const incoming = db
    .select({ id: toId, ...coinSums(plain) })
    .from(lootEntry)
    .where(
      and(
        eq(lootEntry.campaignId, campaignId),
        eq(lootEntry.toKind, kind),
        only === undefined ? undefined : eq(toId, only),
      ),
    )
    .groupBy(toId)
    .all();
  const outgoing = db
    .select({ id: fromId, ...coinSums(plain) })
    .from(lootEntry)
    .where(
      and(
        eq(lootEntry.campaignId, campaignId),
        eq(lootEntry.fromKind, kind),
        only === undefined ? undefined : eq(fromId, only),
      ),
    )
    .groupBy(fromId)
    .all();
  const byId = new Map<string, Coins>();
  for (const [rows, sign] of [
    [incoming, 1],
    [outgoing, -1],
  ] as const) {
    for (const { id, ...coins } of rows) {
      if (!id) continue;
      byId.set(id, add(byId.get(id) ?? ZERO_COINS, coins, sign));
    }
  }
  return byId;
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * FR-LOOT-09: per character with ≥ 1 move, Σ `to = character` − Σ `from = character`.
 * Ordered by character id so snapshots are deterministic.
 */
export function wallets(db: Reader, campaignId: string): WalletRecord[] {
  return [...balancesBy(db, campaignId, "character").entries()]
    .sort(byKey)
    .map(([characterId, coins]) => ({ id: characterId, campaignId, characterId, ...coins }));
}

/**
 * *(S9)* FR-LOOT-31: per **existing** stronghold with ≥ 1 entry, Σ `to = stores` − Σ `from =
 * stores`; `hidden` = its `dmOnly` now (key only when true). By stronghold id (deterministic).
 */
export function storesCoins(db: Reader, campaignId: string, only?: string): StoresCoinRecord[] {
  const holds = db
    .select({ id: stronghold.id, dmOnly: stronghold.dmOnly })
    .from(stronghold)
    .where(
      and(
        eq(stronghold.campaignId, campaignId),
        only === undefined ? undefined : eq(stronghold.id, only),
      ),
    )
    .all();
  if (holds.length === 0) return [];
  // Every entry with a Stores end makes a group (item rows sum to 0), so a key = ≥ 1 entry.
  const balances = balancesBy(db, campaignId, "stores", only);
  return holds
    .filter((h) => balances.has(h.id))
    .map((h): [string, StoresCoinRecord] => [
      h.id,
      {
        id: h.id,
        campaignId,
        strongholdId: h.id,
        ...(balances.get(h.id) ?? ZERO_COINS),
        ...(h.dmOnly ? { hidden: true as const } : {}),
      },
    ])
    .sort(byKey)
    .map(([, r]) => r);
}

/** One stronghold's `stores-coin` row, or null (no entry yet, or no such stronghold). */
export function storesCoinOf(
  db: Reader,
  campaignId: string,
  strongholdId: string,
): StoresCoinRecord | null {
  return storesCoins(db, campaignId, strongholdId)[0] ?? null;
}
