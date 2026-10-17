// Roll-control preview hooks (FR-MOD-27, -18): the store slice `rollPreview` reads, the lazily
// loaded `rule-trigger` rows (FR-MOD-47: loaded only once a physical form or the tray needs the
// groups; until then bonus dice only, and the server rolls missing `t:` groups), and one
// control's preview per expression. Used by the shared roll control (`dice-roll-log`) and MOD's
// tray-extras line; feature logic stays in `@shared/effect-modifiers/preview`.
import type { RollMode } from "@shared/dice-roll-log/schemas";
import {
  modeFor,
  PREVIEW_TYPES,
  type PreviewGroup,
  type PreviewTrigger,
  previewText,
  type RollPreview,
  RULE_TRIGGER_TYPE,
  rollPreview,
} from "@shared/effect-modifiers/preview";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import { isLoaded, wholeToRequest } from "@shared/protocol/lazy";
import type { RecordMap, RecordStore } from "@shared/protocol/store";
import { useEffect, useMemo } from "react";
import { type SyncState, useSync } from "../../sync/store";

/** The record maps the preview reads; stable while none of them changes. */
function usePreviewStore(triggers: RecordMap[string] | undefined): RecordStore {
  const effect = useSync((s) => s.store.records[PREVIEW_TYPES[0]]);
  const preset = useSync((s) => s.store.records[PREVIEW_TYPES[1]]);
  const combatant = useSync((s) => s.store.records[PREVIEW_TYPES[2]]);
  const encounter = useSync((s) => s.store.records[PREVIEW_TYPES[3]]);
  const entity = useSync((s) => s.store.records[PREVIEW_TYPES[4]]);
  const imported = useSync((s) => s.store.records[PREVIEW_TYPES[5]]);
  const state = useSync((s) => s.store.records[PREVIEW_TYPES[6]]);
  const sheet = useSync((s) => s.store.records[PREVIEW_TYPES[7]]);
  return useMemo(() => {
    const maps = [effect, preset, combatant, encounter, entity, imported, state, sheet];
    const records: RecordMap = {};
    PREVIEW_TYPES.forEach((t, i) => {
      const m = maps[i];
      if (m) records[t] = m;
    });
    if (triggers) records[RULE_TRIGGER_TYPE] = triggers;
    return { you: null, seq: 0, records };
  }, [effect, preset, combatant, encounter, entity, imported, state, sheet, triggers]);
}

/**
 * FR-MOD-47: the loaded `rule-trigger` rows (none until loaded). `load` asks for the type once
 * per snapshot generation (`sync.load`); a reject leaves it unloaded (bonus dice only).
 */
export function useTriggerRows(load: boolean): RecordMap[string] | undefined {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const lazy = useSync((s) => s.lazy) as SyncState["lazy"] | undefined;
  const byId = useSync((s) => s.store.records[RULE_TRIGGER_TYPE]);
  const needs = load && lazy !== undefined && wholeToRequest(lazy, RULE_TRIGGER_TYPE);
  useEffect(() => {
    if (live && needs) connection.load(RULE_TRIGGER_TYPE)?.catch(() => {});
  }, [connection, live, needs]);
  return lazy && isLoaded(lazy.loaded, RULE_TRIGGER_TYPE) ? byId : undefined;
}

/** `RollControlOptions.subject`: one subject (the first expression) or one per expression. */
export type SubjectOption = RollSubject | readonly (RollSubject | null)[];

/** The subjects aligned with the control's expressions (null = no subject, tier-1 roll). */
export function subjectsOf(
  subject: SubjectOption | undefined,
  count: number,
): (RollSubject | null)[] {
  const list: readonly (RollSubject | null)[] =
    subject === undefined ? [] : Array.isArray(subject) ? subject : [subject as RollSubject];
  return Array.from({ length: count }, (_, i) => list[i] ?? null);
}

/** One control's preview (FR-MOD-27): mode for a roller mode, groups per expression, text. */
export interface ControlPreview {
  /** Any expression has a subject (the control then sends `manualParts` with a manual roll). */
  active: boolean;
  /** FR-MOD-17: the mode the d20 roll is expected to roll with; no subject → `roller`. */
  modeFor(roller: RollMode): RollMode;
  /**
   * FR-MOD-18: expression `i`'s physical groups. `crit` = that roll is a crit's damage (a
   * natural 20 typed, or the caller's `crit`), `toHitMode` = the to-hit's mode of this roll.
   */
  groups(i: number, opts?: { crit?: boolean; toHitMode?: RollMode }): PreviewGroup[];
  /** "Bless +1d4 · Divine Fury 1d6+2 (on a hit)"; null = no part. */
  text: string | null;
}

const D20_ROLLS = new Set(["attack", "save", "check", "initiative"]);

/** No subject: the roller's mode, no groups, no text (tier 1). */
export const NO_PREVIEW: ControlPreview = {
  active: false,
  modeFor: (r) => r,
  groups: () => [],
  text: null,
};

/** `rollPreview` per subject; `loadTriggers` = the groups are needed now (form / tray open). */
export function useRollPreview(
  subject: SubjectOption | undefined,
  count: number,
  loadTriggers: boolean,
): ControlPreview {
  const active = subject !== undefined;
  const triggerMap = useTriggerRows(active && loadTriggers);
  const store = usePreviewStore(active ? triggerMap : undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: subjects compared by value
  const subjects = useMemo(() => subjectsOf(subject, count), [JSON.stringify(subject), count]);
  return useMemo(() => {
    if (!active || subjects.every((s) => s === null)) return NO_PREVIEW;
    const triggers = Object.values(store.records[RULE_TRIGGER_TYPE] ?? {}) as PreviewTrigger[];
    const previews: (RollPreview | null)[] = subjects.map((s) =>
      s ? rollPreview(store, s, triggers) : null,
    );
    const d20 = subjects.findIndex((s) => s !== null && D20_ROLLS.has(s.roll));
    return {
      active: true,
      modeFor: (roller) => {
        const p = d20 >= 0 ? previews[d20] : null;
        return p ? modeFor(p, roller) : roller;
      },
      groups: (i, opts = {}) => {
        const s = subjects[i];
        if (!s) return [];
        const crit = opts.crit ?? s.crit;
        const toHitMode = s.toHitMode ?? (s.card ? opts.toHitMode : undefined);
        const same = crit === s.crit && toHitMode === s.toHitMode;
        if (same) return previews[i]?.groups ?? [];
        const at: RollSubject = { ...s };
        if (crit) at.crit = true;
        else delete at.crit;
        if (toHitMode) at.toHitMode = toHitMode;
        return rollPreview(store, at, triggers).groups;
      },
      text: previewText(previews.flatMap((p) => p?.parts ?? [])),
    };
  }, [active, subjects, store]);
}
