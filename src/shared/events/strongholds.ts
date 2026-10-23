// Domain events of strongholds (HOLD §9). All logged; none undoable; every one is emitted
// `quietWhenUnchanged` (FR-HOLD-09): a change no player can see sends players no frame.
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);

export const STRONGHOLD_PARTS = ["header", "facility", "staff", "order"] as const;

/** `hold.create` (FR-HOLD-11): changes = `stronghold`, `stronghold-index` (before null). */
export const StrongholdCreated = defineEvent({
  type: "StrongholdCreated",
  payload: z.strictObject({ strongholdId: Id }),
  logged: true,
  undoable: false,
});

/**
 * `hold.update` / `saveFacility` / `saveStaff` / `removeStaff` / `moveRow` (FR-HOLD-12–16):
 * changes = `stronghold`; a rename or `dmOnly` flip + `stronghold-index`; a flip also the linked
 * reminders, the Stores items, `stores-coin` and the loot entries inside the window.
 */
export const StrongholdUpdated = defineEvent({
  type: "StrongholdUpdated",
  payload: z.strictObject({
    strongholdId: Id,
    part: z.enum(STRONGHOLD_PARTS),
    facilityId: Id.optional(),
    staffId: Id.optional(),
  }),
  logged: true,
  undoable: false,
});

/** `hold.removeFacility` (FR-HOLD-17): changes = `stronghold`, reminder deletes. */
export const FacilityRemoved = defineEvent({
  type: "FacilityRemoved",
  payload: z.strictObject({ strongholdId: Id, facilityId: Id, reminderIds: z.array(Id) }),
  logged: true,
  undoable: false,
});

/**
 * `hold.delete` (FR-HOLD-19): changes = `stronghold` / `stronghold-index` → null, reminder deletes,
 * the Stores moves (loot entries, `party-item`, `party-pot`, `stores-coin` → null).
 */
export const StrongholdDeleted = defineEvent({
  type: "StrongholdDeleted",
  payload: z.strictObject({
    strongholdId: Id,
    reminderIds: z.array(Id),
    entryIds: z.array(Id),
  }),
  logged: true,
  undoable: false,
});
