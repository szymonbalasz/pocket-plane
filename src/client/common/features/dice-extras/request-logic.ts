// Roll requests, the DM's side (FR-DICEX-75, -77, -86–88): the composer's choices, targets and
// input, and the cards' rows. Pure; `RequestsWindow.tsx` (lazy) renders them. The prompt's
// logic is `prompt-logic.ts` (initial chunk).
import { type CombatantRecord, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { REQUEST_CATEGORY } from "@shared/dice-extras/request-names";
import type {
  RequestInput,
  RequestResults,
  RequestRoll,
  RequestTarget,
  RollRequestRecord,
} from "@shared/dice-extras/requests";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import { ABILITIES, ABILITY_NAMES, SKILL_NAMES } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";

// ---- DM composer and card (FR-DICEX-86, -87) ----

export interface RollChoice {
  value: string;
  label: string;
  group: "Skills" | "Saves" | "Checks" | "Other";
}

/** The roll Select: every skill, save and check, then Custom. */
export const ROLL_CHOICES: readonly RollChoice[] = [
  ...(Object.keys(SKILL_NAMES) as (keyof typeof SKILL_NAMES)[]).map((k) => ({
    value: `skill:${k}`,
    label: SKILL_NAMES[k],
    group: "Skills" as const,
  })),
  ...ABILITIES.map((a) => ({
    value: `save:${a}`,
    label: `${a.toUpperCase()} save`,
    group: "Saves" as const,
  })),
  ...ABILITIES.map((a) => ({
    value: `check:${a}`,
    label: `${ABILITY_NAMES[a]} check`,
    group: "Checks" as const,
  })),
  { value: "custom", label: "Custom…", group: "Other" },
];

/** The Select value → the request's roll (custom takes the typed expression). */
export function rollOfChoice(value: string, expression: string): RequestRoll {
  if (value === "custom") return { kind: "custom", key: null, expression: expression.trim() };
  const [kind, key] = value.split(":");
  if (kind === "skill") return { kind, key: key as keyof typeof SKILL_NAMES, expression: null };
  return {
    kind: kind === "save" ? "save" : "check",
    key: key as (typeof ABILITIES)[number],
    expression: null,
  };
}

export interface TargetOption {
  id: string;
  name: string;
  /** Why it can't be asked (no owner, hidden from its player); null = eligible. */
  blocked: string | null;
}

/**
 * FR-DICEX-75: every PC; eligible iff it has an owner and is not hidden from players in the
 * started fight (#141). "All PCs" picks the eligible ones only.
 */
export function targetOptions(store: RecordStore): TargetOption[] {
  const entities = Object.values(store.records.entity ?? {}) as {
    id: string;
    name: string;
    kind: string;
    ownerPlayerId?: string | null;
  }[];
  const started = Object.values(store.records[ENCOUNTER_TYPE] ?? {}).find(
    (e) => (e as { status?: string }).status === "started",
  ) as { id: string } | undefined;
  const hidden = new Set(
    (Object.values(store.records.combatant ?? {}) as CombatantRecord[])
      .filter((c) => c.encounterId === started?.id && c.kind === "pc" && c.active && c.hidden)
      .map((c) => c.entityId),
  );
  return entities
    .filter((e) => e.kind === "character")
    .map((e) => ({
      id: e.id,
      name: e.name,
      blocked: !e.ownerPlayerId ? "No player" : hidden.has(e.id) ? "Hidden from players" : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ComposerForm {
  choice: string;
  expression: string;
  targets: readonly string[];
  dc: string;
  dcShown: boolean;
  mode: RollMode;
  results: RequestResults;
  label: string;
}

/** The `dicex.request` input, or the first problem (Send disabled). */
export function composerInput(f: ComposerForm): { input: RequestInput } | { error: string } {
  if (f.targets.length === 0) return { error: "Pick at least one character" };
  if (f.choice === "custom" && f.expression.trim() === "") return { error: "Type the dice" };
  const dc = f.dc.trim() === "" ? null : Number(f.dc);
  if (dc !== null && (!Number.isInteger(dc) || dc < 1 || dc > 40)) {
    return { error: "DC: a whole number 1–40" };
  }
  const label = f.label.trim();
  return {
    input: {
      roll: rollOfChoice(f.choice, f.expression),
      characterIds: [...f.targets],
      dc,
      dcShown: f.dcShown,
      mode: f.mode,
      results: f.results,
      ...(label ? { label } : {}),
    },
  };
}

/** FR-DICEX-77: the eye's preset = the category's public setting. */
export const resultsPreset = (choice: string, isPublic: (c: string) => boolean): RequestResults =>
  isPublic(REQUEST_CATEGORY[rollOfChoice(choice, "1d20").kind]) ? "public" : "hidden";

/** FR-DICEX-87: one target row: Waiting / total ✓ ✗ / Declined / No roll. */
export function targetText(t: RequestTarget): string {
  if (t.state === "open") return "Waiting";
  if (t.state === "declined") return "Declined";
  if (t.state === "missed") return "No roll";
  const mark = t.success === null ? "" : t.success ? " ✓" : " ✗";
  return `${t.total ?? ""}${mark}`;
}

/** Nat 20 / nat 1 tag, else null. */
export const naturalTag = (t: Pick<RequestTarget, "natural">): string | null =>
  t.natural === 20 ? "nat 20" : t.natural === 1 ? "nat 1" : null;

/** Open first (newest first), then the closed window newest first. */
export const requestOrder = (rows: readonly RollRequestRecord[]): RollRequestRecord[] =>
  [...rows].sort((a, b) => (a.state === b.state ? b.seq - a.seq : a.state === "open" ? -1 : 1));

/** FR-DICEX-88: the launcher dot: some request is open. */
export const anyOpen = (rows: readonly Pick<RollRequestRecord, "state">[]): boolean =>
  rows.some((r) => r.state === "open");
