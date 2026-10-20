// Small combat-extras parts for both clients: effect chips on one line ("+N" for the rest: the
// hidden ones on hover and click, P3 glitch 6; FR-CBTX-33/34; compact labels measured against the room left, FR-CBTX-46; tighter tiers before "+N", BL-08), death pips + state badge (FR-CBTX-33/34), roll / intent helpers.
// Sprint 4 (FR-CBTX-52): trigger chips after the effect chips on the same line. Sprint 5
// (FR-CBTX-54, BL-26): a trigger never folds into "+N"; it goes icon-only first. Sprint 6
// (FR-CBTX-57, -58, BL-43): the name line counts its fixed parts, so the name is never cut; a
// trigger chip is whole or icon-only.
import type { DeathCounters, EffectView } from "@shared/combat-extras/schemas";
import type { DeathState } from "@shared/entities/schemas";
import { CheckIcon, EyeOffIcon, ZapIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
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
  DEATH_LABEL,
  fitChipRow,
  fitChips,
  fitNameLine,
  type NameLineFit,
  splitNumbered,
} from "./logic";

const GAP = 2;

/** FR-CBTX-57: the chips' room on their row's name line (`NameLine`); null elsewhere. */
const NameLineRoom = createContext<number | null>(null);

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
      const n = fitChips(ws, room, GAP);
      // "+N" right after the last chip shown.
      const left = n < ws.length ? ws.slice(0, n).reduce((a, w) => a + w + GAP, 0) : 0;
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
  style,
  ...trigger
}: Omit<ComponentProps<"span">, "children"> & {
  e: EffectView;
  round: number | null;
  testId?: string;
  compact: boolean;
  tier?: number;
  natural?: boolean;
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
      data-tier={testId && compact ? tier : undefined}
      className={cn(
        "shrink-0 gap-0.5 truncate px-1 py-0 text-[11px] font-normal",
        !compact && "max-w-[9rem]",
        e.secret && "border-dashed",
        className,
      )}
      style={compact ? { ...style, maxWidth: natural ? CHIP_MAX_W : t.cap } : style}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {compact ? (
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
}: {
  e: EffectView;
  round: number | null;
  testId: string;
  className?: string;
  /** FR-CBTX-46 Initiative rows: compact label, ≤ 96 px, full text in a Tooltip. */
  compact?: boolean;
  /** BL-08: `CHIP_TIERS` index (compact only). */
  tier?: number;
}) {
  const badge = (
    <ChipBadge
      e={e}
      round={round}
      testId={testId}
      className={className}
      compact={compact}
      tier={tier}
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
        <span className={cn(!icon && "ml-0.5", "shrink-0", t.down && "text-hp-down")}>
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

/**
 * One line of chips, concentration first, then the trigger chips (FR-CBTX-52, compact rows only).
 * Effect chips that don't fit collapse into "+N" (hover and click list them); trigger chips never
 * do (FR-CBTX-54): they go icon-only first, and wrap under the name as a last resort.
 * `menu(e)` (DM): an effect chip opens a menu with those items.
 */
export function EffectChips({
  effects,
  triggers = [],
  round,
  testId,
  menu,
  className,
  compact = false,
}: {
  effects: readonly EffectView[];
  triggers?: readonly TriggerChip[];
  round: number | null;
  testId: string;
  menu?: (e: EffectView) => ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const fx = chipOrder(effects);
  const trig = compact ? triggers : [];
  const { ref, n, tier, icons, wrap, left } = useFit(
    fx.length,
    compact,
    [
      ...fx.map((e) => `${e.id}:${compact ? chipLabel(e, round) : chipText(e, round)}`),
      ...trig.map((t) => `${t.id}:${t.name}:${t.uses?.text ?? ""}:${t.muted}`),
    ].join(),
  );
  if (fx.length === 0 && trig.length === 0) return null;
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
            {menu && !hidden ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="flex rounded-md" aria-label={chipText(e, round)}>
                    {chip}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">{menu(e)}</DropdownMenuContent>
              </DropdownMenu>
            ) : (
              chip
            )}
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
  round,
  testId,
  left,
  menu,
}: {
  hidden: readonly EffectView[];
  round: number | null;
  testId: string;
  left?: number;
  menu?: (e: EffectView) => ReactNode;
}) {
  const names = hidden.map((e) => chipText(e, round)).join(", ");
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
              data-value={hidden.length}
              className="px-1 py-0 text-[11px]"
            >
              +{hidden.length}
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
 * text content is the full name.
 */
export function RowName({
  name,
  testId,
  className,
  wrap = false,
}: {
  name: string;
  testId: string;
  className?: string;
  wrap?: boolean;
}) {
  const { base, suffix } = splitNumbered(name);
  return (
    <span
      className={wrap ? "min-w-0 wrap-anywhere" : "shrink-0 whitespace-nowrap"}
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
  const marks = width(":scope > [data-name-head] > [data-name-marks]");
  return {
    line: line.clientWidth,
    name: width("[data-name-measure]"),
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
  const [fit, setFit] = useState<NameLineFit | null>(null);
  const measure = useCallback(() => {
    const line = ref.current;
    if (!line || line.clientWidth === 0) return;
    const next = fitNameLine(nameLineWidths(line));
    setFit((f) =>
      f?.nameWrap === next.nameWrap && f.split === next.split && f.room === next.room ? f : next,
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
  const split = fit?.split ?? false;
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
      {/* The name's natural width, whatever its line does. Never shown. */}
      <span aria-hidden className="pointer-events-none invisible absolute size-0 overflow-hidden">
        <span data-name-measure className={cn("block w-max whitespace-pre", className)}>
          {name}
        </span>
      </span>
      <span
        data-name-head
        className={cn("flex items-center gap-1", nameWrap ? "min-w-0" : "shrink-0")}
      >
        <RowName name={name} testId={testId} className={className} wrap={nameWrap} />
        <span data-name-marks className="flex shrink-0 items-center gap-1 empty:hidden">
          {marks}
        </span>
      </span>
      {split && !nameWrap && end}
      {split && <span data-name-break aria-hidden className="h-0 basis-full" />}
      {sideSlot}
      <NameLineRoom.Provider value={fit?.room ?? null}>{children}</NameLineRoom.Provider>
      {(!split || nameWrap) && end}
    </div>
  );
}
