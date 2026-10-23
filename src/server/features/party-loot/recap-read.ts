// Loot read helper for session-recap (FR-RECAP-14, seams S8; RECAP SP3 by assignment): the ledger
// rows created in a time range whose one end is `world` and the other the party or a character,
// oldest first. Moves between the party and characters are left out, and so is any row with a
// Stores end (`stores`): a move, for the DM too, so a DM-only Stores never reaches a recap.
// Read-only; the same rows for every viewer (FR-LOOT-10).
import { and, asc, eq, gte, lt, max, sql } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { lootEntry } from "../../db/schema";

type Reader = Pick<Db | Tx, "select">;

export interface RecapLootEntry {
  id: string;
  kind: "loot" | "move" | "item";
  /** The party side: `world` → it is a gain, it → `world` a spend / removal. */
  side: { kind: "party" } | { kind: "character"; characterId: string };
  /** +1 = from the world, −1 = to the world. */
  sign: 1 | -1;
  text: string;
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
  qty: number | null;
}

const PARTY_SIDE = ["party", "character"];

/** `world ↔ party / character` only (no Stores end, no move between party and characters). */
const recapShape = sql`((${lootEntry.fromKind} = 'world' and ${lootEntry.toKind} in ('party', 'character')) or (${lootEntry.toKind} = 'world' and ${lootEntry.fromKind} in ('party', 'character')))`;

/** Rows of `campaignId` with `fromAt ≤ createdAt < toAt` (`toAt` null = up to now). */
const inRange = (campaignId: string, fromAt: string, toAt: string | null) =>
  and(
    eq(lootEntry.campaignId, campaignId),
    gte(lootEntry.createdAt, fromAt),
    toAt === null ? undefined : lt(lootEntry.createdAt, toAt),
  );

/** FR-RECAP-14: the recap's ledger rows in `[fromAt, toAt)`, oldest first. */
export function lootRows(
  db: Reader,
  campaignId: string,
  fromAt: string,
  toAt: string | null,
): RecapLootEntry[] {
  const rows = db
    .select()
    .from(lootEntry)
    .where(and(inRange(campaignId, fromAt, toAt), recapShape))
    .orderBy(asc(lootEntry.createdAt), asc(lootEntry.seq))
    .all();
  return rows.flatMap((r): RecapLootEntry[] => {
    const fromWorld = r.fromKind === "world";
    const kind = fromWorld ? r.toKind : r.fromKind;
    const characterId = fromWorld ? r.toCharacterId : r.fromCharacterId;
    // Belt and braces: the SQL shape already keeps Stores and party ↔ character rows out.
    if (!PARTY_SIDE.includes(kind) || r.fromKind === r.toKind) return [];
    return [
      {
        id: r.id,
        kind: r.kind,
        side: kind === "character" ? { kind, characterId: characterId ?? "" } : { kind: "party" },
        sign: fromWorld ? 1 : -1,
        text: r.text,
        cp: r.cp,
        sp: r.sp,
        ep: r.ep,
        gp: r.gp,
        pp: r.pp,
        qty: r.qty,
      },
    ];
  });
}

/**
 * FR-RECAP-29: the loot high-water of `[fromAt, toAt)`: the highest `seq` and the newest
 * `editedAt` among the recap's rows (one grouped read), so a new row or an edit stales a memo.
 */
export function lootHighWater(
  db: Reader,
  campaignId: string,
  fromAt: string,
  toAt: string | null,
): string {
  const row = db
    .select({ seq: max(lootEntry.seq), edited: max(lootEntry.editedAt) })
    .from(lootEntry)
    .where(and(inRange(campaignId, fromAt, toAt), recapShape))
    .get();
  return `${row?.seq ?? 0}|${row?.edited ?? ""}`;
}
