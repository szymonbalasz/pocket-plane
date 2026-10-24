// DM `cbt.initiative` (CBT §7): round + turns (skip cue, FR-CBT-50), Undo (one apply,
// FR-CBT-35), Roll monsters (FR-CBT-46), End encounter (FR-CBT-51), Pending (FR-CBT-79), rows by
// `position` (initiative roll / set, AC, HP, band or PC Down (FR-CBT-49), moved (FR-CBT-39),
// Attack; menu Check ▸ / Save ▸ (FR-CBT-44), Damage / heal, Set as ally / enemy (FR-CBT-104),
// Remove; the side chip), Removed. Sprint 6 (FR-CBT-118): companions' owner chip and mode icon,
// `after-owner` rows indented under the owner, `in-owner-turn` ones as lines in its row,
// Companion ▸ in the menus. Sprint 8 (FR-CBTX-62, -63): the grip, drop line and Move up / down
// (`reorder-drag.tsx`).
import { signed } from "@shared/character-sheet/logic";
import { notRestoredText } from "@shared/combat-extras/rules";
import { isCompanion } from "@shared/combat-tracker/companion";
import {
  canRollInitiative,
  d20Expression,
  healthBand,
  showRollMonsters,
  skippedOnStep,
  unrolledMonsters,
} from "@shared/combat-tracker/rules";
import {
  COMBATANT_TYPE,
  type CombatantView,
  type EncounterView,
  HIT_RULING_TYPE,
  type HitRulingRecord,
  type TurnResult,
  type UndoResult,
} from "@shared/combat-tracker/schemas";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  checkBonus,
  type DefinitionRecord,
  saveBonus,
} from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Input, Skeleton } from "@ui/components/ui/primitives";
import { characterOf, deadPc, deathStateFor, MORE_W } from "@ui/features/combat-extras/logic";
import { NameLine } from "@ui/features/combat-extras/parts";
import { skipText } from "@ui/features/combat-extras/skip";
import { MoreFooter, useBelowFold, useListViewport } from "@ui/features/combat-tracker/below-fold";
import {
  companionLayout,
  ModeIcon,
  modeLabel,
  OwnerChip,
} from "@ui/features/combat-tracker/companions";
import { BandBadge, Portrait, SideChip, TurnMarker } from "@ui/features/combat-tracker/parts";
import { manualFields, pendingToHitCard } from "@ui/features/combat-tracker/roll-route";
import {
  startedIn,
  toastIntentError,
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { pcDown } from "@ui/features/combat-tracker/token-overlay";
import {
  ENCOUNTERS_KIND,
  INITIATIVE_KIND,
  initiativeWindowBase,
} from "@ui/features/combat-tracker/window";
import { modeFromKeys } from "@ui/features/dice-roll-log/logic";
import {
  manualPartsOf,
  RollButton,
  type RollControl,
  type RollKeys,
  StageHint,
  useRollControl,
} from "@ui/features/dice-roll-log/roll-control";
import { actionButton } from "@ui/features/notifications/logic";
import { useNoteActions } from "@ui/features/notifications/parts";
import { originOf } from "@ui/features/notifications/views";
import { noteAppearance } from "@ui/features/play-shell/free-area";
import { defineWindow } from "@ui/features/play-shell/registry";
import {
  useOpenWindow,
  useShellState,
  useWindowDispatch,
} from "@ui/features/play-shell/ShellContext";
import { movementIndicator } from "@ui/features/scenes-map/movement";
import { cn } from "@ui/lib/utils";
import { IntentRejected } from "@ui/sync/connection";
import { useRecords, useSync } from "@ui/sync/store";
import {
  DicesIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  FootprintsIcon,
  HeartPulseIcon,
  RotateCcwIcon,
  ShieldIcon,
  SkipForwardIcon,
  SparklesIcon,
  SwordIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { dmNotificationViews } from "../../notification-views";
import {
  DeathSaveAnchor,
  RowDeath,
  RowEffects,
  RowMenuItems,
  RowMoveItems,
  RowTemp,
  useDeadPc,
  useDeathSaveRoll,
} from "../combat-extras/row";
import { CbtxRuntime } from "../combat-extras/runtime";
import { useCbtxDialogs } from "../combat-extras/store";
import { type AttackAction, attackChoices, attackRolls, attackSummary } from "./attack-choices";
import { AttackPopup, acOf, hpOf } from "./attack-popup";
import { CompanionCardButton, CompanionMenu } from "./companion-menu";
import { useDefinitions, usePendingCards, useUndo } from "./data";
import { EndConfirmDescription, useStartEnd } from "./end-confirm";
import { useHoverSafeSub } from "./hover-sub";
import { HpDialog } from "./hp-dialog";
import { damageCardRow, isDamageCard, pendingRowText } from "./pending";
import { useCombatDialogs } from "./popup-store";
import { DropLine, Grip, ReorderContext, useReorder } from "./reorder-drag";
import { rollKeys } from "./roll-keys";
import { SideMenu } from "./side-menu";
import { idleInitiativeOnLoad } from "./start-end";
import { startReason } from "./start-reason";
import { SummonDialog, useSummonDialog } from "./summon-dialog";

/**
 * FR-CBTX-46 (G1): the Init column is wide while some row can roll (round 0, a late joiner
 * without initiative); else just the number input, so the name line keeps room for chips.
 */
const INIT_W = { wide: "w-[100px]", narrow: "w-9" } as const;

function InitiativeCell({
  c,
  def,
  round,
  wide,
}: {
  c: CombatantView;
  def: DefinitionRecord | undefined;
  round: number;
  wide: boolean;
}) {
  const { send, disabled } = useCbtIntent();
  const [draft, setDraft] = useState(c.initiative == null ? "" : String(c.initiative));
  useEffect(() => setDraft(c.initiative == null ? "" : String(c.initiative)), [c.initiative]);
  const control = useRollControl({
    expressions: [d20Expression(def?.statBlock.initBonus ?? 0)],
    category: "initiative",
    label: `${c.name} — Initiative`,
    // FR-MOD-15, -27: the preview maps a PC combatant to its character, as the server does.
    subject: { creature: { combatantId: c.id }, roll: "initiative" },
    onRoll: (r) =>
      void send("cbt.rollInitiative", {
        combatantIds: [c.id],
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...manualPartsOf(r),
        ...(r.public !== undefined ? { public: r.public } : {}),
      }),
  });
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n === c.initiative) {
      setDraft(c.initiative == null ? "" : String(c.initiative));
      return;
    }
    void send("cbt.setInitiative", { combatantId: c.id, value: n });
  };
  const bonus = def?.statBlock.initBonus ?? 0;
  const unset = c.initiative == null;
  // FR-CBT-46 (#172): from round 1 only a combatant without initiative rolls; the number input
  // stays the DM's override in every round.
  const canRoll = canRollInitiative(round, c.initiative);
  // #149: an empty initiative leads with a labelled Roll button; the box is a quiet secondary
  // way to type a value (reads as a value cell, not a form field).
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-0.5",
        INIT_W[wide ? "wide" : "narrow"],
      )}
    >
      <Tooltip content="Set initiative by hand">
        <Input
          data-testid="cbt-init-row-init"
          data-record-id={c.id}
          data-missing={unset}
          aria-label={`Initiative of ${c.name}`}
          inputMode="numeric"
          placeholder={unset && round >= 1 ? "Set" : "–"}
          className="h-7 w-9 border-transparent bg-transparent px-1 text-center text-xs tabular-nums shadow-none placeholder:text-muted-foreground/60 hover:border-input focus-visible:border-input"
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </Tooltip>
      {canRoll && (
        <RollButton
          control={control}
          hint={`Roll initiative: d20${bonus < 0 ? "" : "+"}${bonus} (Shift adv, Ctrl dis)`}
          data-testid="cbt-init-row-roll"
          data-record-id={c.id}
          size={unset ? "sm" : "icon"}
          variant={unset ? "outline" : "ghost"}
          className={unset ? "h-7 gap-1 px-2 text-xs" : "size-7"}
          aria-label={`Roll initiative for ${c.name}`}
          disabled={disabled}
        >
          <DicesIcon className="size-3.5" />
          {unset && "Roll"}
        </RollButton>
      )}
    </div>
  );
}

