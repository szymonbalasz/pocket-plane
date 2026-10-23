// Reminders, client side (REM §6.4, CHARX FR-CHARX-100–102): the groups a viewer sees, who may
// add / edit / delete, the roll-as actor per surface, the `dice.roll` a roll button sends, and the
// editor's draft, checks and `rem.save` input. Pure; `RemindersTab.tsx`, `ReminderRow.tsx` and
// `ReminderEditor.tsx` render them. No mechanics: a reminder's roll is a plain roll (FR-REM-21).
import { parseExpression } from "@shared/dice-roll-log/grammar";
import type { DiceRollIntent, RollCategory } from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import {
  byCreated,
  REMINDER_TYPE,
  type ReminderView,
  SaveReminderIntent,
} from "@shared/reminders/schemas";
import type { RollRequest } from "../dice-roll-log/roll-control";

export interface RemViewer {
  role: "dm" | "player";
  playerId: string | null;
}

/** The entity fields reminders read (players hold every character, FR-ENT-15). */
export interface RemCharacter {
  id: string;
  name: string;
  kind: string;
  ownerPlayerId?: string | null;
}

/** `rem-group` `data-record-id` of the party group. */
export const PARTY = "party";

/** Where the list renders: the Party Manager tab, or one character's sheet tab (FR-CHARX-101). */
export type RemSurface = { kind: "party" } | { kind: "sheet"; characterId: string };

export interface ReminderGroup {
  /** `party` or the character id. */
  key: string;
  characterId: string | null;
  title: string;
  /** The character's owner (colour dot); null for the party. */
  ownerPlayerId: string | null;
  rows: ReminderView[];
  /** "+ Add" on this group (FR-REM-20). */
  canAdd: boolean;
}

export const isCharacter = (e: RemCharacter) => e.kind === "character";

const byName = (a: RemCharacter, b: RemCharacter) =>
  a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);

/** The characters a viewer may aim a reminder at (FR-REM-08): the DM all, a player own ones. */
export function targetCharacters(
  entities: readonly RemCharacter[],
  viewer: RemViewer,
): RemCharacter[] {
  return entities
    .filter(isCharacter)
    .filter(
      (c) => viewer.role === "dm" || (!!viewer.playerId && c.ownerPlayerId === viewer.playerId),
    )
    .sort(byName);
}

/**
 * FR-REM-17: Party first, then one group per character by name (the DM every character, a
 * player their own); rows in creation order. On a sheet (FR-CHARX-101): that character's rows,
 * then Party. A row whose group isn't listed (a race with an owner change) is left out.
 */
export function reminderGroups(
  rows: readonly ReminderView[],
  viewer: RemViewer,
  entities: readonly RemCharacter[],
  surface: RemSurface = { kind: "party" },
): ReminderGroup[] {
  const own = targetCharacters(entities, viewer);
  const chars =
    surface.kind === "party"
      ? own
      : entities.filter((c) => isCharacter(c) && c.id === surface.characterId);
  const mayAdd = new Set(own.map((c) => c.id));
  const party: ReminderGroup = {
    key: PARTY,
    characterId: null,
    title: "Party",
    ownerPlayerId: null,
    rows: [],
    canAdd: true,
  };
  const groups = new Map<string, ReminderGroup>([[PARTY, party]]);
  for (const c of chars) {
    groups.set(c.id, {
      key: c.id,
      characterId: c.id,
      title: c.name,
      ownerPlayerId: c.ownerPlayerId ?? null,
      rows: [],
      canAdd: mayAdd.has(c.id),
    });
  }
  for (const r of rows) groups.get(r.characterId ?? PARTY)?.rows.push(r);
  for (const g of groups.values()) g.rows.sort(byCreated);
  const list = [...groups.values()];
  // The sheet lists its character first, then Party.
  return surface.kind === "sheet" ? [...list.slice(1), party] : list;
}

/** FR-REM-08: the DM any row; a player rows they created, still on the party or an own PC. */
export function canEditReminder(
  r: Pick<ReminderView, "createdByPlayerId" | "characterId">,
  viewer: RemViewer,
  entities: readonly RemCharacter[],
): boolean {
  if (viewer.role === "dm") return true;
  if (!viewer.playerId || r.createdByPlayerId !== viewer.playerId) return false;
  if (r.characterId === null) return true;
  return entities.some(
    (c) => c.id === r.characterId && isCharacter(c) && c.ownerPlayerId === viewer.playerId,
  );
}

/** DM view keys (FR-REM-13: players never receive them). */
export const dmOnlyOf = (r: ReminderView) => ("dmOnly" in r ? r.dmOnly : false);
export const linkHiddenOf = (r: ReminderView) => ("linkHidden" in r ? r.linkHidden : false);

/**
 * FR-REM-18: the DM's eye-off Badge text: "DM only", or "Hidden with the stronghold" when only
 * the link hides it; null when players see it (or for a player).
 */
export function hiddenBadge(r: ReminderView): string | null {
  if (dmOnlyOf(r)) return "DM only";
  if (linkHiddenOf(r)) return "Hidden with the stronghold";
  return null;
}

/**
 * FR-REM-21 roll as: a character reminder → that character; a party reminder → in the Party
 * Manager no actor (the player's "Me" / the DM's "DM", as a General macro), on a sheet that
 * sheet's character.
 */
