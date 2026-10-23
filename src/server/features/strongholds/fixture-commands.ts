// Internal commands for the fixture loader only (no route, no WS intent; as dice-extras'
// `setLookFor`). A fixture step can name records it created (`r.id`) but not the facilities inside
// a stronghold (JSON leaves, FR-HOLD-01), so these take a facility **by name** and then run the
// real command logic unchanged: `hold.saveFacility` (replaces), `hold.saveStaff` (works in),
// `rem.save` (facility link). Unknown name → `not_found`.
import {
  type SaveReminderIntent,
  SaveReminderIntent as SaveReminderSchema,
} from "@shared/reminders/schemas";
import { FACILITY_GONE, FacilityInput, StaffInput } from "@shared/strongholds/schemas";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { invalid, notFound, zodIssues } from "../../commands/errors";
import { saveReminder } from "../reminders/commands";
import { campaignOf } from "../scenes-map/rows";
import { saveFacilityIn, saveStaffIn } from "./commands";
import { getStronghold } from "./rows";

const Id = z.string().min(1).max(64);

function facilityIdByName(env: CommandEnv, strongholdId: string, name: string): string {
  const hold = getStronghold(env.tx, campaignOf(env.actor), strongholdId);
  const f = hold?.facilities.find((x) => x.name === name);
  if (!f) throw notFound(FACILITY_GONE);
  return f.id;
}

/** `hold.saveFacility` with `replaces` = another facility's name. */
export const saveFacilityByName = defineCommand({
  name: "hold.saveFacilityByName",
  input: z.strictObject({
    strongholdId: Id,
    replaces: z.string().min(1).optional(),
    facility: FacilityInput,
  }),
  execute({ strongholdId, replaces, facility }, env) {
    const replacesId =
      replaces === undefined ? facility.replacesId : facilityIdByName(env, strongholdId, replaces);
    return saveFacilityIn(env, strongholdId, { ...facility, replacesId });
  },
});

/** `hold.saveStaff` with `worksIn` = a facility's name. */
export const saveStaffByName = defineCommand({
  name: "hold.saveStaffByName",
  input: z.strictObject({
    strongholdId: Id,
    worksIn: z.string().min(1).optional(),
    staff: StaffInput,
  }),
  execute({ strongholdId, worksIn, staff }, env) {
    const facilityId =
      worksIn === undefined ? staff.facilityId : facilityIdByName(env, strongholdId, worksIn);
    return saveStaffIn(env, strongholdId, { ...staff, facilityId });
  },
});

/** `rem.save` (DM) linked to `facility` (a name) of `reminder.strongholdId`. */
export const saveReminderByName = defineCommand({
  name: "rem.saveByName",
  input: z.strictObject({
    facility: z.string().min(1),
    reminder: z.custom<SaveReminderIntent & { strongholdId: string }>(
      (v) => typeof v === "object" && v !== null,
    ),
  }),
  execute({ facility, reminder }, env) {
    const facilityId = facilityIdByName(env, reminder.strongholdId, facility);
    const parsed = SaveReminderSchema.safeParse({ ...reminder, facilityId });
    if (!parsed.success) throw invalid("Invalid reminder", zodIssues(parsed.error));
    return saveReminder.execute(parsed.data, env);
  },
});