/** The three N7 actions (FR-CBT-74), in menu order; a click on the attack's name = `both`. */
const ATTACK_ACTIONS = [
  { value: "both", label: "Attack + damage" },
  { value: "toHit", label: "Attack" },
  { value: "damage", label: "Damage" },
] as const satisfies readonly { value: AttackAction; label: string }[];

/**
 * FR-MOD-15, -27: the preview subjects of an attack row's action, as `cbt.attack` /
 * `cbt.rollDamage` roll them: the to-hit, then the card's damage (`card: true`; Damage alone
 * reads the pending to-hit card's mode); an extra damage part has none (FR-CHARX-55).
 */
function attackSubjects(
  combatantId: string,
  row: string,
  action: AttackAction,
  cardMode: RollMode | undefined,
  extraParts: number,
): (RollSubject | null)[] {
  const base = { creature: { combatantId }, via: "weapon" as const, row: row.slice(0, 60) };
  const hit: RollSubject = { ...base, roll: "attack" };
  const damage: RollSubject = {
    ...base,
    roll: "damage",
    card: true,
    ...(action === "damage" && cardMode ? { toHitMode: cardMode } : {}),
  };
  const extra = Array<null>(extraParts).fill(null);
  return action === "toHit"
    ? [hit]
    : action === "damage"
      ? [damage, ...extra]
      : [hit, damage, ...extra];
}

/**
 * Attack ▸ (FR-CBT-16, FR-CBT-74, N7): every attack the definition can name (OQ-CHARX-12) with
 * the same three actions as the sheet: Attack + damage (`cbt.attack`), Attack (`cbt.attack
 * {rolls: "toHit"}`), Damage (`cbt.rollDamage`; after a natural 20 on that row's pending to-hit
 * card the roll control opens critical). The pick rolls through one control once it has
 * re-rendered with that attack and action (as Check ▸ / Save ▸); the result's card opens.
 * Physical dice (BL-19): one entry per part as the server rolls them (FR-CBT-81), the extra
 * parts sent as `manualExtra`. The pick state lives with the row (`useAttackPick`), outside the
 * menu, so the roll still runs once the menu has closed (sprint 7: the companion line's ⋯ holds
 * Attack ▸ as a submenu, FR-CBT-142).
 */
function useAttackPick(c: CombatantView, def: DefinitionRecord | undefined) {
  const { send, disabled } = useCbtIntent();
  const openCard = useCombatDialogs((s) => s.openCard);
  const notes = useRecords<NotificationRecord>("notification");
  const attacks = def?.statBlock.attacks ?? [];
  const choices = attackChoices(attacks);
  const [pick, setPick] = useState<{
    index: number;
    action: AttackAction;
    keys: RollKeys;
    n: number;
  } | null>(null);
  const chosen = choices[pick?.index ?? 0];
  const action = pick?.action ?? "both";
  const attack = chosen?.attack;
  // One attack: no id, the server's first attack (FR-CHARX-20 back-compat).
  const attackId = choices.length > 1 ? chosen?.attackId : undefined;
  // The row a card of this attack names (FR-CBT-71): its id, else the first attack's.
  const rowId = chosen?.attackId ?? attacks[0]?.id;
  const card = pendingToHitCard(notes, c.id, rowId === undefined ? {} : { attackId: rowId });
  const crit = action === "damage" && card?.toHit?.natural === 20;
  const rolls = attack ? attackRolls(attack, action) : null;
  const control = useRollControl({
    expressions: rolls?.expressions ?? ["1d20"],
    critExpressions: rolls?.critExpressions,
    // FR-DICE-41: "To hit", "Slashing", "Fire" in the physical form and the tray.
    slotLabels: rolls?.slotLabels,
    crit,
    category: action === "damage" ? "damage" : "attack",
    label: attack
      ? `${c.name} — ${attack.name} ${action === "damage" ? "damage" : "attack"}`
      : undefined,
    ...(attack && rolls
      ? { subject: attackSubjects(c.id, attack.name, action, card?.mode, rolls.extraParts) }
      : {}),
    onRoll: async (r) => {
      const ref = attackId ? { attackId } : {};
      // `cbt.rollDamage` takes one entry, `cbt.attack` a list (to-hit [+ base]); then the parts.
      const manual = manualFields(r, action === "damage" ? 1 : 2);
      const res =
        action === "damage"
          ? await send<{ cardId: string }>("cbt.rollDamage", {
              attackerId: c.id,
              ...manual,
              ...ref,
            })
          : await send<{ cardId: string }>("cbt.attack", {
              attackerId: c.id,
              mode: r.mode,
              ...(action === "toHit" ? { rolls: "toHit" } : {}),
              ...manual,
              ...ref,
            });
      if (res) openCard(res.cardId);
    },
  });
  const n = pick?.n;
  // biome-ignore lint/correctness/useExhaustiveDependencies: roll once per pick (n), with the control of that render
  useEffect(() => {
    if (pick) control.roll(pick.keys);
  }, [n]);
  const keys = useRef<RollKeys>({});
  const choose = (index: number, a: AttackAction) => {
    const k = keys.current;
    keys.current = {};
    setPick((p) => ({ index, action: a, keys: k, n: (p?.n ?? 0) + 1 }));
  };
  return { control, choices, choose, keys, attack, disabled: disabled || choices.length === 0 };
}
type AttackPick = ReturnType<typeof useAttackPick>;

