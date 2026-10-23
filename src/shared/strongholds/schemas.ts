// Strongholds (HOLD §6, §8, §9): record `stronghold` (lazy `"all"`; facilities and staff are JSON
// leaves inside it, ADR-0065), the derived snapshot record `stronghold-index` (review ruling 6),
// the `hold.*` intents (DM only) and the pure per-viewer redaction (FR-HOLD-08). Structure only:
// no facility, order or event catalogue (FR-HOLD-40, ADR-0018).
import { z } from "zod";
import { CanonicalNotation } from "../reminders/schemas";
import { cleanLine, cleanMultiline } from "../reminders/text";

export const STRONGHOLD_TYPE = "stronghold";
export const STRONGHOLD_INDEX_TYPE = "stronghold-index";

export const HOLD_INTENTS = {
  create: "hold.create",
  update: "hold.update",
  saveFacility: "hold.saveFacility",
  saveStaff: "hold.saveStaff",
  moveRow: "hold.moveRow",
  removeStaff: "hold.removeStaff",
  removeFacility: "hold.removeFacility",
  delete: "hold.delete",
} as const;

/** FR-HOLD-02 caps. */
export const STRONGHOLDS_MAX = 8;
export const FACILITIES_MAX = 24;
export const STAFF_MAX = 40;
/** FR-HOLD-03–05 bounds. */
export const HOLD_NAME_MAX = 60;
export const DEFENDERS_MAX = 9_999;
export const HOLD_NOTES_MAX = 4_000;
export const FACILITY_EFFECT_MAX = 600;
export const FACILITY_ORDER_MAX = 80;
export const STAFF_ROLE_MAX = 40;
export const STAFF_NOTES_MAX = 200;
export const COST_MAX = 999_999;
export const BUILD_DAYS_MAX = 999;
export const UPKEEP_MAX = 99_999;
export const WAGE_MAX = 99_999;

export const FACILITY_STATES = ["planned", "building", "built", "replaced"] as const;
export const FacilityState = z.enum(FACILITY_STATES);
export type FacilityState = z.infer<typeof FacilityState>;

export const HOLD_LISTS = ["facilities", "staff"] as const;

/** FR-HOLD-02: "‹What› limit reached (‹n›)". */
export const limitMessage = (what: string, n: number) => `${what} limit reached (${n})`;
export const STRONGHOLD_NOT_FOUND = "Stronghold not found";
export const FACILITY_GONE = "Facility is gone";
export const STAFF_GONE = "Staff member is gone";
export const NAME_TAKEN = "A stronghold with that name exists";
export const PARTY_FULL_ON_DELETE = "Party inventory is full (60) — move or remove items first";
/** FR-LOOT-38: the delete's auto-move text (empty when the Stores was hidden, review ruling 3a). */
export const DELETED_TEXT = "Stronghold deleted";

const Id = z.string().min(1).max(64);
const gp = (max: number) => z.int().min(0).max(max);

export const StrongholdName = cleanLine(1, HOLD_NAME_MAX, "Name");

/** FR-HOLD-04: a facility's fields (strict; defaults for the optional ones). */
const facilityFields = {
  name: cleanLine(1, HOLD_NAME_MAX, "Name"),
  state: FacilityState,
  cost: gp(COST_MAX).nullable().default(null),
  buildDays: z.int().min(0).max(BUILD_DAYS_MAX).nullable().default(null),
  upkeep: gp(UPKEEP_MAX).nullable().default(null),
  incomeDice: CanonicalNotation.nullable().default(null),
  effect: cleanMultiline(0, FACILITY_EFFECT_MAX, "Effect").default(""),
  order: cleanLine(0, FACILITY_ORDER_MAX, "Order").default(""),
  replacesId: Id.nullable().default(null),
  dmOnly: z.boolean().default(false),
};

