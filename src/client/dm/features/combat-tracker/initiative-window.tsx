// DM `cbt.initiative` (CBT §7): round + turns (skip cue, FR-CBT-50), Undo (one apply,
// FR-CBT-35), Roll monsters (FR-CBT-46), End encounter (FR-CBT-51), pending cards, rows by
// `position` (initiative roll / set, AC, HP, band or PC Down (FR-CBT-49), moved (FR-CBT-39),
// Attack; menu Check ▸ / Save ▸ (FR-CBT-44), Damage / heal, Remove), Removed.
import { signed } from "@shared/character-sheet/logic";
import { notRestoredText } from "@shared/combat-extras/rules";
import {
  canRollInitiative,
  critExpression,
  d20Expression,
  healthBand,
  showRollMonsters,
  skippedOnStep,
  unrolledMonsters,
} from "@shared/combat-tracker/rules";
import type {
  CombatantView,
  EncounterView,
  TurnResult,
  UndoResult,
} from "@shared/combat-tracker/schemas";
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
import { characterOf, deadPc, deathStateFor } from "@ui/features/combat-extras/logic";
import { RowName } from "@ui/features/combat-extras/parts";
import { BandBadge, Portrait, TurnMarker } from "@ui/features/combat-tracker/parts";
import {
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { pcDown } from "@ui/features/combat-tracker/token-overlay";
import { ENCOUNTERS_KIND, initiativeWindowBase } from "@ui/features/combat-tracker/window";
import { modeFromKeys } from "@ui/features/dice-roll-log/logic";
import {
  RollButton,
  type RollControl,
  useRollControl,
} from "@ui/features/dice-roll-log/roll-control";
import { actionButton } from "@ui/features/notifications/logic";
import { useNoteActions } from "@ui/features/notifications/parts";
import { originOf } from "@ui/features/notifications/views";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { movementIndicator } from "@ui/features/scenes-map/movement";
import { cn } from "@ui/lib/utils";
import { useSync } from "@ui/sync/store";
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
  SwordIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dmNotificationViews } from "../../notification-views";
import {
  DeathSaveAnchor,
  RowDeath,
  RowEffects,
  RowMenuItems,
  RowTemp,
  useDeadPc,
  useDeathSaveRoll,
} from "../combat-extras/row";
import { CbtxRuntime } from "../combat-extras/runtime";
import { skipText } from "../combat-extras/skip";
import { useCbtxDialogs } from "../combat-extras/store";
import { attackChoices } from "./attack-choices";
import { AttackPopup, acOf, hpOf } from "./attack-popup";
import { useDefinitions, usePendingCards, useUndo } from "./data";
import { EndConfirmDescription, useStartEnd } from "./end-confirm";
import { HpDialog } from "./hp-dialog";
import { isDamageCard, pendingRowText } from "./pending";
import { useCombatDialogs } from "./popup-store";