export function rollActor(r: Pick<ReminderView, "characterId">, surface: RemSurface) {
  if (r.characterId !== null) return r.characterId;
  return surface.kind === "sheet" ? surface.characterId : null;
}

export const NOT_LIVE = "Reconnecting…";
export const NOT_YOURS = "Not your character";

/** Rollable now, else the reason (not live; a player rolling as a character not theirs). */
export function rollBlock(
  actorId: string | null,
  viewer: RemViewer,
  entities: readonly RemCharacter[],
  live: boolean,
): string | null {
  if (!live) return NOT_LIVE;
  if (actorId === null || viewer.role === "dm") return null;
  const c = entities.find((e) => e.id === actorId);
  return c && isCharacter(c) && c.ownerPlayerId === viewer.playerId ? null : NOT_YOURS;
}

/** FR-REM-21: a plain `dice.roll` (label = the roll's label), never an attack or apply. */
export function reminderRollIntent(
  roll: { label: string; expression: string; category: RollCategory },
  actorId: string | null,
  r: RollRequest,
): DiceRollIntent {
  const intent: DiceRollIntent = {
    expression: roll.expression,
    mode: r.mode,
    category: roll.category,
    label: roll.label,
  };
  if (actorId) intent.actor = { entityId: actorId };
  if (r.manual?.[0]) intent.manual = r.manual[0];
  if (r.public !== undefined) intent.public = r.public;
  return intent;
}

/** FR-CHARX-100: this character's visible reminders, once `reminder` is loaded; else null. */
export function reminderCount(
  store: RecordStore,
  characterId: string,
  loaded: (type: string) => boolean,
): number | null {
  if (!loaded(REMINDER_TYPE)) return null;
  const rows = Object.values(store.records[REMINDER_TYPE] ?? {}) as ReminderView[];
  return rows.filter((r) => r.characterId === characterId).length;
}

// ---------- editor ----------

export interface RollDraft {
  /** Kept roll's id (FR-REM-04); absent for a new one. */
  id?: string;
  label: string;
  expression: string;
  category: RollCategory;
}

export interface ReminderDraft {
  id?: string;
  /** `party` or a character id. */
  target: string;
  text: string;
  source: string;
  rolls: RollDraft[];
  dmOnly: boolean;
  strongholdId: string | null;
  facilityId: string | null;
}

/** A draft from a row (Edit) or a target preset (+ Add). */
export function draftOf(r: ReminderView | null, target: string = PARTY): ReminderDraft {
  if (!r) {
    return {
      target,
      text: "",
      source: "",
      rolls: [],
      dmOnly: false,
      strongholdId: null,
      facilityId: null,
    };
  }
  return {
    id: r.id,
    target: r.characterId ?? PARTY,
    text: r.text,
    source: r.source,
    rolls: r.rolls.map((x) => ({ ...x })),
    dmOnly: dmOnlyOf(r),
    strongholdId: r.strongholdId,
    facilityId: r.facilityId,
  };
}

export const emptyRoll = (): RollDraft => ({ label: "", expression: "", category: "other" });

/**
 * The `rem.save` input of a draft. The DM sends `dmOnly` and the link; a player never does
 * (FR-REM-08: sent → `forbidden`; the server keeps the stored values, review ruling 10).
 */
export function saveInput(d: ReminderDraft, viewer: RemViewer): SaveReminderIntent {
  return {
    ...(d.id ? { id: d.id } : {}),
    target: d.target === PARTY ? { kind: "party" } : { kind: "character", characterId: d.target },
    text: d.text,
    source: d.source,
    rolls: d.rolls.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      label: r.label,
      expression: r.expression,
      category: r.category,
    })),
    ...(viewer.role === "dm"
      ? { dmOnly: d.dmOnly, strongholdId: d.strongholdId, facilityId: d.facilityId }
      : {}),
  };
}

/** A roll row's expression problem (live check), or null. */
export function expressionError(expression: string): string | null {
  if (expression.trim() === "") return "Dice required";
  const r = parseExpression(expression);
  return r.ok ? null : r.message;
}

/** FR-REM-19: the draft's first problem (FR-REM-02 mirrored; Save disabled), or null. */
export function draftError(d: ReminderDraft, viewer: RemViewer): string | null {
  for (const r of d.rolls) {
    const e = expressionError(r.expression);
    if (e) return e;
  }
  const parsed = SaveReminderIntent.safeParse(saveInput(d, viewer));
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid reminder");
}

/** Canonical form of what a save would write, to tell "unchanged" (Save disabled). */
function canonical(d: ReminderDraft, viewer: RemViewer): string | null {
  const parsed = SaveReminderIntent.safeParse(saveInput(d, viewer));
  if (!parsed.success) return null;
  const v = parsed.data;
  return JSON.stringify([
    v.target,
    v.text,
    v.source,
    v.rolls.map((r) => [r.id ?? null, r.label, r.expression, r.category]),
    v.dmOnly ?? false,
    v.strongholdId ?? null,
    v.facilityId ?? null,
  ]);
}

/** FR-REM-19: an edit that would write the stored row again. A new reminder is never unchanged. */
export function draftUnchanged(
  d: ReminderDraft,
  row: ReminderView | undefined,
  viewer: RemViewer,
): boolean {
  if (!d.id || !row) return false;
  const a = canonical(d, viewer);
  return a !== null && a === canonical(draftOf(row), viewer);
}
