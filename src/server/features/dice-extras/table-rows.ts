// Row ↔ record mapping, reads and caps for `roll_macro` and `roll_request` (DICEX §8 sprint 8).
// The commands (TT1, TT2) write through these; TT0 registers the record types on them.
import {
  MACROS_PER_CAMPAIGN,
  MACROS_PER_LIST,
  type RollMacroRecord,
} from "@shared/dice-extras/macros";
import {
  CLOSED_REQUESTS_WINDOW,
  OPEN_REQUESTS_MAX,
  RequestRoll,
  RequestTarget,
  type RollRequestRecord,
} from "@shared/dice-extras/requests";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { conflict } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { rollMacro, rollRequest } from "../../db/schema";

type Read = Pick<Tx, "select">;
type MacroRow = typeof rollMacro.$inferSelect;
type RequestRow = typeof rollRequest.$inferSelect;

/** The only mapping from a macro row to the wire: `updatedAt` stays server-only. */
export const toMacroRecord = (r: MacroRow): RollMacroRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  playerId: r.playerId,
  creatureId: r.creatureId,
  name: r.name,
  expression: r.expression,
  category: r.category,
  order: r.order,
  createdBy: r.createdBy,
});

const Targets = z.array(RequestTarget);

/** The only mapping from a request row to the wire; the JSON leaves are parsed on read. */
export const toRequestRecord = (r: RequestRow): RollRequestRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  seq: r.seq,
  roll: RequestRoll.parse(r.roll),
  label: r.label,
  dc: r.dc,
  dcShown: r.dcShown,
  mode: r.mode,
  results: r.results,
  state: r.state,
  targets: Targets.parse(r.targets),
  createdAt: r.createdAt,
  closedAt: r.closedAt,
});

/** The campaign's macros, list order (`playerId`, `creatureId`, `order`). */
export function listMacros(read: Read, campaignId: string): RollMacroRecord[] {
  return read
    .select()
    .from(rollMacro)
    .where(eq(rollMacro.campaignId, campaignId))
    .orderBy(asc(rollMacro.playerId), asc(rollMacro.creatureId), asc(rollMacro.order))
    .all()
    .map(toMacroRecord);
}

export function readMacro(read: Read, campaignId: string, id: string): RollMacroRecord | null {
  const r = read
    .select()
    .from(rollMacro)
    .where(and(eq(rollMacro.id, id), eq(rollMacro.campaignId, campaignId)))
    .get();
  return r ? toMacroRecord(r) : null;
}

/**
 * FR-DICEX-64: a new macro must fit ≤ 24 in its list (`playerId`, `creatureId`) and ≤ 200 in the
 * campaign, else `conflict`.
 */
export function assertMacroRoom(
  read: Read,
  campaignId: string,
  list: { playerId: string | null; creatureId: string | null },
): void {
  const total = read
    .select({ n: count() })
    .from(rollMacro)
    .where(eq(rollMacro.campaignId, campaignId))
    .get();
  if ((total?.n ?? 0) >= MACROS_PER_CAMPAIGN) {
    throw conflict(`At most ${MACROS_PER_CAMPAIGN} macros per campaign`);
  }
  const inList = read
    .select({ n: count() })
    .from(rollMacro)
    .where(
      and(
        eq(rollMacro.campaignId, campaignId),
        list.playerId === null ? isNull(rollMacro.playerId) : eq(rollMacro.playerId, list.playerId),
        list.creatureId === null
          ? isNull(rollMacro.creatureId)
          : eq(rollMacro.creatureId, list.creatureId),
      ),
    )
    .get();
  if ((inList?.n ?? 0) >= MACROS_PER_LIST) {
    throw conflict(`At most ${MACROS_PER_LIST} macros in one list`);
  }
}

/**
 * FR-DICEX-73 snapshot provider: every open request + the newest 10 closed, `seq` order. The
 * registry cuts the same window again (ADR-0029); reading only it keeps old sessions' requests out
 * of the build.
 */
export function requestWindow(read: Read, campaignId: string): RollRequestRecord[] {
  const open = read
    .select()
    .from(rollRequest)
    .where(and(eq(rollRequest.campaignId, campaignId), eq(rollRequest.state, "open")))
    .all();
  const closed = read
    .select()
    .from(rollRequest)
    .where(and(eq(rollRequest.campaignId, campaignId), eq(rollRequest.state, "closed")))
    .orderBy(desc(rollRequest.seq))
    .limit(CLOSED_REQUESTS_WINDOW)
    .all();
  return [...open, ...closed].sort((a, b) => a.seq - b.seq).map(toRequestRecord);
}

export function readRequest(read: Read, campaignId: string, id: string): RollRequestRecord | null {
  const r = read
    .select()
    .from(rollRequest)
    .where(and(eq(rollRequest.id, id), eq(rollRequest.campaignId, campaignId)))
    .get();
  return r ? toRequestRecord(r) : null;
}

/** FR-DICEX-74: at most 5 open requests per campaign, else `conflict`. */
export function assertRequestRoom(read: Read, campaignId: string): void {
  const open = read
    .select({ n: count() })
    .from(rollRequest)
    .where(and(eq(rollRequest.campaignId, campaignId), eq(rollRequest.state, "open")))
    .get();
  if ((open?.n ?? 0) >= OPEN_REQUESTS_MAX) {
    throw conflict(`At most ${OPEN_REQUESTS_MAX} open requests`);
  }
}
