// "Strictly increasing per campaign" stamps (FR-REM-07, FR-HOLD-08, FR-LOOT-32): players order
// reminders, strongholds and loot entries by `createdAt` (then id) because their records carry no
// `seq` (review ruling 7). A new row's stamp is the clock's, or the campaign's newest + 1 ms when
// the clock hasn't moved past it (the fixed fixture clock, two commands in one millisecond).
import { and, eq, max } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Tx } from "../../db/client";

/** `now`, or `last` + 1 ms when `now` isn't later (ISO-8601 UTC strings). */
export function stampAfter(last: string | null, now: string): string {
  if (last === null || now > last) return now;
  // biome-ignore lint/style/noRestrictedGlobals: arithmetic on a stored stamp, not a clock read.
  return new Date(Date.parse(last) + 1).toISOString();
}

/** The next `createdAt` of `table` in `campaignId` (columns `campaignId`, `createdAt`). */
export function nextCreatedAt(
  tx: Pick<Tx, "select">,
  table: SQLiteTable & { campaignId: AnySQLiteColumn; createdAt: AnySQLiteColumn },
  campaignId: string,
  now: string,
): string {
  const row = tx
    .select({ last: max(table.createdAt) })
    .from(table)
    .where(and(eq(table.campaignId, campaignId)))
    .get();
  return stampAfter((row?.last as string | null | undefined) ?? null, now);
}
