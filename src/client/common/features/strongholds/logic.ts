// Pure client rules of the Strongholds tab and the Stronghold window (HOLD §6.3, FR-HOLD-22–34):
// the list rows, state summary, figures, totals, order suggestions, confirm texts, the editors'
// drafts (validated with the shared zod inputs) and the reminder prefill. No React here.
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { formatCoins } from "@shared/party-loot/format";
import { COINS, type Coins, ZERO_COINS } from "@shared/party-loot/schemas";
import { REMINDER_SOURCE_MAX, REMINDER_TEXT_MAX } from "@shared/reminders/schemas";
import {
  FACILITY_STATES,
  FacilityInput,
  type FacilityState,
  StaffInput,
  type StrongholdIndexRecord,
  type StrongholdView,
} from "@shared/strongholds/schemas";
import type { RollRequest } from "../dice-roll-log/roll-control";

export const HOLD_WINDOW_KIND = "hold.stronghold";
/** FR-PARTY-71: the Party Manager tab id. */
export const HOLD_PARTY_TAB = "strongholds";

/** FR-HOLD-24's tabs in order (*(S9)* Stores: RS3, FR-HOLD-28). */
export const HOLD_TABS = ["facilities", "staff", "stores", "reminders", "notes"] as const;
export type HoldTab = (typeof HOLD_TABS)[number];
export const HOLD_TAB_LABELS: Record<HoldTab, string> = {
  facilities: "Facilities",
  staff: "Staff",
  stores: "Stores",
  reminders: "Reminders",
  notes: "Notes",
};

export const HOLD_GONE = "This stronghold isn't available";
export const FACILITY_REMOVED = "This facility was removed";
export const STAFF_REMOVED = "This staff member was removed";
export const CHANGED_ELSEWHERE = "Changed in another tab";
export const LOST_HOLD = "Connection lost — check the stronghold before saving again";
export const WHOLE_STRONGHOLD = "Whole stronghold";

export interface HoldViewer {
  role: "dm" | "player";
}

/** A facility / staff row as either viewer holds it (`dmOnly` only on the DM's). */
export type FacilityView = StrongholdView["facilities"][number];
export type StaffView = StrongholdView["staff"][number];

export const isDmOnly = (r: object): boolean => (r as { dmOnly?: boolean }).dmOnly === true;

/** FR-PARTY-72: the Strongholds tab shows for the DM always, for a player while ≥ 1 index row. */
export function holdTabVisible(viewer: HoldViewer, indexRows: number): boolean {
  return viewer.role === "dm" || indexRows > 0;
}

