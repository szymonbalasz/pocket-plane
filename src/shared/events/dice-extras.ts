// Domain events of dice-extras (DICEX §9). Throws need no event (derived from `roll` entries).
import { z } from "zod";
import { defineEvent } from "./types";

/** `dicex.setLook` (FR-DICEX-26): changes = one `dice-look` upsert; every player sees it. */
export const DiceLookSet = defineEvent({
  type: "DiceLookSet",
  payload: z.strictObject({ lookId: z.string().min(1).max(64) }),
  logged: true,
  undoable: false,
});

// ---- Sprint 8 (TT): macros and roll requests (DICEX §9, FR-DICEX-66–92). All logged, none undoable.

const Id = z.string().min(1).max(64);

/** `dicex.saveMacro` / `dicex.moveMacro`: `roll-macro` upsert(s); a player sees iff `playerId` = them. */
export const MacroSaved = defineEvent({
  type: "MacroSaved",
  payload: z.strictObject({ macroId: Id }),
  logged: true,
  undoable: false,
});

/** `dicex.deleteMacro`: `roll-macro` delete (+ the list's re-ordered upserts). */
export const MacroDeleted = defineEvent({
  type: "MacroDeleted",
  payload: z.strictObject({ macroId: Id }),
  logged: true,
  undoable: false,
});

/**
 * `dicex.request` (FR-DICEX-74): `roll-request` upsert (DM only), then `NotificationCreated` per
 * target. Players get **no frame** for it (FR-SYNC-17); a target gets its prompt via the latter.
 */
export const RollRequested = defineEvent({
  type: "RollRequested",
  payload: z.strictObject({ requestId: Id }),
  logged: true,
  undoable: false,
});

/**
 * `dicex.answerRequest` (FR-DICEX-78): the answer entry (audience FR-DICEX-77) + request upsert,
 * then `NotificationResolved`.
 */
export const RollRequestAnswered = defineEvent({
  type: "RollRequestAnswered",
  payload: z.strictObject({ requestId: Id, characterId: Id, entryId: Id }),
  logged: true,
  undoable: false,
});

/** `dicex.declineRequest` (FR-DICEX-79): request upsert, then `NotificationResolved`. */
export const RollRequestDeclined = defineEvent({
  type: "RollRequestDeclined",
  payload: z.strictObject({ requestId: Id, characterId: Id }),
  logged: true,
  undoable: false,
});

/**
 * `dicex.closeRequest` / `dicex.rollForMissing` (FR-DICEX-80, -81): request upsert (+ the entries
 * rolled for missing targets, `rolled` = their ids), then `NotificationResolved` per open target.
 */
export const RollRequestClosed = defineEvent({
  type: "RollRequestClosed",
  payload: z.strictObject({ requestId: Id, rolled: z.array(Id).min(1).max(12).optional() }),
  logged: true,
  undoable: false,
});
