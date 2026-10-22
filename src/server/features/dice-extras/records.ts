// Record type `dice-look` (FR-DICEX-25): campaign scope, full to the DM and every player, always
// in the snapshot (not lazy: a throw draws the roller's look in the frame its entry arrives).
// *(Sprint 8, TT0)* `roll-macro` and `roll-request` (FR-DICEX-64, -67, -73).
import { DICE_LOOK_TYPE, DiceLookRecord } from "@shared/dice-extras/looks";
import { macroVisibleTo, ROLL_MACRO_TYPE, RollMacroRecord } from "@shared/dice-extras/macros";
import {
  CLOSED_REQUESTS_WINDOW,
  ROLL_REQUEST_TYPE,
  RollRequestRecord,
  requestPinned,
} from "@shared/dice-extras/requests";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import { listLooks } from "./rows";
import { listMacros, requestWindow } from "./table-rows";

/** FR-DICEX-25: everyone in the campaign; the scope gate keeps other campaigns out. */
export const lookVisibility = (): Visibility => "full";

export const diceLookType = defineRecordType<DiceLookRecord>({
  type: DICE_LOOK_TYPE,
  scope: "campaign",
  schema: DiceLookRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: lookVisibility,
  snapshot: ({ db }, v) => listLooks(db, v.campaignId),
});

/** FR-DICEX-67: a player gets the macros they use (`playerId` = them); the DM gets all (registry). */
export const macroVisibility = (r: RollMacroRecord, v: Viewer): Visibility =>
  v.playerId !== null && macroVisibleTo(r, v.playerId) ? "full" : "hidden";

/** `roll-macro` (FR-DICEX-64, -67): in the snapshot, every row (≤ 200 per campaign). */
export const rollMacroType = defineRecordType<RollMacroRecord>({
  type: ROLL_MACRO_TYPE,
  scope: "campaign",
  schema: RollMacroRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: macroVisibility,
  snapshot: ({ db }, v) => listMacros(db, v.campaignId),
});

/**
 * `roll-request` (FR-DICEX-73, ADR-0061): DM only (no player snapshot key, upsert or load); window
 * = open pinned + newest 10 closed by `seq`.
 */
export const rollRequestType = defineRecordType<RollRequestRecord>({
  type: ROLL_REQUEST_TYPE,
  scope: "campaign",
  audience: "dm",
  schema: RollRequestRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  window: { orderBy: "seq", size: CLOSED_REQUESTS_WINDOW, pin: requestPinned },
  snapshot: ({ db }, v) => requestWindow(db, v.campaignId),
});