/** FR-HOLD-22: list rows by name (case-insensitive, then id). */
export function byName<T extends { name: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const c = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return c !== 0 ? c : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** FR-HOLD-22: "3 built · 1 building · 1 planned" over the facilities the viewer receives. */
export function stateSummary(facilities: readonly { state: FacilityState }[]): string {
  const order: FacilityState[] = ["built", "building", "planned", "replaced"];
  return order
    .map((s) => [s, facilities.filter((f) => f.state === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(" · ");
}

const thousands = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

/** FR-HOLD-25: "Cost 500 gp · 20 days · Upkeep 5 gp", empty parts left out. */
export function figuresLine(f: Pick<FacilityView, "cost" | "buildDays" | "upkeep">): string {
  const parts: string[] = [];
  if (f.cost !== null) parts.push(`Cost ${thousands(f.cost)} gp`);
  if (f.buildDays !== null) parts.push(`${f.buildDays} ${f.buildDays === 1 ? "day" : "days"}`);
  if (f.upkeep !== null) parts.push(`Upkeep ${thousands(f.upkeep)} gp`);
  return parts.join(" · ");
}

/** FR-HOLD-25: "Replaced by ‹name›" per facility id (the replacing ones the viewer receives). */
export function replacedBy(facilities: readonly FacilityView[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of facilities) {
    if (f.replacesId !== null && !out.has(f.replacesId)) out.set(f.replacesId, f.name);
  }
  return out;
}

/** FR-HOLD-25: staff names per facility id, in the DM's staff order. */
export function staffByFacility(staff: readonly StaffView[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of staff) {
    if (m.facilityId === null) continue;
    out.set(m.facilityId, [...(out.get(m.facilityId) ?? []), m.name]);
  }
  return out;
}

/**
 * FR-HOLD-31: "Upkeep 15 gp · Wages 6 gp" over the rows the viewer receives; the DM's line adds
 * "(incl. DM only)" when a DM-only row adds to either sum.
 */
export function totalsLine(r: Pick<StrongholdView, "facilities" | "staff">): string {
  const upkeep = r.facilities.reduce((n, f) => n + (f.upkeep ?? 0), 0);
  const wages = r.staff.reduce((n, m) => n + (m.wage ?? 0), 0);
  const hidden =
    r.facilities.some((f) => isDmOnly(f) && (f.upkeep ?? 0) > 0) ||
    r.staff.some((m) => isDmOnly(m) && (m.wage ?? 0) > 0);
  const line = `Upkeep ${thousands(upkeep)} gp · Wages ${thousands(wages)} gp`;
  return hidden ? `${line} (incl. DM only)` : line;
}

export const SUGGESTIONS_MAX = 20;

/**
 * FR-HOLD-32 (OQ-HOLD-04 B): distinct non-empty orders already used in the loaded strongholds,
 * most used first (ties by first use), ≤ 20. No built-in list (FR-HOLD-40).
 */
export function orderSuggestions(records: readonly Pick<StrongholdView, "facilities">[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const f of r.facilities) {
      if (f.order !== "") counts.set(f.order, (counts.get(f.order) ?? 0) + 1);
    }
  }
  const first = [...counts.keys()];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || first.indexOf(a[0]) - first.indexOf(b[0]))
    .slice(0, SUGGESTIONS_MAX)
    .map(([o]) => o);
}

const reminders = (n: number) => (n === 1 ? "1 reminder is" : `${n} reminders are`);

/**
 * FR-HOLD-17's confirm body under its "Remove ‹name›?" title (BL-104: not the title again): it
 * leaves the list, its linked reminders go, the staff who work there stay with no facility.
 */
export function removeFacilityBody(reminderCount: number, staffCount: number): string {
  const parts = [
    "It leaves the Facilities list",
    reminderCount === 0
      ? "no reminders are linked to it"
      : `its ${reminders(reminderCount)} removed too`,
  ];
  if (staffCount === 1) parts.push("1 staff member who works there stays, unassigned");
  else if (staffCount > 1) parts.push(`${staffCount} staff who work there stay, unassigned`);
  return `${parts.join("; ")}.`;
}

/**
 * FR-HOLD-19's confirm: reminders removed and what the Stores send to the party, including a
 * negative balance the pot pays (review ruling 9).
 */
export function deleteText(
  name: string,
  reminderCount: number,
  storesItems: number,
  coins: Coins = ZERO_COINS,
): string {
  const plus = { ...ZERO_COINS };
  const owed = { ...ZERO_COINS };
  for (const k of COINS) {
    if (coins[k] > 0) plus[k] = coins[k];
    if (coins[k] < 0) owed[k] = -coins[k];
  }
  const moving = [
    ...(storesItems > 0 ? [`${storesItems} ${storesItems === 1 ? "item" : "items"}`] : []),
    ...(formatCoins(plus) ? [formatCoins(plus)] : []),
  ];
  const owes = formatCoins(owed);
  const head = `Delete ${name}? ${reminders(reminderCount)} removed`;
  if (moving.length === 0 && !owes) return `${head}; its Stores are empty.`;
  const move = moving.length > 0 ? `its Stores (${moving.join(", ")}) move to the party` : "";
  if (!owes) return `${head}; ${move}.`;
  const pays = "the party pot pays it";
  return move
    ? `${head}; ${move}; they owe ${owes}: ${pays}.`
    : `${head}; its Stores owe ${owes}: ${pays}.`;
}

// ---- Editors (FR-HOLD-26, -27) ----

/** Form state of the facility editor: numbers as typed. */
export interface FacilityDraft {
  name: string;
  state: FacilityState;
  cost: string;
  buildDays: string;
  upkeep: string;
  incomeDice: string;
  effect: string;
  order: string;
  replacesId: string | null;
  dmOnly: boolean;
}

export const NEW_FACILITY: FacilityDraft = {
  name: "",
  state: "planned",
  cost: "",
  buildDays: "",
  upkeep: "",
  incomeDice: "",
  effect: "",
  order: "",
  replacesId: null,
  dmOnly: false,
};

const numText = (n: number | null) => (n === null ? "" : String(n));

export function facilityDraft(f: FacilityView): FacilityDraft {
  return {
    name: f.name,
    state: f.state,
    cost: numText(f.cost),
    buildDays: numText(f.buildDays),
    upkeep: numText(f.upkeep),
    incomeDice: f.incomeDice ?? "",
    effect: f.effect,
    order: f.order,
    replacesId: f.replacesId,
    dmOnly: isDmOnly(f),
  };
}

/** "" → null; a whole number → it; anything else → NaN (fails the schema's int check). */
const numOf = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));

