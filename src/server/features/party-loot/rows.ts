// Rows → wire records, and the derived balances (FR-LOOT-09): one grouped SUM over the
// campaign's entries, all of them (not just the window). Nothing here writes.
import {
  type Coins,
  type Endpoint,
  type LootEntryRecord,
  type PartyPotRecord,
  type WalletRecord,
  ZERO_COINS,
} from "@shared/party-loot/schemas";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db, Tx } from "../../db/client";
import { lootEntry } from "../../db/schema";

type Reader = Pick<Db | Tx, "select">;
type EntryRow = typeof lootEntry.$inferSelect;

function endpoint(kind: EntryRow["fromKind"], characterId: string | null): Endpoint {
  if (kind === "character") return { kind, characterId: characterId ?? "" };
  return { kind };
}

export function toEntryRecord(r: EntryRow): LootEntryRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    kind: r.kind,
    from: endpoint(r.fromKind, r.fromCharacterId),
    to: endpoint(r.toKind, r.toCharacterId),
    text: r.text,
    cp: r.cp,
    sp: r.sp,
    ep: r.ep,
    gp: r.gp,
    pp: r.pp,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
  };
}

/** Endpoint → its two columns. */
export function endpointColumns(e: Endpoint): {
  kind: Endpoint["kind"];
  characterId: string | null;
} {
  return { kind: e.kind, characterId: e.kind === "character" ? e.characterId : null };
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

/**
 * FR-LOOT-09: per character with ≥ 1 move, Σ `to = character` − Σ `from = character`.
 * Ordered by character id so snapshots are deterministic.
 */
export function wallets(db: Reader, campaignId: string): WalletRecord[] {
  const plain = (c: AnySQLiteColumn) => sql`${c}`;
  const incoming = db
    .select({ characterId: lootEntry.toCharacterId, ...coinSums(plain) })
    .from(lootEntry)
    .where(and(eq(lootEntry.campaignId, campaignId), eq(lootEntry.toKind, "character")))
    .groupBy(lootEntry.toCharacterId)
    .all();
  const outgoing = db
    .select({ characterId: lootEntry.fromCharacterId, ...coinSums(plain) })
    .from(lootEntry)
    .where(and(eq(lootEntry.campaignId, campaignId), eq(lootEntry.fromKind, "character")))
    .groupBy(lootEntry.fromCharacterId)
    .all();
  const byId = new Map<string, Coins>();
  for (const [rows, sign] of [
    [incoming, 1],
    [outgoing, -1],
  ] as const) {
    for (const { characterId, ...coins } of rows) {
      if (!characterId) continue;
      byId.set(characterId, add(byId.get(characterId) ?? ZERO_COINS, coins, sign));
    }
  }
  return [...byId.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([characterId, coins]) => ({ id: characterId, campaignId, characterId, ...coins }));
}