function InitiativeCell({
  c,
  def,
  round,
}: {
  c: CombatantView;
  def: DefinitionRecord | undefined;
  round: number;
}) {
  const { send, disabled } = useCbtIntent();
  const [draft, setDraft] = useState(c.initiative == null ? "" : String(c.initiative));
  useEffect(() => setDraft(c.initiative == null ? "" : String(c.initiative)), [c.initiative]);
  const control = useRollControl({
    expressions: [d20Expression(def?.statBlock.initBonus ?? 0)],
    category: "initiative",
    label: `${c.name} — Initiative`,
    onRoll: (r) =>
      void send("cbt.rollInitiative", {
        combatantIds: [c.id],
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
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
    <div className="flex w-[100px] items-center justify-end gap-0.5">
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
        <Tooltip
          content={`Roll initiative: d20${bonus < 0 ? "" : "+"}${bonus} (Shift adv, Ctrl dis)`}
        >
          <span>
            <RollButton
              control={control}
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
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Attack (FR-CBT-16). OQ-CHARX-12: a definition with several attack rows gets a picker; the pick
 * rolls through the same control once it has re-rendered with that row (as Check ▸ / Save ▸).
 */
function AttackButton({ c, def }: { c: CombatantView; def: DefinitionRecord | undefined }) {
  const { send, disabled } = useCbtIntent();
  const openCard = useCombatDialogs((s) => s.openCard);
  const choices = attackChoices(def?.statBlock.attacks ?? []);
  const [pick, setPick] = useState<{ index: number; keys: KeyState; n: number } | null>(null);
  const chosen = choices[pick?.index ?? 0];
  const attack = chosen?.attack;
  const control = useRollControl({
    expressions: attack ? [d20Expression(attack.toHit), attack.damage] : ["1d20"],
    critExpressions: attack ? [critExpression(attack.damage)] : undefined,
    category: "attack",
    label: attack ? `${c.name} — ${attack.name} attack` : undefined,
    onRoll: async (r) => {
      const res = await send<{ cardId: string }>("cbt.attack", {
        attackerId: c.id,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual } : {}),
        // One attack: no id, the server's first attack (FR-CHARX-20 back-compat).
        ...(choices.length > 1 && chosen?.attackId ? { attackId: chosen.attackId } : {}),
      });
      if (res) openCard(res.cardId);
    },
  });
  const n = pick?.n;
  // biome-ignore lint/correctness/useExhaustiveDependencies: roll once per pick (n), with the control of that render
  useEffect(() => {
    if (pick) control.roll(pick.keys);
  }, [n]);
  const keys = useRef<KeyState>({});
  if (choices.length > 1) {
    return (
      <>
        {/* Invisible anchor for the physical-dice popover of the picked attack. */}
        <RollButton control={control} tabIndex={-1} aria-hidden className={ANCHOR} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="cbt-init-row-attack"
              data-record-id={c.id}
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={`Attack with ${c.name}`}
              disabled={disabled}
            >
              <SwordIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {choices.map((ch, i) => (
              <DropdownMenuItem
                key={ch.attackId ?? `first-${i}`}
                data-testid="cbt-init-row-attack-option"
                data-record-id={c.id}
                data-value={ch.attackId ?? ""}
                onPointerDown={(e) => {
                  keys.current = { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey };
                }}
                onSelect={() => {
                  const k = keys.current;
                  keys.current = {};
                  setPick((p) => ({ index: i, keys: k, n: (p?.n ?? 0) + 1 }));
                }}
              >
                <span className="flex-1">{ch.attack.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {signed(ch.attack.toHit)} · {ch.attack.damage}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  }
  return (
    <Tooltip content={attack ? `Attack: ${attack.name} (Shift adv, Ctrl dis)` : "No weapon attack"}>
      <span>
        <RollButton
          control={control}
          data-testid="cbt-init-row-attack"
          data-record-id={c.id}
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={`Attack with ${c.name}`}
          disabled={disabled || !attack}
        >
          <SwordIcon className="size-3.5" />
        </RollButton>
      </span>
    </Tooltip>
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
  const [pick, setPick] = useState<{ ability: Ability; keys: KeyState; n: number } | null>(null);
  const ability = pick?.ability ?? "str";
  const control = useRollControl({
    expressions: [d20Expression(bonus(ability) ?? 0)],
    category: kind === "check" ? "ability-check" : "saving-throw",
    label: `${c.name} — ${ABILITY_NAMES[ability]} ${kind}`,
    onRoll: (r) =>
      void send("cbt.rollAbility", {
        combatantId: c.id,
        kind,
        ability,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
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
    roll: (a: Ability, keys: KeyState) =>
      setPick((p) => ({ ability: a, keys, n: (p?.n ?? 0) + 1 })),
  };
}

interface KeyState {
  shiftKey?: boolean;
  ctrlKey?: boolean;
}

/** Close delay of a row-menu submenu, ms: long enough to cross from the trigger to an item. */
const SUB_CLOSE_DELAY = 300;

/**
 * Hover-safe submenu state. At the screen's right edge the submenu flips left, and Radix closes
 * it when the pointer leaves the trigger in any other direction than its last move (a direct
 * move from "Save" to "Dexterity"). A close waits `SUB_CLOSE_DELAY`; entering the submenu keeps
 * it open. Opening is immediate.
 */
function useHoverSafeSub() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    open,
    onOpenChange(next: boolean) {
      clearTimeout(timer.current);
      if (next) setOpen(true);
      else timer.current = setTimeout(() => setOpen(false), SUB_CLOSE_DELAY);
    },
    keep: () => clearTimeout(timer.current),
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
  roll: (a: Ability, keys: KeyState) => void;
  control: RollControl;
}) {
  const keys = useRef<KeyState>({});
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
              keys.current = { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey };
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
      >
        <FootprintsIcon className="size-3" aria-hidden />
        <span className="sr-only">Moved </span>
        {text}
      </span>
    </Tooltip>
  );
}

function Row({
  c,
  def,
  turn,
  round,
  defs,
}: {
  c: CombatantView;
  def: DefinitionRecord | undefined;
  turn: boolean;
  round: number;
  defs: Map<string, DefinitionRecord>;
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
  return (
    <li
      data-testid="cbt-init-row"
      data-record-id={c.id}
      data-turn={turn}
      data-hidden={c.hidden === true}
      data-skipped={skipped}
      className={cn(
        "flex items-center gap-1 rounded-md px-1 py-0.5",
        turn && "bg-accent",
        c.hidden && "opacity-70",
        skipped && "opacity-50",
      )}
    >
      <TurnMarker active={turn} />
      <Portrait name={c.name} imageAssetId={c.imageAssetId} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          {/* Middle-truncated, number kept ("Gob… 2"): names win over chips. */}
          <RowName name={c.name} testId="cbt-init-row-name" className="text-sm font-medium" />
          {c.hidden && (
            <EyeOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Hidden" />
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
          {/* FR-CBTX-33: effect chips, one line ("+N" for the rest). */}
          <RowEffects c={c} round={round} />
          {/* On the name line, right-aligned: the AC / HP / band line has no room left. */}
          <Moved c={c} speed={stats?.speed} />
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          <span className="shrink-0">AC {ac ?? "—"}</span>
          <span className="shrink-0" data-testid="cbt-init-row-hp" data-record-id={c.id}>
            HP {hp ? `${hp.cur}/${hp.max}` : "—"}
          </span>
          <RowTemp c={c} />
          {c.kind === "monster" && hp && (
            <BandBadge band={healthBand(hp.cur, hp.max)} testId="cbt-init-row-band" />
          )}
          {down && !hasDeathState && <BandBadge band="down" testId="cbt-init-row-band" />}
          <RowDeath c={c} />
        </div>
      </div>
      <InitiativeCell c={c} def={def} round={round} />
      <AttackButton c={c} def={def} />
      {/* Invisible anchors for the physical-dice popovers of Check ▸ / Save ▸. */}
      <RollButton control={check.control} tabIndex={-1} aria-hidden className={ANCHOR} />
      <RollButton control={save.control} tabIndex={-1} aria-hidden className={ANCHOR} />
      {c.kind === "pc" && <DeathSaveAnchor control={deathRoll} />}
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
    </li>
  );
}

const ANCHOR = "pointer-events-none size-0 overflow-hidden p-0 opacity-0";

/**
 * FR-CBT-79 (G9): one Pending row per linked notification. A damage card opens the popup; another
 * kind shows its text ("Waiting for Mira: …" when a player owns it) and the DM's action (the
 * view's `onAction`, as in Notifications).
 */
function PendingRow({ n, actions }: { n: NotificationRecord; actions: NoteActions }) {
  const openCard = useCombatDialogs((s) => s.openCard);
  const live = useSync((s) => s.state === "live");
  const view = dmNotificationViews.get(n.kind);
  if (isDamageCard(n)) {
    return (
      <li>
        <Button
          variant="outline"
          size="sm"
          data-testid="cbt-init-card"
          data-record-id={n.id}
          className="w-full justify-start truncate"
          onClick={() => openCard(n.id)}
        >
          <SwordIcon className="size-3.5" /> {n.text}
        </Button>
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
      <span className="min-w-0 flex-1 truncate" data-testid="cbt-init-pending-text">
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
          // A list row like Notifications' (FR-NOTE-26 origin); its kind decides what it means.
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
  /**
   * FR-CBT-50: skipped names from the order at send time, toasted once the step is acked. A dead
   * PC skips like a monster at 0 (FR-CBTX-25): "Skipped Thorn (dead)".
   */
  const step = async (direction: "next" | "prev") => {
    const dead = new Set(rows.filter((c) => deadPc(store, c)).map((c) => c.name));
    const turnRows = rows.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position ?? 0,
      kind: dead.has(c.name) ? ("monster" as const) : c.kind,
      removed: c.removed === true,
      hpCurrent: dead.has(c.name) ? 0 : (c.hpCurrent ?? null),
      initiative: c.initiative ?? null,
    }));
    const skipped = skippedOnStep(turnRows, enc.round, enc.turnCombatantId ?? null, direction);
    const r = await send<TurnResult>(
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
        <span className="truncate text-sm font-semibold">{enc.name}</span>
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
            <EndConfirmDescription encounterId={enc.id} testId="cbt-init-end-pending" />
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
        <Button
          size="sm"
          data-testid="cbt-init-next"
          disabled={disabled}
          onClick={() => void step("next")}
        >
          {enc.round === 0 ? "Start round 1" : "Next"}
        </Button>
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
      </div>
    </div>
  );
}

function DmInitiativeBody() {
  const enc = useStartedEncounter();
  const everLive = useSync((s) => s.everLive);
  const rows = useCombatants(enc?.id);
  const defs = useDefinitions();
  const cards = usePendingCards(enc?.id);
  const openWindow = useOpenWindow();
  const { send, disabled } = useCbtIntent();
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
  const active = rows.filter((c) => !c.removed);
  const removed = rows.filter((c) => c.removed);
  return (
    // Header + pending cards stay put; the rows scroll inside the window (glitch 3).
    <div
      data-testid="cbt-init"
      data-record-id={enc.id}
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <Header enc={enc} rows={rows} />
      <PendingCards cards={cards} />
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <div
          aria-hidden
          className="sticky top-0 z-10 flex items-center gap-1 bg-card px-1 pb-0.5 text-[11px] text-muted-foreground"
        >
          <span className="flex-1 pl-[52px]">Combatant</span>
          <span className="w-[100px] text-center">Init</span>
          <span className="w-[60px]" />
        </div>
        <ul className="flex flex-col gap-0.5">
          {active.map((c) => (
            <Row
              key={c.id}
              c={c}
              def={c.entityId ? defs.get(c.entityId) : undefined}
              turn={enc.turnCombatantId === c.id}
              round={enc.round}
              defs={defs}
            />
          ))}
        </ul>
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
                <span className="flex-1 truncate">{c.name}</span>
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
    </div>
  );
}

/** Dialogs hosted while the window type is available (popup opens from cards and rows). */
function CombatDialogs() {
  return (
    <>
      <AttackPopup />
      <HpDialog />
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
  defaultPosition: { anchor: "top-right" },
  companion: CombatDialogs,
  component: DmInitiativeBody,
});