/** FR-HOLD-05: a staff member's fields. */
const staffFields = {
  name: cleanLine(1, HOLD_NAME_MAX, "Name"),
  role: cleanLine(0, STAFF_ROLE_MAX, "Role").default(""),
  wage: gp(WAGE_MAX).nullable().default(null),
  notes: cleanLine(0, STAFF_NOTES_MAX, "Notes").default(""),
  facilityId: Id.nullable().default(null),
  dmOnly: z.boolean().default(false),
};

export const FacilityInput = z.strictObject({ id: Id.optional(), ...facilityFields });
export type FacilityInput = z.output<typeof FacilityInput>;
export const StaffInput = z.strictObject({ id: Id.optional(), ...staffFields });
export type StaffInput = z.output<typeof StaffInput>;

/** `hold.create` (FR-HOLD-11). */
export const CreateStrongholdIntent = z.strictObject({ name: StrongholdName });
export type CreateStrongholdIntent = z.input<typeof CreateStrongholdIntent>;

/** `hold.update` (FR-HOLD-12): a patch of ≥ 1 header field. */
export const UpdateStrongholdIntent = z
  .strictObject({
    strongholdId: Id,
    name: StrongholdName.optional(),
    dmOnly: z.boolean().optional(),
    defenders: z.int().min(0).max(DEFENDERS_MAX).optional(),
    defendersDmOnly: z.boolean().optional(),
    notes: cleanMultiline(0, HOLD_NOTES_MAX, "Notes").optional(),
    notesDmOnly: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "Change at least one field" });
export type UpdateStrongholdIntent = z.input<typeof UpdateStrongholdIntent>;
export type StrongholdPatch = Omit<z.output<typeof UpdateStrongholdIntent>, "strongholdId">;

/** `hold.saveFacility` (FR-HOLD-13). */
export const SaveFacilityIntent = z.strictObject({ strongholdId: Id, facility: FacilityInput });
export type SaveFacilityIntent = z.input<typeof SaveFacilityIntent>;

/** `hold.saveStaff` (FR-HOLD-14). */
export const SaveStaffIntent = z.strictObject({ strongholdId: Id, staff: StaffInput });
export type SaveStaffIntent = z.input<typeof SaveStaffIntent>;

/** `hold.moveRow` (FR-HOLD-15): index clamped by the command. */
export const MoveRowIntent = z.strictObject({
  strongholdId: Id,
  list: z.enum(HOLD_LISTS),
  id: Id,
  index: z.int().min(0).max(STAFF_MAX),
});
export type MoveRowIntent = z.input<typeof MoveRowIntent>;

export const RemoveStaffIntent = z.strictObject({ strongholdId: Id, staffId: Id });
export type RemoveStaffIntent = z.input<typeof RemoveStaffIntent>;
export const RemoveFacilityIntent = z.strictObject({ strongholdId: Id, facilityId: Id });
export type RemoveFacilityIntent = z.input<typeof RemoveFacilityIntent>;
export const DeleteStrongholdIntent = z.strictObject({ strongholdId: Id });
export type DeleteStrongholdIntent = z.input<typeof DeleteStrongholdIntent>;

export const StrongholdResult = z.strictObject({ strongholdId: z.string() });
export type StrongholdResult = z.infer<typeof StrongholdResult>;
export const FacilityResult = z.strictObject({ facilityId: z.string() });
export type FacilityResult = z.infer<typeof FacilityResult>;
export const StaffResult = z.strictObject({ staffId: z.string() });
export type StaffResult = z.infer<typeof StaffResult>;

const facilityRecordFields = {
  id: z.string(),
  name: z.string(),
  state: FacilityState,
  cost: z.int().nullable(),
  buildDays: z.int().nullable(),
  upkeep: z.int().nullable(),
  incomeDice: z.string().nullable(),
  effect: z.string(),
  order: z.string(),
  replacesId: z.string().nullable(),
};
const staffRecordFields = {
  id: z.string(),
  name: z.string(),
  role: z.string(),
  wage: z.int().nullable(),
  notes: z.string(),
  facilityId: z.string().nullable(),
};

