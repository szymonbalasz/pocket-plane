// Stronghold commands (HOLD §6.2; DM only, OQ-HOLD-08 A): create, update (incl. show / hide),
// facilities and staff (save / move / remove), delete. One transaction each with the event-log
// row; every event `quietWhenUnchanged` (FR-HOLD-09) so an edit no player can see sends players no
// frame (their redacted record carries no `updatedAt`). No notifications (FR-HOLD-20).
import {
  FacilityRemoved,
  StrongholdCreated,
  StrongholdDeleted,
  StrongholdUpdated,
} from "@shared/events/strongholds";
import { PARTY_FULL_MESSAGE, PARTY_ITEM_TYPE } from "@shared/party-board/schemas";
import {
  COIN_MAX,
  COINS,
  type Coins,
  LOOT_ENTRY_TYPE,
  STORES_COIN_TYPE,
  ZERO_COINS,
} from "@shared/party-loot/schemas";
import {
  CreateStrongholdIntent,
  DELETED_TEXT,
  DeleteStrongholdIntent,
  FACILITIES_MAX,
  FACILITY_GONE,
  type Facility,
  type FacilityInput,
  type FacilityResult,
  HOLD_INTENTS,
  indexOf,
  limitMessage,
  MoveRowIntent,
  NAME_TAKEN,
  PARTY_FULL_ON_DELETE,
  RemoveFacilityIntent,
  RemoveStaffIntent,
  SaveFacilityIntent,
  SaveStaffIntent,
  STAFF_GONE,
  STAFF_MAX,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_NOT_FOUND,
  STRONGHOLD_TYPE,
  STRONGHOLDS_MAX,
  type Staff,
  type StaffInput,
  type StaffResult,
  type StrongholdRecord,
  type StrongholdResult,
  UpdateStrongholdIntent,
} from "@shared/strongholds/schemas";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { CommandError, conflict, invalid, notFound } from "../../commands/errors";
import { partyItem, stronghold, strongholdSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { putToHolder } from "../party-board/holders";
import { holderItems } from "../party-board/rows";
import { potChange } from "../party-loot/commands";
import { insertItemEntry } from "../party-loot/item-entries";
import { insertLootEntry, partyPot, storesCoinOf } from "../party-loot/rows";
import { nextCreatedAt } from "../reminders/created-at";
import { deleteReminders, linkedReminders, refreshLinkHidden } from "../reminders/rows";
import { campaignOf } from "../scenes-map/rows";
import { flipChanges } from "./flip";
import { getStronghold, listStrongholds, strongholdCount } from "./rows";

const PARTY = { kind: "party" } as const;

function loadHold(env: CommandEnv, cid: string, id: string): StrongholdRecord {
  const h = getStronghold(env.tx, cid, id);
  if (!h) throw notFound(STRONGHOLD_NOT_FOUND);
  return h;
}

/** FR-HOLD-03: unique per campaign, case-insensitive. */
function assertNameFree(env: CommandEnv, cid: string, name: string, exceptId?: string) {
  const key = name.toLowerCase();
  if (listStrongholds(env.tx, cid).some((h) => h.id !== exceptId && h.name.toLowerCase() === key))
    throw conflict(NAME_TAKEN);
}

type HoldFields = Partial<Omit<StrongholdRecord, "id" | "campaignId" | "seq" | "createdAt">>;

/** Writes the fields and `updatedAt`; the record after. */
function writeHold(env: CommandEnv, h: StrongholdRecord, set: HoldFields): StrongholdRecord {
  env.tx
    .update(stronghold)
    .set({ ...set, updatedAt: env.ctx.clock.iso() })
    .where(eq(stronghold.id, h.id))
    .run();
  return loadHold(env, h.campaignId, h.id);
}

const holdChange = (before: StrongholdRecord | null, after: StrongholdRecord | null) =>
  ({
    type: STRONGHOLD_TYPE,
    id: (after ?? before)?.id as string,
    before,
    after,
  }) satisfies RecordChange;

const indexChange = (before: StrongholdRecord | null, after: StrongholdRecord | null) =>
  ({
    type: STRONGHOLD_INDEX_TYPE,
    id: (after ?? before)?.id as string,
    before: before && indexOf(before),
    after: after && indexOf(after),
  }) satisfies RecordChange;

function emitUpdated(
  env: CommandEnv,
  payload: {
    strongholdId: string;
    part: "header" | "facility" | "staff" | "order";
    facilityId?: string;
    staffId?: string;
  },
  changes: RecordChange[],
): void {
  env.emit({
    type: StrongholdUpdated.type,
    campaignId: env.actor.campaignId,
    payload,
    changes,
    quietWhenUnchanged: true,
  });
}

/** FR-HOLD-11: DM-only, no rows, defenders 0 (FR-HOLD-06); ≤ 8 per campaign. */
export const createStronghold = defineCommand({
  name: HOLD_INTENTS.create,
  input: CreateStrongholdIntent,
  execute({ name }, env): StrongholdResult {
    const cid = campaignOf(env.actor);
    if (strongholdCount(env.tx, cid) >= STRONGHOLDS_MAX)
      throw conflict(limitMessage("Stronghold", STRONGHOLDS_MAX));
    assertNameFree(env, cid, name);
    const id = env.ctx.ids.next();
    const now = env.ctx.clock.iso();
    env.tx
      .insert(stronghold)
      .values({
        id,
        campaignId: cid,
        seq: strongholdSeqNext,
        name,
        dmOnly: true,
        defenders: 0,
        defendersDmOnly: false,
        notes: "",
        notesDmOnly: false,
        facilities: [],
        staff: [],
        createdAt: nextCreatedAt(env.tx, stronghold, cid, now),
        updatedAt: now,
      })
      .run();
    const after = loadHold(env, cid, id);
    env.emit({
      type: StrongholdCreated.type,
      campaignId: cid,
      payload: { strongholdId: id },
      changes: [holdChange(null, after), indexChange(null, after)],
      quietWhenUnchanged: true,
    });
    return { strongholdId: id };
  },
});

/**
 * FR-HOLD-12: a header patch; same values → `ack`. A rename or `dmOnly` flip also changes the
 * index row; a flip rewrites the copies (`flip.ts`).
 */
export const updateStronghold = defineCommand({
  name: HOLD_INTENTS.update,
  input: UpdateStrongholdIntent,
  execute({ strongholdId, ...patch }, env): void {
    const cid = campaignOf(env.actor);
    const before = loadHold(env, cid, strongholdId);
    const set: HoldFields = {};
    for (const [k, v] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
      if (v !== undefined && before[k] !== v) Object.assign(set, { [k]: v });
    }
    if (Object.keys(set).length === 0) return;
    if (set.name !== undefined) assertNameFree(env, cid, set.name, strongholdId);
    const flipped = set.dmOnly !== undefined;
    const coinBefore = flipped ? storesCoinOf(env.tx, cid, strongholdId) : null;
    const after = writeHold(env, before, set);
    const changes: RecordChange[] = [holdChange(before, after)];
    if (set.name !== undefined || flipped) changes.push(indexChange(before, after));
    if (flipped) changes.push(...flipChanges(env, after, coinBefore));
    emitUpdated(env, { strongholdId, part: "header" }, changes);
  },
});

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** FR-HOLD-04: `replacesId` another facility of the stronghold (itself → `invalid`). */
function checkReplaces(list: readonly Facility[], id: string, replacesId: string | null) {
  if (replacesId === null) return;
  if (replacesId === id) throw invalid("A facility can't replace itself");
  if (!list.some((f) => f.id === replacesId)) throw notFound(FACILITY_GONE);
}

/** FR-HOLD-13: append (new id) or replace by `id`; a `dmOnly` flip rewrites `linkHidden`. */
export function saveFacilityIn(
  env: CommandEnv,
  strongholdId: string,
  input: FacilityInput,
): FacilityResult {
  const cid = campaignOf(env.actor);
  const before = loadHold(env, cid, strongholdId);
  const { id: sent, ...fields } = input;
  const index = sent === undefined ? -1 : before.facilities.findIndex((f) => f.id === sent);
  if (sent !== undefined && index < 0) throw notFound(FACILITY_GONE);
  if (sent === undefined && before.facilities.length >= FACILITIES_MAX)
    throw conflict(limitMessage("Facility", FACILITIES_MAX));
  const id = sent ?? env.ctx.ids.next();
  checkReplaces(before.facilities, id, fields.replacesId);
  const next: Facility = { id, ...fields };
  if (index >= 0 && sameJson(before.facilities[index], next)) return { facilityId: id };
  const facilities =
    index < 0
      ? [...before.facilities, next]
      : before.facilities.map((f, i) => (i === index ? next : f));
  const after = writeHold(env, before, { facilities });
  emitUpdated(env, { strongholdId, part: "facility", facilityId: id }, [
    holdChange(before, after),
    ...refreshLinkHidden(env, after),
  ]);
  return { facilityId: id };
}

export const saveFacility = defineCommand({
  name: HOLD_INTENTS.saveFacility,
  input: SaveFacilityIntent,
  execute: ({ strongholdId, facility }, env) => saveFacilityIn(env, strongholdId, facility),
});

/** FR-HOLD-14: as facilities; "works in" a facility of the same stronghold. */
export function saveStaffIn(env: CommandEnv, strongholdId: string, input: StaffInput): StaffResult {
  const cid = campaignOf(env.actor);
  const before = loadHold(env, cid, strongholdId);
  const { id: sent, ...fields } = input;
  const index = sent === undefined ? -1 : before.staff.findIndex((m) => m.id === sent);
  if (sent !== undefined && index < 0) throw notFound(STAFF_GONE);
  if (sent === undefined && before.staff.length >= STAFF_MAX)
    throw conflict(limitMessage("Staff", STAFF_MAX));
  if (fields.facilityId !== null && !before.facilities.some((f) => f.id === fields.facilityId))
    throw notFound(FACILITY_GONE);
  const id = sent ?? env.ctx.ids.next();
  const next: Staff = { id, ...fields };
  if (index >= 0 && sameJson(before.staff[index], next)) return { staffId: id };
  const staff =
    index < 0 ? [...before.staff, next] : before.staff.map((m, i) => (i === index ? next : m));
  const after = writeHold(env, before, { staff });
  emitUpdated(env, { strongholdId, part: "staff", staffId: id }, [holdChange(before, after)]);
  return { staffId: id };
}

export const saveStaff = defineCommand({
  name: HOLD_INTENTS.saveStaff,
  input: SaveStaffIntent,
  execute: ({ strongholdId, staff }, env) => saveStaffIn(env, strongholdId, staff),
});

/** FR-HOLD-15: index clamped; same place → `ack`; `part: "order"` (quiet, review ruling 21). */
export const moveRow = defineCommand({
  name: HOLD_INTENTS.moveRow,
  input: MoveRowIntent,
  execute({ strongholdId, list, id, index }, env): void {
    const cid = campaignOf(env.actor);
    const before = loadHold(env, cid, strongholdId);
    const rows: readonly { id: string }[] = before[list];
    const from = rows.findIndex((r) => r.id === id);
    if (from < 0) throw notFound(list === "facilities" ? FACILITY_GONE : STAFF_GONE);
    const to = Math.min(index, rows.length - 1);
    if (to === from) return;
    const moved = [...rows];
    const [row] = moved.splice(from, 1);
    moved.splice(to, 0, row as { id: string });
    const after = writeHold(env, before, { [list]: moved } as HoldFields);
    emitUpdated(env, { strongholdId, part: "order" }, [holdChange(before, after)]);
  },
});

/** FR-HOLD-16. */
export const removeStaff = defineCommand({
  name: HOLD_INTENTS.removeStaff,
  input: RemoveStaffIntent,
  execute({ strongholdId, staffId }, env): void {
    const cid = campaignOf(env.actor);
    const before = loadHold(env, cid, strongholdId);
    if (!before.staff.some((m) => m.id === staffId)) throw notFound(STAFF_GONE);
    const after = writeHold(env, before, { staff: before.staff.filter((m) => m.id !== staffId) });
    emitUpdated(env, { strongholdId, part: "staff", staffId }, [holdChange(before, after)]);
  },
});

/**
 * FR-HOLD-17: removes the facility, nulls staff `facilityId` / other facilities' `replacesId`
 * pointing at it, and deletes its linked reminders (FR-REM-11), all in this transaction.
 */
export const removeFacility = defineCommand({
  name: HOLD_INTENTS.removeFacility,
  input: RemoveFacilityIntent,
  execute({ strongholdId, facilityId }, env): void {
    const cid = campaignOf(env.actor);
    const before = loadHold(env, cid, strongholdId);
    if (!before.facilities.some((f) => f.id === facilityId)) throw notFound(FACILITY_GONE);
    const after = writeHold(env, before, {
      facilities: before.facilities
        .filter((f) => f.id !== facilityId)
        .map((f) => (f.replacesId === facilityId ? { ...f, replacesId: null } : f)),
      staff: before.staff.map((m) =>
        m.facilityId === facilityId ? { ...m, facilityId: null } : m,
      ),
    });
    const removed = deleteReminders(env, linkedReminders(env.tx, cid, strongholdId, facilityId));
    env.emit({
      type: FacilityRemoved.type,
      campaignId: cid,
      payload: { strongholdId, facilityId, reminderIds: removed.ids },
      changes: [holdChange(before, after), ...removed.changes],
      quietWhenUnchanged: true,
    });
  },
});

/**
 * FR-LOOT-38 / review ruling 9: a balance → move entries within the per-coin bound (0…999 999),
 * as many as needed; `sign` 1 = the positive coins, -1 = the negative ones (magnitudes).
 */
export function splitBalance(balance: Coins, sign: 1 | -1): Coins[] {
  const left: Coins = { ...ZERO_COINS };
  for (const k of COINS) left[k] = Math.max(0, sign * balance[k]);
  const out: Coins[] = [];
  while (COINS.some((k) => left[k] > 0)) {
    const part: Coins = { ...ZERO_COINS };
    for (const k of COINS) {
      part[k] = Math.min(left[k], COIN_MAX);
      left[k] -= part[k];
    }
    out.push(part);
  }
  return out;
}

/**
 * FR-HOLD-19 (OQ-HOLD-06 B): in one transaction, (a) deletes the linked reminders, (b) moves the
 * Stores to the party: items merge into the party inventory (full → `conflict`, nothing written),
 * the coin balance goes to 0 through split move entries (text empty for a hidden Stores, review
 * ruling 3a), (c) deletes the row. Entries are written before the row goes, so they keep the
 * Stores' `stores_hidden` copy; old entries keep their `stores` end ("Stores (removed)").
 */
export const deleteStronghold = defineCommand({
  name: HOLD_INTENTS.delete,
  input: DeleteStrongholdIntent,
  execute({ strongholdId }, env): void {
    const cid = campaignOf(env.actor);
    const before = loadHold(env, cid, strongholdId);
    const removed = deleteReminders(env, linkedReminders(env.tx, cid, strongholdId));
    const stores = { kind: "stores" as const, strongholdId };
    const text = before.dmOnly ? "" : DELETED_TEXT;
    const changes: RecordChange[] = [holdChange(before, null), indexChange(before, null)];
    changes.push(...removed.changes);
    const entryIds: string[] = [];

    for (const item of holderItems(env.tx, cid, strongholdId)) {
      env.tx.delete(partyItem).where(eq(partyItem.id, item.id)).run();
      changes.push({ type: PARTY_ITEM_TYPE, id: item.id, before: item, after: null });
      try {
        changes.push(putToHolder(env, cid, PARTY, item).change);
      } catch (err) {
        if (err instanceof CommandError && err.message === PARTY_FULL_MESSAGE)
          throw conflict(PARTY_FULL_ON_DELETE);
        throw err;
      }
      const entry = insertItemEntry(env, cid, stores, PARTY, item.name, item.qty);
      entryIds.push(entry.id);
      changes.push({ type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry });
    }

    const coinBefore = storesCoinOf(env.tx, cid, strongholdId);
    if (coinBefore) {
      const potBefore = partyPot(env.tx, cid);
      const moves = [
        ...splitBalance(coinBefore, 1).map((coins) => ({ from: stores, to: PARTY, coins })),
        ...splitBalance(coinBefore, -1).map((coins) => ({ from: PARTY, to: stores, coins })),
      ];
      for (const m of moves) {
        const entry = insertLootEntry(env, cid, { kind: "move", ...m, text });
        entryIds.push(entry.id);
        changes.push({ type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry });
      }
      if (moves.length > 0) changes.push(potChange(potBefore, partyPot(env.tx, cid)));
      changes.push({ type: STORES_COIN_TYPE, id: strongholdId, before: coinBefore, after: null });
    }

    env.tx.delete(stronghold).where(eq(stronghold.id, strongholdId)).run();
    env.emit({
      type: StrongholdDeleted.type,
      campaignId: cid,
      payload: { strongholdId, reminderIds: removed.ids, entryIds },
      changes,
      quietWhenUnchanged: true,
    });
  },
});