/** The `facility` payload of `hold.saveFacility` (unvalidated). */
export function facilityPayload(d: FacilityDraft, id?: string) {
  return {
    ...(id === undefined ? {} : { id }),
    name: d.name,
    state: d.state,
    cost: numOf(d.cost),
    buildDays: numOf(d.buildDays),
    upkeep: numOf(d.upkeep),
    incomeDice: d.incomeDice.trim() === "" ? null : d.incomeDice,
    effect: d.effect,
    order: d.order,
    replacesId: d.replacesId,
    dmOnly: d.dmOnly,
  };
}

export type FieldErrors = Partial<Record<string, string>>;

/** FR-HOLD-04 mirrored: field → first message; `{}` = valid. */
export function facilityErrors(d: FacilityDraft, id?: string): FieldErrors {
  const r = FacilityInput.safeParse(facilityPayload(d, id));
  if (r.success) return id !== undefined && d.replacesId === id ? { replacesId: "Not itself" } : {};
  const out: FieldErrors = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? "form");
    out[k] ??= i.path[0] === undefined ? i.message : fieldMessage(k, i.message);
  }
  return out;
}

const NUMBER_FIELDS: Record<string, string> = {
  cost: "Cost",
  buildDays: "Days",
  upkeep: "Upkeep",
  wage: "Wage",
};

/** Number fields read "‹Field›: a whole number, 0 or more" whatever zod's wording. */
function fieldMessage(k: string, message: string): string {
  const label = NUMBER_FIELDS[k];
  return label ? `${label}: a whole number, 0 or more` : message;
}

/** The incomeDice live check (FR-HOLD-26): the notation's message or null. */
export function diceError(d: FacilityDraft): string | null {
  return facilityErrors(d).incomeDice ?? null;
}

export interface StaffDraft {
  name: string;
  role: string;
  wage: string;
  notes: string;
  facilityId: string | null;
  dmOnly: boolean;
}

export const NEW_STAFF: StaffDraft = {
  name: "",
  role: "",
  wage: "",
  notes: "",
  facilityId: null,
  dmOnly: false,
};

export function staffDraft(m: StaffView): StaffDraft {
  return {
    name: m.name,
    role: m.role,
    wage: numText(m.wage),
    notes: m.notes,
    facilityId: m.facilityId,
    dmOnly: isDmOnly(m),
  };
}

export function staffPayload(d: StaffDraft, id?: string) {
  return {
    ...(id === undefined ? {} : { id }),
    name: d.name,
    role: d.role,
    wage: numOf(d.wage),
    notes: d.notes,
    facilityId: d.facilityId,
    dmOnly: d.dmOnly,
  };
}

export function staffErrors(d: StaffDraft, id?: string): FieldErrors {
  const r = StaffInput.safeParse(staffPayload(d, id));
  if (r.success) return {};
  const out: FieldErrors = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? "form");
    out[k] ??= fieldMessage(k, i.message);
  }
  return out;
}

/** Drafts compare by value (Save disabled while unchanged). */
export const sameDraft = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

export const STATE_LABELS: Record<FacilityState, string> = {
  planned: "Planned",
  building: "Building",
  built: "Built",
  replaced: "Replaced",
};
export { FACILITY_STATES };

// ---- Reminders (FR-HOLD-29) ----

/** A reminder row as either viewer holds it (only the keys this tab reads). */
export interface LinkedReminder {
  id: string;
  characterId: string | null;
  text: string;
  source: string;
  strongholdId: string | null;
  facilityId: string | null;
  createdAt: string;
  dmOnly?: boolean;
  linkHidden?: boolean;
}