/** Attack ▸'s items: per attack, Attack + damage / Attack / Damage. */
function AttackItems({ c, a }: { c: CombatantView; a: AttackPick }) {
  return a.choices.map((ch, i) => (
    <div key={ch.attackId ?? `first-${i}`} className="flex items-center gap-0.5">
      {ATTACK_ACTIONS.map((x) => (
        <DropdownMenuItem
          key={x.value}
          data-testid="cbt-init-row-attack-option"
          data-record-id={c.id}
          data-value={x.value}
          data-attack-id={ch.attackId ?? ""}
          className={x.value === "both" ? "min-w-0 flex-1 gap-2" : "px-1.5 text-xs"}
          onPointerDown={(e) => {
            a.keys.current = rollKeys(e);
          }}
          onSelect={() => a.choose(i, x.value)}
        >
          {x.value === "both" ? (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{ch.attack.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {attackSummary(ch.attack)}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{x.label}</span>
            </>
          ) : (
            x.label
          )}
        </DropdownMenuItem>
      ))}
    </div>
  ));
}

/** Invisible anchor for the physical-dice popover of the picked attack. */
const AttackAnchor = ({ a }: { a: AttackPick }) => (
  <RollButton control={a.control} hint={false} tabIndex={-1} aria-hidden className={ANCHOR} />
);

function AttackButton({ c, def }: { c: CombatantView; def: DefinitionRecord | undefined }) {
  const a = useAttackPick(c, def);
  const { attack } = a;
  return (
    <>
      {/* The Alt hint is the trigger's (FR-DICEX-51). */}
      <AttackAnchor a={a} />
      <DropdownMenu>
        <Tooltip
          content={
            attack ? (
              <>
                Attack ▸ · Shift: advantage · Ctrl: disadvantage · <StageHint />
              </>
            ) : (
              "No weapon attack"
            )
          }
        >
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="cbt-init-row-attack"
              data-record-id={c.id}
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={`Attack with ${c.name}`}
              disabled={a.disabled}
            >
              <SwordIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-64">
          <AttackItems c={c} a={a} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// ---------- checks and saves (FR-CBT-44) ----------

type AbilityKind = "check" | "save";

const KIND_LABEL: Record<AbilityKind, string> = { check: "Check", save: "Save" };

/**
 * One shared roll control per kind (Shift / Ctrl, physical-dice popover, DM public switch per
 * category). A menu item picks the ability; the roll runs once the control has re-rendered with
 * that ability's expression. The physical-dice popover anchors to an invisible button.
 */
function useAbilityRoll(c: CombatantView, kind: AbilityKind, bonus: (a: Ability) => number | null) {
  const { send } = useCbtIntent();
  const [pick, setPick] = useState<{ ability: Ability; keys: RollKeys; n: number } | null>(null);
  const ability = pick?.ability ?? "str";
  const control = useRollControl({
    expressions: [d20Expression(bonus(ability) ?? 0)],
    category: kind === "check" ? "ability-check" : "saving-throw",
    label: `${c.name} — ${ABILITY_NAMES[ability]} ${kind}`,
    subject: { creature: { combatantId: c.id }, roll: kind, ability },
    onRoll: (r) =>
      void send("cbt.rollAbility", {
        combatantId: c.id,
        kind,
        ability,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...manualPartsOf(r),
        ...(r.public !== undefined ? { public: r.public } : {}),
      }),
  });
  const n = pick?.n;
  // biome-ignore lint/correctness/useExhaustiveDependencies: roll once per pick (n), with the control of that render
  useEffect(() => {
    if (pick) control.roll(pick.keys);
  }, [n]);
  return {
    control,
    roll: (a: Ability, keys: RollKeys) =>
      setPick((p) => ({ ability: a, keys, n: (p?.n ?? 0) + 1 })),
  };
}

function AbilityMenu({
  c,
  kind,
  bonus,
  roll,
  control,
}: {
  c: CombatantView;
  kind: AbilityKind;
  bonus: (a: Ability) => number | null;
  roll: (a: Ability, keys: RollKeys) => void;
  control: RollControl;
}) {
  const keys = useRef<RollKeys>({});
  const sub = useHoverSafeSub();
  return (
    <DropdownMenuSub open={sub.open} onOpenChange={sub.onOpenChange}>
      <DropdownMenuSubTrigger data-testid={`cbt-init-row-${kind}`} data-record-id={c.id}>
        <ShieldIcon /> {KIND_LABEL[kind]}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent onPointerEnter={sub.keep}>
        {ABILITIES.map((a) => (
          <DropdownMenuItem
            key={a}
            data-testid={`cbt-init-row-${kind}-option`}
            data-record-id={c.id}
            data-value={a}
            onPointerDown={(e) => {
              keys.current = rollKeys(e);
            }}
            onSelect={() => {
              roll(a, keys.current);
              keys.current = {};
            }}
          >
            <span className="flex-1">{ABILITY_NAMES[a]}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {signed(bonus(a) ?? 0)}
            </span>
          </DropdownMenuItem>
        ))}
        {/* FR-DICEX-51: the anchor is invisible, so the open submenu carries the Alt hint. */}
        <StageHint line />
        {control.isDm && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={`cbt-init-row-${kind}-public`}
              data-record-id={c.id}
              data-value={control.publicValue}
              onSelect={(e) => {
                e.preventDefault();
                control.setPublic(!control.publicValue);
              }}
            >
              {control.publicValue ? <EyeIcon /> : <EyeOffIcon />}
              {control.publicValue ? "Shown to players" : "DM only"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Movement used in the drag label's tone (FR-CBT-39, FR-MAP-37): a footprints icon + "40 / 30 ft"
 * ("40 ft" without speed), labelled "Moved 40 / 30 ft". Compact so the row's name keeps its room.
 * Only for a combatant bound to a token: nothing else can move.
 */
const TONE_CLASS = {
  none: "",
  normal: "",
  dash: "text-hp-bloodied",
  over: "text-hp-down",
} as const;

function Moved({ c, speed }: { c: CombatantView; speed: number | undefined }) {
  if (c.tokenId === null) return null;
  const moved = c.movedFt ?? 0;
  const tone = speed === undefined ? "none" : movementIndicator(moved, null, speed).tone;
  const text = speed === undefined ? `${moved} ft` : `${moved} / ${speed} ft`;
  return (
    <Tooltip content={`Moved ${text}`}>
      <span
        className={cn(
          "ml-auto flex shrink-0 items-center gap-0.5 pl-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums",
          TONE_CLASS[tone],
        )}
        data-testid="cbt-init-row-moved"
        data-record-id={c.id}
        data-tone={tone}
        data-name-end
      >
        <FootprintsIcon className="size-3" aria-hidden />
        <span className="sr-only">Moved </span>
        {text}
      </span>
    </Tooltip>
  );
}

const sumWidths = (els: readonly Element[], gap: number) =>
  els.reduce((w, el) => w + el.getBoundingClientRect().width, 0) +
  Math.max(0, els.length - 1) * gap;

/**
 * P3 glitch 10 (names keep priority, #182): the Moved indicator stays on the name line while the
 * full name, its icons, a "+N"'s room (if chips) and Moved fit there; otherwise it moves to the
 * AC / HP line when that line has room for it. Natural widths only, so it never flips back and
 * forth; re-measured on resize and when the row changes.
 */
function useMovedBelow(rowRef: RefObject<HTMLElement | null>, deps: unknown): boolean {
  const [below, setBelow] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the row changes
  useLayoutEffect(() => {
    const row = rowRef.current;
    const line = row?.querySelector<HTMLElement>("[data-name-line]");
    const stats = row?.querySelector<HTMLElement>("[data-stats-line]");
    if (!row || !line || !stats) return;
    const measure = () => {
      const moved = row.querySelector<HTMLElement>('[data-testid="cbt-init-row-moved"]');
      const name = line.querySelector<HTMLElement>("[data-name-measure]");
      if (!moved || !name || line.clientWidth === 0) {
        setBelow(false);
        return;
      }
      // The name's natural width, then its marks and the side chip (NameLine, FR-CBTX-57).
      const nameW = name.offsetWidth;
      const others = [
        ...line.querySelectorAll<HTMLElement>(
          ":scope > [data-name-head] > [data-name-marks], :scope > [data-name-marks], :scope > [data-name-side]",
        ),
      ].filter((k) => k.offsetWidth > 0);
      const chips = line.querySelector("[data-chip-row]") ? MORE_W : 0;
      const gap = 4; // gap-1
      const parts = 2 + others.length + (chips ? 1 : 0);
      const needLine = nameW + sumWidths(others, 0) + chips + moved.offsetWidth + (parts - 1) * gap;
      const statsKids = [...stats.children].filter((k) => k !== moved);
      const needStats = sumWidths(statsKids, 6) + 6 + moved.offsetWidth; // gap-1.5
      setBelow(needLine > line.clientWidth && needStats <= stats.clientWidth);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(line);
    return () => ro?.disconnect();
  }, [deps]);
  return below;
}

/**
 * Sprint 6 (FR-CBT-107, -108): a companion acting with its owner shows the owner's number, no
 * input or roll ("After Mira"); an in-turn line shows none.
 */
function OwnerInitCell({
  c,
  owner,
  ownerName,
  wide,
}: {
  c: CombatantView;
  owner: CombatantView | null;
  ownerName: string;
  wide: boolean;
}) {
  const label = modeLabel(c.turnMode ?? "after-owner", ownerName);
  return (
    <Tooltip content={label}>
      <span
        data-testid="cbt-init-row-init"
        data-record-id={c.id}
        data-missing="false"
        data-value={owner?.initiative ?? ""}
        className={cn(
          "shrink-0 text-center text-xs text-muted-foreground tabular-nums",
          INIT_W[wide ? "wide" : "narrow"],
        )}
      >
        <span className="sr-only">{label}: </span>
        {owner?.initiative ?? "–"}
      </span>
    </Tooltip>
  );
}

interface RowProps {
  c: CombatantView;
  def: DefinitionRecord | undefined;
  turn: boolean;
  round: number;
  defs: Map<string, DefinitionRecord>;
  wideInit: boolean;
  /** Sprint 6 (FR-CBT-118): a companion's owner row (null: not a companion, or not listed). */
  owner?: CombatantView | null;
  /** The owner PC's name (chip, mode Tooltip). */
  ownerName?: string;
  /** `in-owner-turn` companions shown as lines inside this row (FR-CBT-107). */
  lines?: CombatantView[];
  /** Ranked by its owner: indented one step under it. */
  indent?: boolean;
}

/**
 * One combatant's row content: portrait, name line, AC / HP line, initiative, Attack ▸, menu.
 * (An in-owner-turn companion's line is `CompanionLine`, FR-CBT-142.)
 */
function RowMain({
  c,
  def,
  turn,
  round,
  defs,
  wideInit,
  owner,
  ownerName,
}: Omit<RowProps, "lines" | "indent">) {
  const { send, disabled } = useCbtIntent();
  const openHp = useCombatDialogs((s) => s.openHp);
  const openSummon = useSummonDialog((s) => s.openFor);
  const hp = hpOf(c, defs);
  const ac = acOf(c, defs);
  const stats = def?.statBlock;
  const hasScores = stats?.abilities !== undefined;
  const checkOf = (a: Ability) => (stats ? checkBonus(stats, a) : null);
  const saveOf = (a: Ability) => (stats ? saveBonus(stats, a) : null);
  const check = useAbilityRoll(c, "check", checkOf);
  const save = useAbilityRoll(c, "save", saveOf);
  // FR-CBT-49 (G9): a PC at 0 HP shows "Down" where monsters show their band; combat-extras'
  // death state (Dying / Stable / Dead, FR-CBTX-33) replaces it once the PC has one.
  const down = useSync((s) => pcDown(s.store, c));
  const dead = useDeadPc(c);
  const hasDeathState = useSync(
    (s) => c.kind === "pc" && deathStateFor(characterOf(s.store, c.entityId ?? "")) !== null,
  );
  const deathRoll = useDeathSaveRoll(c);
  // FR-CBT-50 (G4): Next / Prev skip a monster at 0 HP — and a dead PC (FR-CBTX-25); the row is
  // muted with a skip icon.
  const skipped = (c.kind === "monster" && !c.removed && c.hpCurrent === 0) || dead;
  const mainRef = useRef<HTMLDivElement>(null);
  const movedBelow = useMovedBelow(
    mainRef,
    `${c.name}:${c.movedFt}:${round}:${wideInit}:${skipped}:${c.hidden}:${hp?.cur}:${down}:${hasDeathState}:${c.side}:${c.publicSide}:${c.ownerCharacterId}:${c.turnMode}`,
  );
  const companion = isCompanion(c) && c.turnMode;
  const byOwner = companion && c.turnMode !== "own" && owner !== null && owner !== undefined;
  return (
    <div
      ref={mainRef}
      data-row-main
      className={cn(
        "relative flex items-center gap-0.5",
        c.hidden && "opacity-70",
        skipped && "opacity-50",
      )}
    >
      <Grip c={c} />
      <TurnMarker active={turn} />
      <Portrait name={c.name} imageAssetId={c.imageAssetId} />
      <div className="min-w-0 flex-1">
        {/* The name is never cut (FR-CBTX-57): the side chip and the chips take a second line
            first, a name wider than the line wraps. */}
        <NameLine
          name={c.name}
          testId="cbt-init-row-name"
          className="text-sm font-medium"
          marks={
            <>
              {/* FR-CBT-118 (sprint 6): the mode icon, Tooltip "After Mira". */}
              {companion && (
                <ModeIcon
                  id={c.id}
                  mode={c.turnMode ?? "after-owner"}
                  ownerName={ownerName ?? ""}
                  testId="cbt-init-row-mode"
                />
              )}
              {c.hidden && (
                <EyeOffIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Hidden"
                />
              )}
              {skipped && (
                <Tooltip content={dead ? "Skipped while dead" : "Skipped while down"}>
                  <span
                    data-testid="cbt-init-row-skip"
                    data-record-id={c.id}
                    className="flex shrink-0 text-muted-foreground"
                  >
                    <SkipForwardIcon
                      className="size-3.5"
                      aria-label={dead ? "Skipped while dead" : "Skipped while down"}
                    />
                  </span>
                </Tooltip>
              )}
            </>
          }
          // FR-CBT-104 (#252): the side chip never folds; before the effect chips (FR-CBTX-54).
          // Sprint 6 (FR-CBT-118): the owner chip with it (a line sits in its owner's row).
          side={
            <>
              {companion && (
                <OwnerChip c={c} ownerName={ownerName ?? ""} testId="cbt-init-row-owner" />
              )}
              <SideChip c={c} testId="cbt-init-row-ally" />
            </>
          }
          // On the name line, right-aligned; below when the name needs the room. From round 1
          // only: before the first turn nothing has moved in combat (P3 glitch 10, ruling A).
          end={round >= 1 && !movedBelow && <Moved c={c} speed={stats?.speed} />}
        >
          {/* FR-CBTX-33: effect chips, one line ("+N" for the rest). */}
          <RowEffects c={c} round={round} />
        </NameLine>
        {/* Never cut (FR-CBTX-57, F10): whole parts wrap onto a second line when narrow (320 at
            round 0, Roll buttons in the Init column). */}
        <div
          data-stats-line
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap text-xs text-muted-foreground tabular-nums"
        >
          <span className="shrink-0">AC {ac ?? "—"}</span>
          <span className="shrink-0" data-testid="cbt-init-row-hp" data-record-id={c.id}>
            HP {hp ? `${hp.cur}/${hp.max}` : "—"}
          </span>
          <RowTemp c={c} />
          {/* FR-CHARX-59 (walkthrough 9): a companion's card, also on its line. */}
          {companion && <CompanionCardButton c={c} />}
          {c.kind === "monster" && hp && (
            <BandBadge band={healthBand(hp.cur, hp.max)} testId="cbt-init-row-band" />
          )}
          {down && !hasDeathState && <BandBadge band="down" testId="cbt-init-row-band" />}
          <RowDeath c={c} />
          {round >= 1 && movedBelow && <Moved c={c} speed={stats?.speed} />}
        </div>
      </div>
      {byOwner ? (
        <OwnerInitCell c={c} owner={owner} ownerName={ownerName ?? ""} wide={wideInit} />
      ) : (
        <InitiativeCell c={c} def={def} round={round} wide={wideInit} />
      )}
      <AttackButton c={c} def={def} />
      {/* Invisible anchors for the physical-dice popovers of Check ▸ / Save ▸, out of the flow
          (no gaps: the name line keeps the room, FR-CBTX-46). */}
      <span className="pointer-events-none absolute top-1/2 right-16 flex size-0">
        <AbilityAnchors check={check.control} save={save.control} />
        {c.kind === "pc" && <DeathSaveAnchor control={deathRoll} />}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            data-testid="cbt-init-row-menu"
            data-record-id={c.id}
            aria-label={`More for ${c.name}`}
          >
            <EllipsisIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <RowMoveItems c={c} />
          {hasScores && (
            <>
              <AbilityMenu c={c} kind="check" bonus={checkOf} {...check} />
              <AbilityMenu c={c} kind="save" bonus={saveOf} {...save} />
              <DropdownMenuSeparator />
            </>
          )}
          <RowMenuItems c={c} deathRoll={deathRoll} />
          <DropdownMenuItem data-testid="cbt-init-row-hp-adjust" onSelect={() => openHp(c.id)}>
            <HeartPulseIcon /> Damage / heal…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <SideMenu c={c} testId="cbt-init-row-side" />
          {/* FR-CBT-118 (sprint 6): owner, turn mode, release, turn hostile, dismiss. */}
          <CompanionMenu c={c} testId="cbt-init-row-companion" />
          {c.kind === "pc" && c.entityId && (
            <DropdownMenuItem
              data-testid="cbt-init-row-summon"
              data-record-id={c.id}
              disabled={disabled}
              onSelect={() => openSummon(c.entityId)}
            >
              <SparklesIcon /> Summon for {c.name}…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            data-testid="cbt-init-row-remove"
            disabled={disabled}
            onSelect={() => void send("cbt.setRemoved", { combatantId: c.id, removed: true })}
          >
            <UserMinusIcon /> Remove from combat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * FR-CBT-142 (BL-56, OQ-CBT-93 A): an `in-owner-turn` companion's **one-row** line in its owner's
 * row: name (wrapping between words only, FR-CBT-143), its marks, "22 / 22" (+ temp) and AC, the
 * chips, the card and ⋯ (Attack ▸, Check ▸ / Save ▸, Damage / heal, Effect…, Companion ▸, …).
 * `NameLine` fits it (FR-CBTX-57): the stats ride in the side slot, card + ⋯ at the end; too
 * narrow → the stats and chips take a second line, never the name.
 */
function CompanionLine({
  c,
  def,
  round,
  defs,
  ownerName,
}: {
  c: CombatantView;
  def: DefinitionRecord | undefined;
  round: number;
  defs: Map<string, DefinitionRecord>;
  ownerName: string;
}) {
  const { send, disabled } = useCbtIntent();
  const openHp = useCombatDialogs((s) => s.openHp);
  const hp = hpOf(c, defs);
  const ac = acOf(c, defs);
  const stats = def?.statBlock;
  const hasScores = stats?.abilities !== undefined;
  const checkOf = (a: Ability) => (stats ? checkBonus(stats, a) : null);
  const saveOf = (a: Ability) => (stats ? saveBonus(stats, a) : null);
  const check = useAbilityRoll(c, "check", checkOf);
  const save = useAbilityRoll(c, "save", saveOf);
  const attack = useAttackPick(c, def);
  const deathRoll = useDeathSaveRoll(c);
  const skipped = c.kind === "monster" && !c.removed && c.hpCurrent === 0;
  const attackSub = useHoverSafeSub();
  return (
    <div
      data-row-main
      className={cn(
        "relative flex items-center",
        c.hidden && "opacity-70",
        skipped && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <NameLine
          name={c.name}
          testId="cbt-init-row-name"
          className="text-sm"
          marks={
            <>
              <ModeIcon
                id={c.id}
                mode={c.turnMode ?? "in-owner-turn"}
                ownerName={ownerName}
                testId="cbt-init-row-mode"
              />
              {c.hidden && (
                <EyeOffIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Hidden"
                />
              )}
              {skipped && (
                <SkipForwardIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Skipped while down"
                />
              )}
            </>
          }
          side={
            <span
              data-stats-line
              className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground tabular-nums"
            >
              <span className="shrink-0" data-testid="cbt-init-row-hp" data-record-id={c.id}>
                {hp ? `${hp.cur} / ${hp.max}` : "—"}
              </span>
              <RowTemp c={c} />
              <span className="shrink-0" data-testid="cbt-init-row-ac" data-record-id={c.id}>
                AC {ac ?? "—"}
              </span>
            </span>
          }
          end={
            <span data-name-end className="ml-auto flex shrink-0 items-center">
              <CompanionCardButton c={c} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    data-testid="cbt-init-companion-menu"
                    data-record-id={c.id}
                    aria-label={`More for ${c.name}`}
                  >
                    <EllipsisIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuSub open={attackSub.open} onOpenChange={attackSub.onOpenChange}>
                    <DropdownMenuSubTrigger
                      data-testid="cbt-init-row-attack"
                      data-record-id={c.id}
                      disabled={attack.disabled}
                    >
                      <SwordIcon /> Attack
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-64" onPointerEnter={attackSub.keep}>
                      <AttackItems c={c} a={attack} />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {hasScores && (
                    <>
                      <AbilityMenu c={c} kind="check" bonus={checkOf} {...check} />
                      <AbilityMenu c={c} kind="save" bonus={saveOf} {...save} />
                    </>
                  )}
                  <DropdownMenuItem
                    data-testid="cbt-init-row-hp-adjust"
                    onSelect={() => openHp(c.id)}
                  >
                    <HeartPulseIcon /> Damage / heal…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <RowMenuItems c={c} deathRoll={deathRoll} />
                  <DropdownMenuSeparator />
                  <SideMenu c={c} testId="cbt-init-row-side" />
                  <CompanionMenu c={c} testId="cbt-init-row-companion" />
                  <DropdownMenuItem
                    variant="destructive"
                    data-testid="cbt-init-row-remove"
                    disabled={disabled}
                    onSelect={() =>
                      void send("cbt.setRemoved", { combatantId: c.id, removed: true })
                    }
                  >
                    <UserMinusIcon /> Remove from combat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          }
        >
          <RowEffects c={c} round={round} />
        </NameLine>
      </div>
      {/* Invisible anchors for the physical-dice popovers (Attack ▸, Check ▸ / Save ▸). */}
      <span className="pointer-events-none absolute top-1/2 right-8 flex size-0">
        <AttackAnchor a={attack} />
        <AbilityAnchors check={check.control} save={save.control} />
      </span>
    </div>
  );
}

/**
 * One Initiative row (`cbt-init-row`); sprint 6 (FR-CBT-118): an `after-owner` companion sits
 * indented under its owner, an owner's `in-owner-turn` companions are lines inside its row
 * (`cbt-init-companion`), each one row with its own HP, AC, chips, card and ⋯ (FR-CBT-142).
 */
export function Row({ lines = [], indent = false, ...p }: RowProps) {
  const { c, turn, defs } = p;
  const dead = useDeadPc(c);
  const skipped = (c.kind === "monster" && !c.removed && c.hpCurrent === 0) || dead;
  return (
    <li
      data-testid="cbt-init-row"
      data-record-id={c.id}
      data-turn={turn}
      data-hidden={c.hidden === true}
      data-skipped={skipped}
      data-indent={indent || undefined}
      className={cn(
        // FR-CBTX-62: the dragged block lifts (`data-lifted`, set by the drag).
        "flex flex-col gap-0.5 rounded-md px-1 py-0.5 data-[lifted]:relative data-[lifted]:z-20 data-[lifted]:bg-card data-[lifted]:shadow-md data-[lifted]:ring-1 data-[lifted]:ring-border",
        turn && "bg-accent",
        indent && "ml-3",
      )}
    >
      <RowMain {...p} />
      {lines.map((l) => (
        <div
          key={l.id}
          data-testid="cbt-init-companion"
          data-record-id={l.id}
          data-hidden={l.hidden === true}
          className="border-l border-border/60 pl-1"
        >
          <CompanionLine
            c={l}
            def={l.entityId ? defs.get(l.entityId) : undefined}
            round={p.round}
            defs={defs}
            ownerName={c.name}
          />
        </div>
      ))}
    </li>
  );
}

const ANCHOR = "pointer-events-none size-0 overflow-hidden p-0 opacity-0";

/** Invisible anchors for the physical-dice popovers of Check ▸ / Save ▸ (rows and lines). */
function AbilityAnchors({ check, save }: { check: RollControl; save: RollControl }) {
  return (
    <>
      <RollButton control={check} hint={false} tabIndex={-1} aria-hidden className={ANCHOR} />
      <RollButton control={save} hint={false} tabIndex={-1} aria-hidden className={ANCHOR} />
    </>
  );
}

/**
 * FR-CBT-79 (G9): one Pending row per linked notification. A damage card opens the popup; another
 * kind shows its text ("Waiting for Mira: …" when a player owns it) and the DM's action (the
 * view's `onAction`, as in Notifications).
 */
function PendingRow({ n, actions }: { n: NotificationRecord; actions: NoteActions }) {
  const openCard = useCombatDialogs((s) => s.openCard);
  const live = useSync((s) => s.state === "live");
  const rulings = useRecords<HitRulingRecord>(HIT_RULING_TYPE);
  const combatants = useRecords<CombatantView>(COMBATANT_TYPE);
  const view = dmNotificationViews.get(n.kind);
  if (isDamageCard(n)) {
    // FR-CBT-89 (sprint 5): a ruled card reads "Mira: hit Goblin — waiting for damage".
    const row = damageCardRow(
      n,
      rulings.find((r) => r.cardId === n.id),
      (id) => combatants.find((c) => c.id === id)?.name,
    );
    return (
      <li>
        {/* P3 glitch 10: the full text on hover when the row cuts it. */}
        <Tooltip content={row.text}>
          <Button
            variant="outline"
            size="sm"
            data-testid="cbt-init-card"
            data-record-id={n.id}
            data-step={row.step}
            className="w-full justify-start truncate"
            onClick={() => openCard(n.id)}
          >
            <SwordIcon className="size-3.5" /> <span className="min-w-0 truncate">{row.text}</span>
          </Button>
        </Tooltip>
      </li>
    );
  }
  const Icon = view?.icon ?? SwordIcon;
  const mode = actionButton(n, { role: "dm", playerId: null }, live, view);
  return (
    <li
      data-testid="cbt-init-pending"
      data-record-id={n.id}
      data-kind={n.kind}
      className="flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate"
        data-testid="cbt-init-pending-text"
        title={pendingRowText(n)}
      >
        {pendingRowText(n)}
      </span>
      {mode !== "none" && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2 text-xs"
          data-testid="cbt-init-pending-action"
          data-record-id={n.id}
          disabled={mode === "disabled" || actions.busy.has(n.id)}
          // A list row like those in Notifications (FR-NOTE-26 origin); its kind decides what it means.
          onClick={(e) => void actions.run(n, originOf("history", e.currentTarget.closest("li")))}
        >
          {n.actionLabel}
        </Button>
      )}
    </li>
  );
}

type NoteActions = ReturnType<typeof useNoteActions>;

function PendingCards({ cards }: { cards: NotificationRecord[] }) {
  const actions = useNoteActions(dmNotificationViews);
  if (cards.length === 0) return null;
  return (
    <section aria-label="Pending actions" data-testid="cbt-init-pending-list" className="shrink-0">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Pending ({cards.length})</h3>
      {/* FR-CBT-77 (G4): at most 3 rows, then its own scroll, so cards never push the rows away. */}
      <ul className="flex max-h-[104px] flex-col gap-1 overflow-y-auto">
        {cards.map((n) => (
          <PendingRow key={n.id} n={n} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

function Header({ enc, rows }: { enc: EncounterView; rows: CombatantView[] }) {
  const { send, disabled } = useCbtIntent();
  const undo = useUndo(enc.id);
  const turnArgs = {
    encounterId: enc.id,
    expectedRound: enc.round,
    expectedTurnId: enc.turnCombatantId ?? null,
  };
  const unrolled = unrolledMonsters(rows);
  const undoText = undo?.text ?? "Nothing to undo";
  const [ending, setEnding] = useState(false);
  const startEnd = useStartEnd();
  const store = useSync((s) => s.store);
  const openAdd = useCbtxDialogs((s) => s.openAdd);
  const openSummon = useSummonDialog((s) => s.openFor);
  const start = useStartRound(enc.round, rows);
  /**
   * FR-CBT-50: skipped names from the order at send time, toasted once the step is acked. A dead
   * PC skips like a monster at 0 (FR-CBTX-25): "Skipped Thorn (dead)".
   */
  const step = async (direction: "next" | "prev", sender: typeof send = send) => {
    const dead = new Set(rows.filter((c) => deadPc(store, c)).map((c) => c.name));
    // FR-CBT-107: in-turn companions (no rank) never take a turn of their own.
    const turnRows = rows
      .filter((c) => c.position != null)
      .map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position ?? 0,
        kind: dead.has(c.name) ? ("monster" as const) : c.kind,
        removed: c.removed === true,
        hpCurrent: dead.has(c.name) ? 0 : (c.hpCurrent ?? null),
        initiative: c.initiative ?? null,
      }));
    const skipped = skippedOnStep(turnRows, enc.round, enc.turnCombatantId ?? null, direction);
    const r = await sender<TurnResult>(
      direction === "next" ? "cbt.nextTurn" : "cbt.prevTurn",
      turnArgs,
    );
    if (r !== undefined && skipped) {
      toast(<span data-testid="cbt-init-skipped">{skipText(skipped, dead)}</span>);
    }
    // FR-CBTX-07: Prev could not restore an effect whose slot is taken.
    if (r?.notRestored?.length) {
      toast(<span data-testid="cbtx-not-restored">{notRestoredText(r.notRestored)}</span>);
    }
  };
  const undoNow = async () => {
    if (!undo) return;
    const r = await send<UndoResult>("cbt.undo", { expectedHpChangeId: undo.expectedHpChangeId });
    // FR-CBTX-22: effects the apply ended whose slot is taken stay ended.
    if (r?.notRestored?.length) {
      toast(<span data-testid="cbtx-not-restored">{notRestoredText(r.notRestored)}</span>);
    }
  };
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold" title={enc.name}>
          {enc.name}
        </span>
        <span
          data-testid="cbt-init-round"
          data-value={enc.round}
          className="text-xs text-muted-foreground"
        >
          {enc.round === 0 ? "Initiative" : `Round ${enc.round}`}
        </span>
        {/* FR-CBT-51 (G6): End from the Initiative header, confirmed as in Encounters. */}
        <Button
          size="sm"
          variant="ghost"
          data-testid="cbt-init-end"
          className="ml-auto h-7 shrink-0 px-2 text-xs text-destructive hover:text-destructive"
          disabled={disabled}
          onClick={() => setEnding(true)}
        >
          End encounter
        </Button>
      </div>
      <Dialog open={ending} onOpenChange={setEnding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End “{enc.name}”?</DialogTitle>
            <EndConfirmDescription encounterId={enc.id} area="cbt-init" />
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnding(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="cbt-init-end-confirm"
              disabled={disabled || startEnd.disabled}
              onClick={async () => {
                // FR-CBT-60: once acked, this tab's Initiative minimises.
                const r = await startEnd.end(enc.id);
                if (r !== undefined) setEnding(false);
              }}
            >
              End
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          data-testid="cbt-init-prev"
          disabled={disabled || enc.round === 0}
          onClick={() => void step("prev")}
        >
          Prev
        </Button>
        {enc.round === 0 ? (
          <StartButton
            reason={start.reason}
            disabled={disabled || start.busy}
            onClick={() => (start.blocked ? start.pulse() : void step("next", start.send))}
          />
        ) : (
          <Button
            size="sm"
            data-testid="cbt-init-next"
            disabled={disabled}
            onClick={() => void step("next")}
          >
            Next
          </Button>
        )}
        <Tooltip content={undoText}>
          <span>
            <Button
              size="sm"
              variant="ghost"
              data-testid="cbt-init-undo"
              aria-label={undoText}
              disabled={disabled || !undo}
              onClick={() => void undoNow()}
            >
              <RotateCcwIcon className="size-3.5" /> Undo
            </Button>
          </span>
        </Tooltip>
        {showRollMonsters(enc.round, unrolled.length) && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="cbt-init-roll-monsters"
            disabled={disabled || unrolled.length === 0}
            onClick={(e) =>
              void send("cbt.rollInitiative", {
                combatantIds: unrolled.map((c) => c.id),
                mode: modeFromKeys(e, "normal"),
              })
            }
          >
            <DicesIcon className="size-3.5" /> Roll monsters
          </Button>
        )}
        {/* FR-CBTX-33: add combatants mid-fight (picker × quantity). */}
        <Button
          size="sm"
          variant="ghost"
          data-testid="cbtx-init-add"
          className="ml-auto"
          disabled={disabled}
          onClick={openAdd}
        >
          <UserPlusIcon className="size-3.5" /> Add…
        </Button>
        {/* FR-CBT-110 / -118 (sprint 6): summon companions for a PC of the fight. */}
        <Button
          size="sm"
          variant="ghost"
          data-testid="cbt-init-summon"
          disabled={disabled}
          onClick={() => openSummon()}
        >
          <SparklesIcon className="size-3.5" /> Summon…
        </Button>
      </div>
      {start.reason && (
        <p
          id={START_REASON_ID}
          data-testid="cbt-init-start-reason"
          data-flash={start.flash || undefined}
          className={cn(
            "text-xs transition-colors",
            start.flash ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {start.reason}
        </p>
      )}
    </div>
  );
}

const START_REASON_ID = "cbt-init-start-reason";
const FLASH_MS = 700;

/**
 * BL-02 (FR-CBT-14): while a non-removed combatant lacks initiative, Start stays clickable but
 * says why and sends nothing (a click flashes the reason). A `conflict` the server still answers
 * (a race) shows its message in the same line instead of a Toast.
 */
function useStartRound(round: number, rows: CombatantView[]) {
  const connection = useSync((s) => s.connection);
  const missing = round === 0 ? startReason(rows) : null;
  const [rejected, setRejected] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A stale rejection goes once the rows or round change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a reset keyed on these inputs
  useEffect(() => setRejected(null), [round, rows]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pulse = () => {
    clearTimeout(timer.current);
    setFlash(true);
    timer.current = setTimeout(() => setFlash(false), FLASH_MS);
  };
  const send = async <R,>(name: string, payload: unknown): Promise<R | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return ((await connection.sendIntent(name, payload)) ?? null) as R;
    } catch (err) {
      if (err instanceof IntentRejected && err.code === "conflict") {
        setRejected(err.message);
        pulse();
      } else toastIntentError(err);
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { reason: missing ?? rejected, blocked: missing !== null, flash, busy, pulse, send };
}

function StartButton({
  reason,
  disabled,
  onClick,
}: {
  reason: string | null;
  disabled: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button
      size="sm"
      data-testid="cbt-init-next"
      aria-describedby={reason ? START_REASON_ID : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      Start round 1
    </Button>
  );
  return reason ? <Tooltip content={reason}>{button}</Tooltip> : button;
}

function DmInitiativeBody() {
  const enc = useStartedEncounter();
  const everLive = useSync((s) => s.everLive);
  const rows = useCombatants(enc?.id);
  const defs = useDefinitions();
  const cards = usePendingCards(enc?.id);
  // A companion whose owner row isn't listed (removed): the character's name.
  const ownerNameOf = (c: CombatantView) =>
    rows.find((r) => r.kind === "pc" && r.entityId === c.ownerCharacterId)?.name ??
    (c.ownerCharacterId ? defs.get(c.ownerCharacterId)?.name : undefined) ??
    "";
  const openWindow = useOpenWindow();
  const { send, disabled } = useCbtIntent();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLButtonElement>(null);
  const active = useMemo(() => rows.filter((c) => !c.removed), [rows]);
  const activeIds = active.map((c) => c.id);
  // FR-CBT-107 / -118 (sprint 6): in-turn companions as lines in their owner's row.
  const layout = useMemo(() => companionLayout(active, "position"), [active]);
  const listed = useMemo(() => layout.map((l) => l.c), [layout]);
  // FR-CBTX-62, -63 (sprint 8): drag / Move up / down over the listed blocks.
  const reorder = useReorder(enc, rows, listed, listRef, wrapRef);
  // FR-CBT-77 (G4): new rows / the Pending section scroll into view; "↓ N more" below the fold.
  const fold = useBelowFold(rootRef, footerRef, activeIds, cards.length > 0);
  // FR-CBT-125: the row list clips and scrolls; the footer sits under it.
  const clip = useListViewport(rootRef, listRef, footerRef, [...activeIds, `${cards.length}`]);
  if (!everLive) return <Skeleton className="h-24" />;
  if (!enc) {
    return (
      <div data-testid="cbt-init" className="flex flex-col items-center gap-2 py-6 text-center">
        <p data-testid="cbt-init-empty" className="text-sm text-muted-foreground">
          No encounter running — open Encounters
        </p>
        <Button size="sm" variant="outline" onClick={() => openWindow(ENCOUNTERS_KIND)}>
          Encounters
        </Button>
      </div>
    );
  }
  const removed = rows.filter((c) => c.removed);
  const wideInit = active.some((c) => canRollInitiative(enc.round, c.initiative));
  return (
    // Header + pending cards stay put; the rows scroll inside the window (glitch 3), in their
    // own clipping viewport above "↓ N more" (FR-CBT-125).
    <div
      ref={rootRef}
      data-testid="cbt-init"
      data-record-id={enc.id}
      className="flex h-full min-h-0 flex-col gap-2"
      style={clip === null ? undefined : { maxHeight: clip }}
    >
      <Header enc={enc} rows={rows} />
      <PendingCards cards={cards} />
      <div
        ref={listRef}
        data-testid="cbt-init-list"
        className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
      >
        <div
          aria-hidden
          className="sticky top-0 z-10 flex items-center gap-0.5 bg-card px-1 pb-0.5 text-[11px] text-muted-foreground"
        >
          <span className="flex-1 pl-[48px]">Combatant</span>
          <span className={cn("text-center", INIT_W[wideInit ? "wide" : "narrow"])}>Init</span>
          <span className="w-[58px]" />
        </div>
        <ReorderContext.Provider value={reorder}>
          {/* The drop line's frame (FR-CBTX-62); rows measure their spots from it. */}
          <div ref={wrapRef} className="relative" data-dragging={reorder.drag?.id}>
            <ul className="flex flex-col gap-0.5">
              {layout.map(({ c, lines, owner, indent }) => (
                <Row
                  key={c.id}
                  c={c}
                  def={c.entityId ? defs.get(c.entityId) : undefined}
                  turn={enc.turnCombatantId === c.id}
                  round={enc.round}
                  defs={defs}
                  wideInit={wideInit}
                  owner={owner}
                  ownerName={owner?.name ?? ownerNameOf(c)}
                  lines={lines}
                  indent={indent}
                />
              ))}
            </ul>
            <DropLine />
          </div>
        </ReorderContext.Provider>
        {removed.length > 0 && (
          <section aria-label="Removed" className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">Removed</h3>
            {removed.map((c) => (
              <div
                key={c.id}
                data-testid="cbt-init-row"
                data-record-id={c.id}
                data-removed="true"
                className="flex items-center gap-2 px-1 text-sm text-muted-foreground"
              >
                <Portrait name={c.name} imageAssetId={c.imageAssetId} />
                <span className="flex-1 truncate" title={c.name}>
                  {c.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="cbt-init-row-restore"
                  data-record-id={c.id}
                  disabled={disabled}
                  onClick={() => void send("cbt.setRemoved", { combatantId: c.id, removed: false })}
                >
                  Restore
                </Button>
              </div>
            ))}
          </section>
        )}
      </div>
      <MoreFooter footerRef={footerRef} more={fold.more} onClick={fold.scrollToMore} />
    </div>
  );
}

/** P3 glitch 3: once per page load, an empty Initiative minimises (`idleInitiativeOnLoad`). */
function useIdleInitiativeOnLoad() {
  const ready = useShellState((s) => s.key !== null);
  const live = useSync((s) => s.state === "live");
  const started = useSync((s) => startedIn(s.store) !== null);
  const open = useShellState((s) =>
    s.windows.some((w) => w.kind === INITIATIVE_KIND && w.state === "open"),
  );
  const dispatch = useWindowDispatch();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || !live) return;
    done.current = true;
    idleInitiativeOnLoad({ started, open }, { dispatch, noteAppearance });
  }, [ready, live, started, open, dispatch]);
}

/** Dialogs hosted while the window type is available (popup opens from cards and rows). */
function CombatDialogs() {
  useIdleInitiativeOnLoad();
  return (
    <>
      <AttackPopup />
      <HpDialog />
      <SummonDialog />
      <CbtxRuntime />
    </>
  );
}

export const dmInitiativeWindow = defineWindow({
  ...initiativeWindowBase,
  clients: ["dm"],
  // CBT §7: right edge, top (map-first, #162: the DM's only default window besides the log).
  // 400 wide so AC / HP never wrap; rows scroll under the header. 500 high: header + the six
  // `session-sim` rows with no pending card, no scroll, at 1440×900 (FR-SHELL-32, G2).
  defaultSize: { w: 400, h: 500 },
  minSize: { w: 320, h: 240 },
  // FR-SHELL-100: header, controls, 4 rows (play-shell §7 sprint-8 useful sizes).
  usefulSize: { w: 400, h: 380 },
  defaultPosition: { anchor: "top-right" },
  // FR-CBT-77 (G4): height follows the rows until the DM resizes it (FR-SHELL-39); "new" dot
  // while minimised when the round or the turn changes (FR-SHELL-38, N1 = A, #190).
  growToContent: true,
  activity: (store) => {
    const enc = startedIn(store);
    return enc ? `${enc.round}:${enc.turnCombatantId ?? ""}` : null;
  },
  companion: CombatDialogs,
  component: DmInitiativeBody,
});
