// Small combat-extras parts for both clients: effect chips on one line ("+N" for the rest: the
// hidden ones on hover and click, P3 glitch 6; FR-CBTX-33/34; compact labels measured against the room left, FR-CBTX-46; tighter tiers before "+N", BL-08), death pips + state badge (FR-CBTX-33/34), roll / intent helpers.
// Sprint 4 (FR-CBTX-52): trigger chips after the effect chips on the same line. Sprint 5
// (FR-CBTX-54, BL-26): a trigger never folds into "+N"; it goes icon-only first. Sprint 6
// (FR-CBTX-57, -58, BL-43): the name line counts its fixed parts, so the name is never cut; a
// trigger chip is whole or icon-only. Sprint 7 (FR-CBTX-59–61): a concentration chip is whole or
// icon-only too, and a click gives the DM and the PC's owner a menu with End concentration.
// Kit parity (FR-KIT-28): inside an Initiative row's status cell (`StatusCell`) the chips are
// icons (+ rounds, the label in the Tooltip): the first one, then "+N".
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { effectName, roundsLeft } from "@shared/combat-extras/rules";
import type { DeathCounters, EffectView } from "@shared/combat-extras/schemas";
import type { DeathState } from "@shared/entities/schemas";
import { CheckIcon, EyeOffIcon, PencilIcon, TrashIcon, ZapIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { SyncContext, useSync } from "../../sync/store";
import { useCbtIntent } from "../combat-tracker/store";
import { type TriggerChip, triggerLine } from "../effect-modifiers/trigger-badges";
import { EffectIcon, effectValue } from "./icons";
import {
  CHIP_MAX_W,
  CHIP_TIERS,
  type ChipWidths,
  chipLabel,
  chipOrder,
  chipParts,
  chipText,
  concEndsWith,
  concMenuFor,
  concTooltip,
  DEATH_LABEL,
  fitChipRow,
  fitChips,
  fitNameLine,
  type NameLineFit,
  roundsLeftText,
  splitNumbered,
} from "./logic";

const GAP = 2;

/** FR-CBTX-57: the chips' room on their row's name line (`NameLine`); null elsewhere. */
const NameLineRoom = createContext<number | null>(null);

/** FR-KIT-28: chips inside an Initiative row's status cell. */
const InStatusCell = createContext(false);

/** K9: the status cell sits in a narrow Initiative list (under 22rem, as `@max-[22rem]/init`). */
const NarrowList = createContext(false);

/**
 * The `@container/init` breakpoint the narrow list uses, px (22rem). K9 re-test 2: one breakpoint
 * for every narrow variant of the list (chips, medallion, init column), above the band where its
 * HP lines may stack, so a row's room grows steadily with the width there.
 */
const NARROW_LIST_PX = 352;

/**
 * K9 (walkthrough F1): whether the Initiative list around `ref` is narrow (its content box under
 * 22rem: the DM's 320 minimum and up to ≈ 376, the player's 280), re-read when the list resizes.
 */
function useNarrowList(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const list = ref.current?.closest<HTMLElement>('[data-testid="cbt-init-list"]');
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setNarrow(e.contentRect.width < NARROW_LIST_PX);
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

/**
 * FR-KIT-28: an Initiative row's status cell (`init-status`): the `EffectChips` inside draw as
 * icons (+ rounds; the label in the Tooltip), the first one shown, the rest in "+N". At least
 * 56 px, so the initiative numbers line up down the list (the kit's fixed column); on a narrow
 * list (under 22rem) only as wide as its chips, and an empty one takes no room.
 */
export function StatusCell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const narrow = useNarrowList(ref);
  return (
    <span
      ref={ref}
      data-slot="init-status"
      data-narrow={narrow || undefined}
      // K9 (walkthrough F1): in a narrow list (DM 320, player 280) the chips go icon-only (the
      // rounds / uses stay in their Tooltip), so the HP bars keep a readable shared length.
      // K12 re-test (walkthrough 4): one fixed 56-px column (it holds one piece + "+N"), so the
      // initiative numbers line up on every row.
      className="flex w-14 shrink-0 items-center @max-[22rem]/init:w-auto @max-[22rem]/init:empty:hidden @max-[22rem]/init:[&_[data-rounds]]:hidden"
    >
      <InStatusCell.Provider value={true}>
        <NarrowList.Provider value={narrow}>{children}</NarrowList.Provider>
      </InStatusCell.Provider>
    </span>
  );
}

/** `left`: plain rows' "+N" offset, px. */
type Fit = { n: number; tier: number; icons: boolean; wrap: boolean; left: number };

/**
 * How many of a row's effect chips fit its width (FR-CBTX-46: the width left on the name line
 * after the full name). Plain rows (`fitChips`): the rest stay in flow but invisible (clipped by the
 * row) and "+N" sits after the last one that fits. Compact rows (`fitChipRow`, FR-CBTX-54) are
 * measured on an invisible copy of the chips at natural width (`data-chip-measure`): effect chips
 * tighten (BL-08), trigger chips go icon-only, effect chips fold, and only then does the chip row
 * take a line of its own under the name (`wrap`: the name line wraps, the row grows one line; kept
 * until the name line widens or the chips change, so it never flips back and forth). The room on
 * the name line is `NameLine`'s (FR-CBTX-57: after the name and its fixed parts), so the name is
 * never cut (#182). Measured after layout, on resize (ResizeObserver) and when the chips change.
 */
function useFit(count: number, compact: boolean, deps: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const lineRoom = useContext(NameLineRoom);
  const [fit, setFit] = useState<Fit>({ n: count, tier: 0, icons: false, wrap: false, left: 0 });
  const wrapAt = useRef<number | null>(null);
  const lastDeps = useRef(deps);
  // The name line wraps only while the chips sit on their own line (FR-CBTX-54 (4)).
  useLayoutEffect(() => {
    const line = ref.current?.parentElement;
    if (!fit.wrap || !line) return;
    const before = line.style.flexWrap;
    line.style.flexWrap = "wrap";
    return () => {
      line.style.flexWrap = before;
    };
  }, [fit.wrap]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const changed = lastDeps.current !== deps;
    lastDeps.current = deps;
    const measure = () => {
      const line = el.parentElement?.clientWidth ?? 0;
      if (fit.wrap && (changed || wrapAt.current === null || line > wrapAt.current)) {
        // Chips changed or the name line widened: measure on the name line again.
        wrapAt.current = null;
        setFit((f) => ({ ...f, wrap: false }));
        return;
      }
      const room = el.clientWidth;
      if (room === 0) {
        setFit((f) => ({ n: count, tier: 0, icons: false, wrap: f.wrap, left: 0 }));
        return;
      }
      if (compact) {
        const widths = (kind: string): ChipWidths[] =>
          [...el.querySelectorAll<HTMLElement>(`[data-chip-measure="${kind}"]`)].map((m) => {
            const [full = 0, short = full] = [...m.children].map(
              (c) => (c as HTMLElement).offsetWidth,
            );
            return { full, short };
          });
        if (fit.wrap) {
          const r = fitChipRow(widths("effect"), widths("trigger"), room, GAP);
          // On its own line: the same rule on the full width; still too narrow → the chips wrap.
          setFit({ ...(r.wrap ? { n: 0, tier: 0, icons: true } : r), wrap: true, left: 0 });
          return;
        }
        const r = fitChipRow(widths("effect"), widths("trigger"), lineRoom ?? room, GAP);
        if (r.wrap) wrapAt.current = line;
        setFit({ ...r, left: 0 });
        return;
      }
      const ws = [...el.querySelectorAll<HTMLElement>("[data-chip]")].map((k) => k.offsetWidth);
      // FR-CBTX-59: concentration chips come first and never fold; the rest get what's left.
      const conc = [...el.querySelectorAll<HTMLElement>("[data-chip-conc]")].reduce(
        (w, k) => w + k.offsetWidth + GAP,
        0,
      );
      const n = fitChips(ws, room - conc, GAP);
      // "+N" right after the last chip shown.
      const left = n < ws.length ? conc + ws.slice(0, n).reduce((a, w) => a + w + GAP, 0) : 0;
      setFit({ n, tier: 0, icons: false, wrap: false, left });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
    return () => ro?.disconnect();
  }, [count, compact, deps, fit.wrap, lineRoom]);
  return { ref, ...fit, n: Math.min(fit.n, count) };
}

/**
 * A chip's badge. Compact (FR-CBTX-46): label and rounds left in their own spans, so a tight tier
 * cuts the label and keeps "3r" (tier 2: "3"), width capped per tier (BL-08). `natural`: the
 * measuring copy (tier text, tier-0 cap, no test ID). Other span props (ref included, React 19)
 * come from the Tooltip's trigger.
 */
function ChipBadge({
  e,
  round,
  testId,
  className,
  compact,
  tier = 0,
  natural = false,
  icon = false,
  style,
  ...trigger
}: Omit<ComponentProps<"span">, "children"> & {
  e: EffectView;
  round: number | null;
  testId?: string;
  compact: boolean;
  tier?: number;
  natural?: boolean;
  /** FR-KIT-28: icon + rounds left; the label for screen readers only. */
  icon?: boolean;
}) {
  const Icon = EffectIcon(e);
  const t = CHIP_TIERS[tier] ?? CHIP_TIERS[0];
  const { label, rounds } = chipParts(e, round);
  return (
    <Badge
      // The Tooltip's trigger (Radix Slot): its ref, handlers and data-state land on the badge.
      {...trigger}
      variant="outline"
      data-testid={testId}
      data-record-id={testId && e.id}
      data-value={testId && effectValue(e)}
      data-secret={testId && e.secret === true}
      data-tier={testId && compact && !icon ? tier : undefined}
      data-compact={testId && icon ? true : undefined}
      className={cn(
        "shrink-0 gap-0.5 truncate px-1 py-0 text-[11px] font-normal",
        !compact && "max-w-[9rem]",
        e.secret && "border-dashed",
        className,
      )}
      style={compact ? { ...style, maxWidth: natural ? CHIP_MAX_W : t.cap } : style}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {icon ? (
        <>
          <span className="sr-only">{label}</span>
          {rounds !== null && (
            <span data-rounds className="shrink-0">
              {rounds}
            </span>
          )}
        </>
      ) : compact ? (
        <>
          <span className="min-w-0 truncate">{label}</span>
          {rounds !== null && (
            <>
              {" "}
              <span className="ml-0.5 shrink-0">
                {rounds}
                {t.unit ? "r" : ""}
              </span>
            </>
          )}
        </>
      ) : (
        <span className="truncate">{chipText(e, round)}</span>
      )}
      {e.secret && <EyeOffIcon className="size-3 shrink-0" aria-label="Hidden from players" />}
    </Badge>
  );
}

export function EffectChip({
  e,
  round,
  testId,
  className,
  compact = false,
  tier = 0,
  icon = false,
}: {
  e: EffectView;
  round: number | null;
  testId: string;
  className?: string;
  /** FR-CBTX-46 Initiative rows: compact label, ≤ 96 px, full text in a Tooltip. */
  compact?: boolean;
  /** BL-08: `CHIP_TIERS` index (compact only). */
  tier?: number;
  /** FR-KIT-28 (compact only): icon + rounds. */
  icon?: boolean;
}) {
  const badge = (
    <ChipBadge
      e={e}
      round={round}
      testId={testId}
      className={className}
      compact={compact}
      tier={tier}
      icon={compact && icon}
    />
  );
  return compact ? <Tooltip content={chipText(e, round)}>{badge}</Tooltip> : badge;
}

export const TRIGGER_CHIP_ID = "cbtx-trigger-chip";

/** Ready looks ready (success), waiting stays neutral (never a false Ready), used is muted. */
const TRIGGER_CLASS: Record<TriggerChip["state"], string> = {
  ready: "border-success/50 text-success",
  uses: "border-success/50 text-success",
  waiting: "",
  used: "",
};

/**
 * FR-CBTX-52 trigger chip: lightning + name, uses left after it ("Divine Fury 2"; "−1" in
 * `hp.down`), muted + check once used (or no use left). Whole, never cut (FR-CBTX-58): no width
 * cap or ellipsis, so the fit measures its natural width. `icon` (FR-CBTX-54): lightning + uses
 * only ("⚡2"), the used look kept, the name for screen readers. Display only (CBTX §4).
 */
function TriggerChipBadge({
  t,
  testId,
  icon = false,
  ...trigger
}: Omit<ComponentProps<"span">, "children"> & {
  t: TriggerChip;
  testId?: string;
  icon?: boolean;
}) {
  return (
    <Badge
      {...trigger}
      variant="outline"
      data-testid={testId}
      data-record-id={testId && t.id}
      data-state={testId ? t.state : undefined}
      data-value={testId && t.uses ? t.uses.left : undefined}
      data-muted={testId ? t.muted : undefined}
      data-compact={testId ? icon : undefined}
      className={cn(
        "shrink-0 gap-0.5 whitespace-nowrap px-1 py-0 text-[11px] font-normal",
        t.muted ? "text-muted-foreground opacity-70" : TRIGGER_CLASS[t.state],
      )}
    >
      <ZapIcon className="size-3 shrink-0" aria-hidden />
      {icon ? <span className="sr-only">{t.name}</span> : <span>{t.name}</span>}
      {t.uses && (
        <span
          data-rounds={icon || undefined}
          className={cn(!icon && "ml-0.5", "shrink-0", t.down && "text-hp-down")}
        >
          {t.uses.text}
        </span>
      )}
      {t.muted && <CheckIcon className="size-3 shrink-0" aria-label="Used" />}
    </Badge>
  );
}

/** Tooltip: the state sentence; icon-only it names the trigger too ("Divine Fury — ready"). */
export function TriggerChipView({ t, icon = false }: { t: TriggerChip; icon?: boolean }) {
  return (
    <Tooltip content={icon ? triggerLine(t) : t.tooltip}>
      <TriggerChipBadge t={t} testId={TRIGGER_CHIP_ID} icon={icon} />
    </Tooltip>
  );
}

/** FR-CBTX-59's chip test id for the measuring copy's kind (trigger-like: never folds). */
const CONC_MEASURE = "trigger";

/**
 * FR-CBTX-59 (sprint 7): a concentration chip, never cut (no width cap or ellipsis). Compact
 * (Initiative rows): brain + its label ("Conjure Elemental") + "10r" when timed, or `icon`-only
 * (brain + "10r", `data-compact`, the label for screen readers). Elsewhere (the sheet, the card):
 * "Concentrating: Conjure Elemental", wrapping to a second line rather than cutting.
 */
function ConcBadge({
  e,
  round,
  testId,
  compact,
  icon = false,
  ...trigger
}: Omit<ComponentProps<"span">, "children"> & {
  e: EffectView;
  round: number | null;
  testId?: string;
  compact: boolean;
  icon?: boolean;
}) {
  const Icon = EffectIcon(e);
  const label = compact ? (e.label ?? "") : effectName(e);
  const rounds = e.endsRound != null && round !== null ? roundsLeft(e.endsRound, round) : null;
  return (
    <Badge
      {...trigger}
      variant="outline"
      data-testid={testId}
      data-record-id={testId && e.id}
      data-value={testId && effectValue(e)}
      data-secret={testId && e.secret === true}
      data-compact={testId ? icon : undefined}
      data-conc
      className={cn(
        "gap-0.5 px-1 py-0 text-[11px] font-normal",
        compact ? "shrink-0 whitespace-nowrap" : "h-auto min-w-0 whitespace-normal text-left",
        e.secret && "border-dashed",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {icon ? <span className="sr-only">{label}</span> : <span>{label}</span>}
      {rounds !== null && (
        <span data-rounds={icon || undefined} className={cn("shrink-0", !icon && "ml-0.5")}>
          {rounds}r
        </span>
      )}
      {e.secret && <EyeOffIcon className="size-3 shrink-0" aria-label="Hidden from players" />}
    </Badge>
  );
}

interface ConcChipProps {
  e: EffectView;
  round: number | null;
  testId: string;
  compact: boolean;
  icon: boolean;
  /** The DM's Edit… (today's Concentration dialog); absent: no Edit…. */
  onEdit?: (e: EffectView) => void;
}

/**
 * FR-CBTX-59 / -60: the chip with its Tooltip (hover and keyboard focus); with a synced store, the
 * DM and the PC's owner get its menu (`ConcMenuChip`); everyone else a focusable chip.
 */
function ConcChip(p: ConcChipProps) {
  const sync = useContext(SyncContext);
  if (sync) return <ConcMenuChip {...p} />;
  return (
    <Tooltip content={concTooltip(p.e, p.round)}>
      <ConcBadge
        e={p.e}
        round={p.round}
        testId={p.testId}
        compact={p.compact}
        icon={p.icon}
        tabIndex={0}
      />
    </Tooltip>
  );
}

/**
 * FR-CBTX-60 / -61 (OQ-CBTX-30 A): a click (or Enter / Space) opens `cbtx-conc-menu`: "Concentrating:
 * Conjure Elemental", "10 rounds left", what ends with it (the viewer's store), **End
 * concentration** (`cbtx.endEffect`, as Active effects' End; closes on ack, a reject toasts), the
 * DM's Edit…. Items disabled while not live. Other viewers: the chip is focusable, Tooltip only.
 */
function ConcMenuChip({ e, round, testId, compact, icon, onEdit }: ConcChipProps) {
  const store = useSync((s) => s.store);
  const who = concMenuFor(store, e);
  const { send, disabled } = useCbtIntent();
  const [open, setOpen] = useState(false);
  const tip = concTooltip(e, round);
  const badge = <ConcBadge e={e} round={round} testId={testId} compact={compact} icon={icon} />;
  if (!who) {
    return (
      <Tooltip content={tip}>
        <ConcBadge e={e} round={round} testId={testId} compact={compact} icon={icon} tabIndex={0} />
      </Tooltip>
    );
  }
  const left = roundsLeftText(e, round);
  const ends = concEndsWith(store, e);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 rounded-md text-left"
          aria-label={tip}
          data-testid="cbtx-conc-chip"
          data-record-id={e.id}
        >
          <Tooltip content={tip}>{badge}</Tooltip>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-w-72"
        data-testid="cbtx-conc-menu"
        data-record-id={e.id}
      >
        <DropdownMenuLabel data-testid="cbtx-conc-title">{effectName(e)}</DropdownMenuLabel>
        {left && (
          <p className="px-2 text-xs text-muted-foreground" data-testid="cbtx-conc-rounds">
            {left}
          </p>
        )}
        {ends.length > 0 && (
          <p className="px-2 pb-1 text-xs text-muted-foreground" data-testid="cbtx-conc-ends">
            Ends with it: {ends.join(", ")}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-testid="cbtx-conc-end"
          data-record-id={e.id}
          disabled={disabled}
          onSelect={(ev) => {
            // FR-CBTX-61: the menu closes on ack; a reject keeps it (the toast says why).
            ev.preventDefault();
            void send(CBTX_INTENTS.endEffect, { effectId: e.id }).then((r) => {
              if (r !== undefined) setOpen(false);
            });
          }}
        >
          <TrashIcon /> End concentration
        </DropdownMenuItem>
        {who === "dm" && onEdit && (
          <DropdownMenuItem
            data-testid="cbtx-conc-edit"
            data-record-id={e.id}
            disabled={disabled}
            onSelect={() => onEdit(e)}
          >
            <PencilIcon /> Edit…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One line of chips, concentration first, then the trigger chips (FR-CBTX-52, compact rows only).
 * Effect chips that don't fit collapse into "+N" (hover and click list them); trigger chips never
 * do (FR-CBTX-54): they go icon-only first, and wrap under the name as a last resort. Sprint 7
 * (FR-CBTX-59): concentration chips are fitted like trigger chips (whole or icon-only, never
 * folded or cut) and have their own menu (FR-CBTX-60; `onEditConcentration` = the DM's Edit…).
 * `menu(e)` (DM): another effect chip opens a menu with those items.
 */
interface EffectChipsProps {
  effects: readonly EffectView[];
  triggers?: readonly TriggerChip[];
  round: number | null;
  testId: string;
  menu?: (e: EffectView) => ReactNode;
  onEditConcentration?: (e: EffectView) => void;
  className?: string;
  compact?: boolean;
}

export function EffectChips(p: EffectChipsProps) {
  const status = useContext(InStatusCell);
  return status ? <StatusChips {...p} /> : <LineChips {...p} />;
}

/** An effect chip, or (DM, `menu`) the button that opens its menu (Edit… / End). */
function MenuChip({
  e,
  round,
  menu,
  children,
}: {
  e: EffectView;
  round: number | null;
  menu?: (e: EffectView) => ReactNode;
  children: ReactNode;
}) {
  if (!menu) return children;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex rounded-md" aria-label={chipText(e, round)}>
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{menu(e)}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * FR-KIT-28: how many effect chips the status cell shows before "+N": none beside a concentration
 * chip (it never folds, FR-CBTX-59), else the first. K9 (walkthrough F1): in a narrow list two or
 * more effects all go into "+N" (one chip), so the row's HP bar keeps the list's shared length.
 */
export function statusShown(conc: number, fx: number, narrow: boolean): number {
  if (conc > 0 || fx === 0) return 0;
  return narrow && fx > 1 ? 0 : 1;
}

/**
 * K12 re-test (walkthrough 4): the status cell's one shown piece: a concentration chip, else the
 * first trigger chip, else `statusShown`'s effect; everything else goes into "+N".
 */
export function statusPieces(
  conc: number,
  triggers: number,
  fx: number,
  narrow: boolean,
): { conc: number; triggers: number; effects: number } {
  if (conc > 0) return { conc: 1, triggers: 0, effects: 0 };
  if (triggers > 0) return { conc: 0, triggers: 1, effects: 0 };
  return { conc: 0, triggers: 0, effects: statusShown(0, fx, narrow) };
}

/**
 * FR-KIT-28: the status cell's chips, icons with rounds (the label in the Tooltip). Concentration
 * comes first and never folds (FR-CBTX-59), so with one every other effect goes into "+N"; else
 * the first effect shows and the rest fold. Chip menus (Edit… / End), the concentration menu and
 * "+N"'s list are today's. K12 re-test (walkthrough 4, amends FR-CBTX-54 in the status cell): the
 * cell shows ONE piece (concentration, else the first trigger, else the first effect) and "+N"
 * for the rest, triggers included (in "+N"'s menu with their state line); beside "+N" the piece
 * drops its rounds / uses (kept in its Tooltip), so the cell keeps its fixed column.
 */
function StatusChips({
  effects,
  triggers = [],
  round,
  testId,
  menu,
  onEditConcentration,
  className,
}: EffectChipsProps) {
  const ordered = chipOrder(effects);
  const conc = ordered.filter((e) => e.kind === "concentration");
  const fx = ordered.filter((e) => e.kind !== "concentration");
  const narrow = useContext(NarrowList);
  if (ordered.length === 0 && triggers.length === 0) return null;
  const pick = statusPieces(conc.length, triggers.length, fx.length, narrow);
  const shownConc = conc.slice(0, pick.conc);
  const shownTriggers = triggers.slice(0, pick.triggers);
  const shown = fx.slice(0, pick.effects);
  const folded = [...conc.slice(pick.conc), ...fx.slice(pick.effects)];
  const foldedTriggers = triggers.slice(pick.triggers);
  const more = folded.length + foldedTriggers.length > 0;
  return (
    <div
      data-chip-row
      data-status
      data-more={more || undefined}
      className={cn(
        "flex shrink-0 flex-nowrap items-center gap-0.5",
        more && "[&_[data-rounds]]:hidden",
        className,
      )}
    >
      {shownTriggers.map((t) => (
        <span key={`t:${t.id}`} data-trigger className="flex shrink-0">
          <TriggerChipView t={t} icon />
        </span>
      ))}
      {shownConc.map((e) => (
        <span key={`c:${e.id}`} data-chip-conc className="flex shrink-0">
          <ConcChip e={e} round={round} testId={testId} compact icon onEdit={onEditConcentration} />
        </span>
      ))}
      {shown.map((e) => (
        <span key={e.id} data-chip className="flex shrink-0">
          <MenuChip e={e} round={round} menu={menu}>
            <EffectChip e={e} round={round} testId={testId} compact icon />
          </MenuChip>
        </span>
      ))}
      {more && (
        <MoreChip
          hidden={folded}
          triggers={foldedTriggers}
          round={round}
          testId={testId}
          menu={menu}
        />
      )}
    </div>
  );
}

function LineChips({
  effects,
  triggers = [],
  round,
  testId,
  menu,
  onEditConcentration,
  className,
  compact = false,
}: EffectChipsProps) {
  const ordered = chipOrder(effects);
  const conc = ordered.filter((e) => e.kind === "concentration");
  const fx = ordered.filter((e) => e.kind !== "concentration");
  const trig = compact ? triggers : [];
  const { ref, n, tier, icons, wrap, left } = useFit(
    fx.length,
    compact,
    [
      ...conc.map((e) => `c:${e.id}:${chipText(e, round)}`),
      ...fx.map((e) => `${e.id}:${compact ? chipLabel(e, round) : chipText(e, round)}`),
      ...trig.map((t) => `${t.id}:${t.name}:${t.uses?.text ?? ""}:${t.muted}`),
    ].join(),
  );
  if (ordered.length === 0 && trig.length === 0) return null;
  const folded = fx.slice(n);
  return (
    <div
      ref={ref}
      data-chip-row
      data-wrap={compact ? wrap : undefined}
      className={cn(
        // Never narrower than the "+N" chip; chips collapse before the name truncates.
        "relative flex min-w-7 flex-1 items-center gap-0.5 overflow-hidden",
        wrap ? "flex-wrap" : "flex-nowrap",
        className,
      )}
      // FR-CBTX-54 (4): a line of its own under the name, after everything else on it.
      style={wrap ? { flexBasis: "100%", order: 1 } : undefined}
    >
      {compact && (
        // BL-08: each effect chip's natural width with "3r" and with "3"; each trigger chip's
        // with its name and icon-only (FR-CBTX-54). Never shown.
        <div
          aria-hidden
          className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-0.5"
        >
          {conc.map((e) => (
            <span key={e.id} data-chip-measure={CONC_MEASURE} className="flex gap-0.5">
              <ConcBadge e={e} round={round} compact />
              <ConcBadge e={e} round={round} compact icon />
            </span>
          ))}
          {fx.map((e) => (
            <span key={e.id} data-chip-measure="effect" className="flex gap-0.5">
              <ChipBadge e={e} round={round} compact natural />
              <ChipBadge e={e} round={round} compact natural tier={CHIP_TIERS.length - 1} />
            </span>
          ))}
          {trig.map((t) => (
            <span key={t.id} data-chip-measure="trigger" className="flex gap-0.5">
              <TriggerChipBadge t={t} />
              <TriggerChipBadge t={t} icon />
            </span>
          ))}
        </div>
      )}
      {conc.map((e) => (
        <span
          key={`c:${e.id}`}
          data-chip-conc
          className={cn("flex", compact ? "shrink-0" : "min-w-0 shrink")}
        >
          <ConcChip
            e={e}
            round={round}
            testId={testId}
            compact={compact}
            icon={compact && icons}
            onEdit={onEditConcentration}
          />
        </span>
      ))}
      {fx.map((e, i) => {
        const hidden = i >= n;
        const chip = (
          <EffectChip e={e} round={round} testId={testId} compact={compact} tier={tier} />
        );
        return (
          <span
            key={e.id}
            data-chip
            // Compact rows take folded chips out of the flow (measured on the copy), so "+N" and
            // the trigger chips follow the last chip shown.
            className={cn("flex shrink-0", hidden && (compact ? "hidden" : "invisible"))}
            aria-hidden={hidden}
          >
            <MenuChip e={e} round={round} menu={hidden ? undefined : menu}>
              {chip}
            </MenuChip>
          </span>
        );
      })}
      {folded.length > 0 && (
        <MoreChip
          hidden={folded}
          round={round}
          testId={testId}
          left={compact ? undefined : left}
          menu={menu}
        />
      )}
      {trig.map((t) => (
        <span key={`t:${t.id}`} data-trigger className="flex shrink-0">
          <TriggerChipView t={t} icon={icons} />
        </span>
      ))}
    </div>
  );
}

/**
 * The "+N" chip (P3 glitch 6): its Tooltip names the folded effects only (a trigger never folds,
 * FR-CBTX-54); a click lists them, full text (DM: each with its chip menu, Edit… / End). In flow on
 * compact rows; plain rows place it at `left`.
 */
function MoreChip({
  hidden,
  triggers = [],
  round,
  testId,
  left,
  menu,
}: {
  hidden: readonly EffectView[];
  /** K12 re-test: the status cell's folded trigger chips (their state line in the menu). */
  triggers?: readonly TriggerChip[];
  round: number | null;
  testId: string;
  left?: number;
  menu?: (e: EffectView) => ReactNode;
}) {
  const names = [
    ...hidden.map((e) => chipText(e, round)),
    ...triggers.map((t) => triggerLine(t)),
  ].join(", ");
  const n = hidden.length + triggers.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex shrink-0 rounded-md", left !== undefined && "absolute")}
          style={left !== undefined ? { left } : undefined}
          aria-label={`More effects: ${names}`}
        >
          <Tooltip content={names}>
            <Badge
              variant="secondary"
              data-testid={`${testId}-more`}
              data-value={n}
              className="px-1 py-0 text-[11px]"
            >
              +{n}
            </Badge>
          </Tooltip>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid={`${testId}-more-list`}>
        {hidden.map((e) => {
          const Icon = EffectIcon(e);
          const label = (
            <>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{chipText(e, round)}</span>
              {e.secret && <EyeOffIcon className="size-3.5" aria-label="Hidden from players" />}
            </>
          );
          return menu ? (
            <DropdownMenuSub key={e.id}>
              <DropdownMenuSubTrigger data-testid={`${testId}-more-item`} data-record-id={e.id}>
                {label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>{menu(e)}</DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem key={e.id} data-testid={`${testId}-more-item`} data-record-id={e.id}>
              {label}
            </DropdownMenuItem>
          );
        })}
        {triggers.map((t) => (
          <DropdownMenuItem
            key={`t:${t.id}`}
            data-testid={`${testId}-more-item`}
            data-record-id={t.id}
            data-kind="trigger"
          >
            <ZapIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{triggerLine(t)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATE_CLASS: Record<DeathState, string> = {
  dying: "border-hp-down/50 text-hp-down",
  stable: "",
  dead: "border-hp-down/50 text-hp-down",
};

export function DeathBadge({ state, testId }: { state: DeathState; testId: string }) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-value={state}
      className={cn("shrink-0 px-1.5 text-[11px]", STATE_CLASS[state])}
    >
      {DEATH_LABEL[state]}
    </Badge>
  );
}

/** "●●○ ✗○○": successes then failures, 3 each (FR-CBTX-33). */
export function DeathPips({ c, className }: { c: DeathCounters; className?: string }) {
  const pips = (n: number, on: string) =>
    Array.from({ length: 3 }, (_, i) => (i < n ? on : "○")).join("");
  return (
    <span
      className={cn("shrink-0 font-mono text-[11px] tracking-tight", className)}
      role="img"
      aria-label={`${c.successes} successes, ${c.failures} failures`}
      data-successes={c.successes}
      data-failures={c.failures}
    >
      <span className="text-hp-full">{pips(c.successes, "●")}</span>{" "}
      <span className="text-hp-down">{pips(c.failures, "✗")}</span>
    </span>
  );
}

/**
 * A combatant name, never cut (FR-CBTX-57): on one line, or wrapped onto two (`wrap`, a name wider
 * than its line) without an ellipsis. Base and number in their own spans ("Goblin" + " 2"). The
 * text content is the full name. FR-CBT-143 (sprint 7): wrapped, it never gets narrower than its
 * longest word (`minW` = that word's width, capped at the line), so it breaks between words only;
 * inside a word only when that word alone is wider than the whole line.
 */
export function RowName({
  name,
  testId,
  className,
  wrap = false,
  minW,
}: {
  name: string;
  testId: string;
  className?: string;
  wrap?: boolean;
  minW?: number;
}) {
  const { base, suffix } = splitNumbered(name);
  return (
    <span
      className={wrap ? "wrap-break-word" : "shrink-0 whitespace-nowrap"}
      style={wrap && minW ? { minWidth: minW } : undefined}
      data-testid={testId}
      data-value={name}
      data-wrap={wrap}
    >
      <span data-name-base className={className}>
        {base}
      </span>
      {suffix && (
        <span data-name-suffix className={cn("whitespace-pre", className)}>
          {suffix}
        </span>
      )}
    </span>
  );
}

/** `NameLine`'s natural widths, px (FR-CBTX-57). */
function nameLineWidths(line: HTMLElement) {
  const width = (sel: string) => line.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0;
  // Beside the name, or moved down (`marksWrap`): measured wherever they are.
  const marks = width(":scope > [data-name-head] > [data-name-marks], :scope > [data-name-marks]");
  // FR-CBT-143: each word's natural width; the longest decides a between-words wrap.
  const words = [...line.querySelectorAll<HTMLElement>("[data-word-measure]")];
  return {
    line: line.clientWidth,
    name: width("[data-name-measure]"),
    word: Math.max(0, ...words.map((w) => w.offsetWidth)),
    marks: marks > 0 ? [marks] : [],
    side: width(":scope > [data-name-side]"),
    end: width(":scope > [data-name-end]"),
    chips: line.querySelector(":scope > [data-chip-row]") !== null,
  };
}

/**
 * An Initiative row's name line (FR-CBTX-57, BL-43; DM and player rows): the name, its `marks`
 * (hidden eye-off, skip icon: always beside it), the `side` chip, the chips (`children`, compact
 * `EffectChips`), and `end` (the DM's Moved, which carries `data-name-end`). The chips get the
 * room left after the name's natural width and every fixed part (`fitNameLine`); when the name and
 * its fixed parts don't fit, the side chip and the chips take a second line, and a name wider than
 * the line wraps onto two. Measured on every render (parts come and go with the row) and on
 * resize; natural widths only, so it never flips back and forth.
 */
export function NameLine({
  name,
  testId,
  className,
  marks,
  side,
  end,
  children,
}: {
  name: string;
  /** The name's test ID (`cbt-init-row-name`). */
  testId: string;
  /** The name's text classes (its measuring copy too). */
  className?: string;
  marks?: ReactNode;
  side?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<(NameLineFit & { wordW: number }) | null>(null);
  const measure = useCallback(() => {
    const line = ref.current;
    if (!line || line.clientWidth === 0) return;
    const widths = nameLineWidths(line);
    // FR-CBT-143: the longest word's natural width, capped at the line.
    const wordW = Math.min(widths.word, widths.line);
    const next = { ...fitNameLine(widths), wordW };
    setFit((f) =>
      f?.nameWrap === next.nameWrap &&
      f.marksWrap === next.marksWrap &&
      f.split === next.split &&
      f.room === next.room &&
      f.wordW === next.wordW
        ? f
        : next,
    );
  }, []);
  // Every render: the marks, the side chip and Moved come and go with the row.
  useLayoutEffect(() => measure());
  useLayoutEffect(() => {
    const line = ref.current;
    if (!line || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(line);
    for (const el of line.querySelectorAll(":scope > [data-name-side], [data-name-marks]")) {
      ro.observe(el);
    }
    return () => ro.disconnect();
  }, [measure]);
  const nameWrap = fit?.nameWrap ?? false;
  const marksWrap = fit?.marksWrap ?? false;
  const split = fit?.split ?? false;
  const marksSlot = (
    <span data-name-marks className="flex shrink-0 items-center gap-1 empty:hidden">
      {marks}
    </span>
  );
  const sideSlot = (
    <span data-name-side className="flex shrink-0 empty:hidden">
      {side}
    </span>
  );
  return (
    <div
      ref={ref}
      data-name-line
      data-split={split}
      className="relative flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5"
    >
      {/* The name's natural width (and each word's, FR-CBT-143), whatever its line does. Never
          shown. */}
      <span aria-hidden className="pointer-events-none invisible absolute size-0 overflow-hidden">
        <span data-name-measure className={cn("block w-max whitespace-pre", className)}>
          {name}
        </span>
        {name.split(/\s+/).map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one measuring span per word, in order
          <span key={i} data-word-measure className={cn("block w-max whitespace-pre", className)}>
            {w}
          </span>
        ))}
      </span>
      <span
        data-name-head
        className={cn("flex items-center gap-1", nameWrap ? "min-w-0" : "shrink-0")}
        style={nameWrap && fit?.wordW ? { minWidth: fit.wordW } : undefined}
      >
        <RowName
          name={name}
          testId={testId}
          className={className}
          wrap={nameWrap}
          minW={fit?.wordW}
        />
        {!marksWrap && marksSlot}
      </span>
      {split && !nameWrap && end}
      {split && <span data-name-break aria-hidden className="h-0 basis-full" />}
      {/* The name fits but not with its marks: they lead the next line (note 3). */}
      {marksWrap && marksSlot}
      {sideSlot}
      <NameLineRoom.Provider value={fit?.room ?? null}>{children}</NameLineRoom.Provider>
      {(!split || nameWrap) && end}
    </div>
  );
}
