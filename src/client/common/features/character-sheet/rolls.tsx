// Sheet roll controls (FR-CHARX-23): every rollable number is a shared roll control (FR-DICE-24)
// over the specs the server will build (`characterRolls`, same data); the buttons themselves
// are in `./CharacterSheet`. DM public switches: one per category in each block header
// (FR-CHAR-22's rule); NPC sheets have none (FR-CHARX-22). Sprint 15 (#385, FR-CHARX-127): a
// row's Attack / Damage control has a `purpose`, so a click stages the Dice tray (editable) and
// Alt+click rolls at once; the tray's staged `parts` reach `char.roll` or the route's intent.
import { characterRolls, resolveSheetAttack } from "@shared/character-sheet/logic";
import { rowPartTypes } from "@shared/character-sheet/rolls";
import {
  isAttackRowKind,
  isSpellRowKind,
  type SheetRollKind,
  stagedPurposeOf,
} from "@shared/character-sheet/schemas";
import {
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  type RollCategory,
} from "@shared/dice-roll-log/schemas";
import { sheetRollSubjects } from "@shared/effect-modifiers/preview";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import type { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import { useRecords, useSync } from "../../sync/store";
import { slotLabelsOf } from "../dice-roll-log/logic";
import { useRollControl } from "../dice-roll-log/roll-control";
import { Breakdown } from "./breakdown";
import { useBusy } from "./fields";
import {
  claimRollOptions,
  type RollRouteClaim,
  type RollRouteInput,
  type SheetRollRef,
  sendSheetRoll,
} from "./routing";
import { useSheet, useSheetScope } from "./sheet-context";
import { type BreakdownKey, breakdownText } from "./view-model";

/**
 * Sheet roll buttons' tooltip; `RollButton` adds "Alt: adjust in tray" (FR-DICEX-51), or "Alt:
 * roll now" on Attack / Damage (FR-DICEX-98).
 */
export const ROLL_HINT = "Shift: advantage · Ctrl: disadvantage";

/**
 * FR-CHARX-113: a sheet roll button's hint: the breakdown of its number (when the sheet derives
 * one), else the caller's text; then the mode keys. `RollButton` adds the Alt hint.
 */
export function rollHint(
  stats: Parameters<typeof breakdownText>[0],
  breakdown: BreakdownKey | undefined,
  hint: string | undefined,
): ReactNode {
  const text = breakdown ? breakdownText(stats, breakdown) : null;
  if (text && breakdown) {
    return (
      <>
        <Breakdown okey={breakdown} text={text} />
        {` · ${ROLL_HINT}`}
      </>
    );
  }
  return hint ? `${hint} · ${ROLL_HINT}` : ROLL_HINT;
}

/** DM per-roll public override per category; absent = the category's setting. */
export function usePublicOverrides() {
  const [o, setO] = useState<Partial<Record<RollCategory, boolean>>>({});
  return {
    get: (c: RollCategory) => o[c],
    set: (c: RollCategory, v: boolean) => setO((x) => ({ ...x, [c]: v })),
    clear: (c: RollCategory) =>
      setO((x) => {
        const n = { ...x };
        delete n[c];
        return n;
      }),
  };
}
export type PublicOverrides = ReturnType<typeof usePublicOverrides>;

const SheetOverrides = createContext<PublicOverrides | null>(null);
/** K11: one set of DM public overrides per sheet, shared by the header's Public rolls menu and Main. */
export const SheetOverridesProvider = SheetOverrides.Provider;
/** The sheet's shared DM public overrides; outside a provider, this block's own. */
export function useSheetOverrides(): PublicOverrides {
  const shared = useContext(SheetOverrides);
  const own = usePublicOverrides();
  return shared ?? own;
}

/** One DM public switch for a category (block header); hidden for players and NPC sheets. */
export function PublicSwitch({
  category,
  label,
  testId,
  overrides,
}: {
  category: RollCategory;
  label: string;
  testId: string;
  overrides: PublicOverrides;
}) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const uid = useId();
  const scope = useSheetScope();
  if (ctx.client !== "dm" || ctx.npc) return null;
  const preset = settings ? categoryPublic(settings, category) : false;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Switch
        id={uid}
        data-testid={testId}
        data-scope={scope}
        aria-label={`${label} public`}
        checked={overrides.get(category) ?? preset}
        disabled={!live}
        onCheckedChange={(v) => overrides.set(category, v)}
      />
      <label htmlFor={uid}>{label}</label>
    </span>
  );
}