export const Facility = z.strictObject({ ...facilityRecordFields, dmOnly: z.boolean() });
export type Facility = z.infer<typeof Facility>;
export const Staff = z.strictObject({ ...staffRecordFields, dmOnly: z.boolean() });
export type Staff = z.infer<typeof Staff>;
export const PlayerFacility = z.strictObject(facilityRecordFields);
export type PlayerFacility = z.infer<typeof PlayerFacility>;
export const PlayerStaff = z.strictObject(staffRecordFields);
export type PlayerStaff = z.infer<typeof PlayerStaff>;

/** Record `stronghold`, DM view (HOLD §8). Array order = the DM's order. */
export const StrongholdRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  seq: z.int(),
  name: z.string(),
  dmOnly: z.boolean(),
  defenders: z.int(),
  defendersDmOnly: z.boolean(),
  notes: z.string(),
  notesDmOnly: z.boolean(),
  facilities: z.array(Facility).max(FACILITIES_MAX),
  staff: z.array(Staff).max(STAFF_MAX),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StrongholdRecord = z.infer<typeof StrongholdRecord>;

/**
 * Record `stronghold`, player view (FR-HOLD-08): DM-only rows removed, `defenders` / `notes`
 * omitted when DM-only, every flag, `seq` and `updatedAt` removed.
 */
export const PlayerStrongholdRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  name: z.string(),
  defenders: z.int().optional(),
  notes: z.string().optional(),
  facilities: z.array(PlayerFacility),
  staff: z.array(PlayerStaff),
  createdAt: z.string(),
});
export type PlayerStrongholdRecord = z.infer<typeof PlayerStrongholdRecord>;

export const StrongholdView = z.union([StrongholdRecord, PlayerStrongholdRecord]);
export type StrongholdView = z.infer<typeof StrongholdView>;

/** Derived `stronghold-index` (FR-HOLD-01): DM `{id, campaignId, name, dmOnly?}` (`dmOnly` only when true). */
export const StrongholdIndexRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  name: z.string(),
  dmOnly: z.literal(true).optional(),
});
export type StrongholdIndexRecord = z.infer<typeof StrongholdIndexRecord>;

/** Structural slice of the connection's viewer. */
export interface HoldViewer {
  role: "dm" | "player";
}

/** FR-HOLD-08 / FR-HOLD-01: DM full; a player hidden while `dmOnly`, else redacted. */
export function strongholdVisibility(
  r: { dmOnly?: boolean },
  v: HoldViewer,
): "full" | "redacted" | "hidden" {
  if (v.role === "dm") return "full";
  return r.dmOnly === true ? "hidden" : "redacted";
}

/** FR-HOLD-08 redaction (pure, record only). */
export function redactStronghold(r: StrongholdRecord): PlayerStrongholdRecord {
  const facilities = r.facilities.filter((f) => !f.dmOnly);
  const kept = new Set(facilities.map((f) => f.id));
  const out: PlayerStrongholdRecord = {
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    facilities: facilities.map(({ dmOnly: _d, ...f }) => ({
      ...f,
      replacesId: f.replacesId !== null && kept.has(f.replacesId) ? f.replacesId : null,
    })),
    staff: r.staff
      .filter((m) => !m.dmOnly)
      .map(({ dmOnly: _d, ...m }) => ({
        ...m,
        facilityId: m.facilityId !== null && kept.has(m.facilityId) ? m.facilityId : null,
      })),
    createdAt: r.createdAt,
  };
  if (!r.defendersDmOnly) out.defenders = r.defenders;
  if (!r.notesDmOnly) out.notes = r.notes;
  return out;
}

/** FR-HOLD-01: the index row a stronghold derives. */
export function indexOf(r: Pick<StrongholdRecord, "id" | "campaignId" | "name" | "dmOnly">) {
  const row: StrongholdIndexRecord = { id: r.id, campaignId: r.campaignId, name: r.name };
  if (r.dmOnly) row.dmOnly = true;
  return row;
}

/** FR-HOLD-01 player redaction of an index row: `{id, campaignId, name}`. */
export function redactIndex(r: StrongholdIndexRecord): StrongholdIndexRecord {
  return { id: r.id, campaignId: r.campaignId, name: r.name };
}