export interface ReminderGroup<T extends LinkedReminder = LinkedReminder> {
  /** null = the whole stronghold. */
  facilityId: string | null;
  label: string;
  rows: T[];
}

const byCreated = (a: LinkedReminder, b: LinkedReminder) =>
  a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1;

/**
 * FR-HOLD-29: this stronghold's reminders the viewer receives, "Whole stronghold" first, then one
 * group per facility in the DM's order; empty groups left out; rows oldest first (FR-REM-17).
 * A reminder on a facility the viewer doesn't receive is never received either (FR-REM-06).
 */
export function reminderGroups<T extends LinkedReminder>(
  strongholdId: string,
  facilities: readonly Pick<FacilityView, "id" | "name">[],
  rows: readonly T[],
): ReminderGroup<T>[] {
  const mine = rows.filter((r) => r.strongholdId === strongholdId).sort(byCreated);
  const groups: ReminderGroup<T>[] = [
    { facilityId: null, label: WHOLE_STRONGHOLD, rows: mine.filter((r) => r.facilityId === null) },
    ...facilities.map((f) => ({
      facilityId: f.id,
      label: f.name,
      rows: mine.filter((r) => r.facilityId === f.id),
    })),
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** FR-HOLD-17: how many reminders the removal of a facility deletes (the DM receives them all). */
export const facilityReminderCount = (facilityId: string, rows: readonly LinkedReminder[]) =>
  rows.filter((r) => r.facilityId === facilityId).length;

export const strongholdReminderCount = (strongholdId: string, rows: readonly LinkedReminder[]) =>
  rows.filter((r) => r.strongholdId === strongholdId).length;

/** The REM editor's prefill (FR-HOLD-29): `rem.save` fields without `id`. */
export interface ReminderPrefill {
  target: { kind: "party" };
  text: string;
  source: string;
  strongholdId: string;
  facilityId: string | null;
}

/**
 * FR-HOLD-29: **Add reminder** (link = the stronghold, source "‹Stronghold›") or, with a facility,
 * **Make reminder** (text = its effect cut to 500, source "‹Stronghold›: ‹Facility›", link = the
 * facility, target Party). Source cut to REM's 60.
 */
export function reminderPrefill(
  hold: { id: string; name: string },
  facility?: Pick<FacilityView, "id" | "name" | "effect">,
): ReminderPrefill {
  const source = facility ? `${hold.name}: ${facility.name}` : hold.name;
  return {
    target: { kind: "party" },
    text: facility ? facility.effect.slice(0, REMINDER_TEXT_MAX) : "",
    source: source.slice(0, REMINDER_SOURCE_MAX),
    strongholdId: hold.id,
    facilityId: facility?.id ?? null,
  };
}

/** The window's title while the record loads: the index row's name (FR-HOLD-23). */
export const titleOf = (id: string | null, index: readonly StrongholdIndexRecord[]) =>
  (id && index.find((r) => r.id === id)?.name) ?? null;

/** FR-HOLD-30: players see the Notes tab only when the notes are visible and non-empty. */
export function visibleTabs(viewer: HoldViewer, r: Pick<StrongholdView, "notes">): HoldTab[] {
  if (viewer.role === "dm") return [...HOLD_TABS];
  return HOLD_TABS.filter((t) => t !== "notes" || (r.notes ?? "") !== "");
}

// ---- Income dice (FR-HOLD-33) ----

/**
 * The income roll's `dice.roll`, as a General macro sends it (FR-DICEX-68's `macroRollIntent`,
 * kept here so the dice-extras module stays out of the initial chunk): label "‹Facility› income",
 * category `other`, no actor (the DM rolls as "DM", a player as "Me").
 */
export function incomeRollIntent(
  f: { name: string; incomeDice: string },
  r: RollRequest,
): DiceRollIntent {
  const intent: DiceRollIntent = {
    expression: f.incomeDice,
    mode: r.mode,
    category: "other",
    label: `${f.name} income`,
  };
  if (r.manual?.[0]) intent.manual = r.manual[0];
  if (r.public !== undefined) intent.public = r.public;
  return intent;
}