export interface SheetRollProps extends Omit<ComponentProps<typeof Button>, "ref" | "children"> {
  kind: SheetRollKind;
  rollRef?: SheetRollRef;
  /** Popover heading, e.g. "Stealth check" (prefixed with the creature name). */
  title: string;
  hint?: string;
  /** FR-CHARX-113: the number's breakdown leads the Tooltip (replaces `hint`). */
  breakdown?: BreakdownKey;
  overrides?: PublicOverrides;
  children: ReactNode;
}

/**
 * The shared roll control of one sheet roll (the buttons live in `./CharacterSheet`): specs as
 * the server builds them, DM public override per category (never on a definition), one intent
 * in flight. `claim` = the roll route's claim (FR-CHAR-16) or null (→ `char.roll`).
 */
export function useSheetRollControl({
  kind,
  rollRef = {},
  title,
  overrides,
  claim,
}: Pick<SheetRollProps, "kind" | "rollRef" | "title" | "overrides"> & {
  claim: RollRouteClaim | null;
}) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const busy = useBusy();
  const res = characterRolls(ctx.stats, ctx.row ?? null, kind, rollRef);
  const specs = res.ok ? res.specs : [];
  const category = specs[0]?.category ?? "other";
  // FR-MOD-15, -27: the effect-modifier preview's subjects, as the server derives them; a
  // definition (NPC sheet) roll has none.
  const attackRow = isAttackRowKind(kind)
    ? resolveSheetAttack(ctx.stats, ctx.row ?? null, { attackId: rollRef.attackId })
    : null;
  const spellRow = isSpellRowKind(kind)
    ? ctx.row?.spells.find((s) => s.id === rollRef.spellId)
    : undefined;
  const row = spellRow ? spellRow.name : attackRow?.ok ? attackRow.attack.name : undefined;
  // FR-CHARX-127: Attack / Damage (and Healing) stage the tray pre-filled: purpose, a damage type
  // per expression; every other kind is plain (click rolls).
  const purpose = stagedPurposeOf(kind) ?? undefined;
  const rowType = spellRow
    ? spellRow.damageType
    : attackRow?.ok
      ? attackRow.attack.damageType
      : null;
  const partTypes = purpose === "damage" ? rowPartTypes(specs, rowType) : undefined;
  // FR-CHARX-55: an extra damage part has no subject (mods attach to the base part), as on the
  // server; "part" maps to none.
  const categories = specs.map((s) => (s.part?.extra ? "part" : s.category)).join(",");
  const subject = useMemo(
    () =>
      ctx.npc || ctx.creature.kind !== "character"
        ? undefined
        : sheetRollSubjects({
            characterId: ctx.creature.id,
            kind,
            categories: categories.split(","),
            ...(rollRef.ability ? { ability: rollRef.ability } : {}),
            ...(rollRef.skill ? { skill: rollRef.skill } : {}),
            ...(row ? { row } : {}),
            ...(claim?.card ? { card: claim.card } : {}),
          }),
    [
      ctx.npc,
      ctx.creature.kind,
      ctx.creature.id,
      kind,
      categories,
      rollRef.ability,
      rollRef.skill,
      row,
      claim?.card,
    ],
  );
  const slotLabels = slotLabelsOf(specs);
  const control = useRollControl({
    expressions: specs.map((s) => s.expression),
    category,
    label: `${ctx.creature.name} — ${title}`,
    // FR-DICE-41: "To hit", "Slashing", "Fire" in the physical form and the tray.
    ...(slotLabels ? { slotLabels } : {}),
    ...(subject ? { subject } : {}),
    ...(purpose ? { purpose } : {}),
    ...(partTypes ? { partTypes } : {}),
    // FR-CBT-74: a routed Damage after a natural 20 opens with the extra critical dice.
    ...claimRollOptions(claim),
    onRoll(r) {
      const o = overrides?.get(category);
      const input: RollRouteInput =
        control.isDm && !ctx.npc && o !== undefined ? { ...r, public: o } : r;
      // FR-CHARX-22: never `public` on a definition roll.
      if (ctx.npc) delete input.public;
      overrides?.clear(category);
      busy.run(() =>
        sendSheetRoll(
          (n, p) => connection.sendIntent(n, p),
          claim,
          ctx.creature.id,
          kind,
          input,
          rollRef,
        ),
      );
    },
  });
  return { control, disabled: !live || busy.busy || specs.length === 0 };
}
