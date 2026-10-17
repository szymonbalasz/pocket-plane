// Small combat-extras parts for both clients: effect chips on one line ("+N" for the rest: the
// hidden ones on hover and click, P3 glitch 6; FR-CBTX-33/34; compact labels measured against the room left, FR-CBTX-46; tighter tiers before "+N", BL-08), death pips + state badge (FR-CBTX-33/34), roll / intent helpers.
// Sprint 4 (FR-CBTX-52): trigger chips after the effect chips on the same line, last into "+N".
import type { DeathCounters, EffectView } from "@shared/combat-extras/schemas";
import type { DeathState } from "@shared/entities/schemas";
import { CheckIcon, EyeOffIcon, ZapIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useLayoutEffect, useRef, useState } from "react";
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
  fitChips,
  fitChipTiers,
  splitNumbered,
  tierWidths,
} from "./logic";

const GAP = 2;

/**
 * How many of a row's chips fit its width (FR-CBTX-46: the width left on the name line after the
 * full name, `fitChips`); the rest stay in flow but invisible (clipped by the row) and "+N" sits
 * after the last one that fits. Compact rows first try tighter tiers (BL-08, `fitChipTiers`),
 * measured on an invisible copy of the chips at natural width (`data-chip-measure`). Measured
 * after layout, on resize (ResizeObserver) and when the chips change, so a row never wraps or
 * grows (FR-SHELL-32's 6 rows hold).
 */
function useFit(count: number, compact: boolean, deps: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ n: count, tier: 0, left: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the chips change
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const room = el.clientWidth;
      if (room === 0) {
        setFit({ n: count, tier: 0, left: 0 });
        return;
      }
      let widths: number[];
      let n: number;
      let tier = 0;
      if (compact) {
        const chips: ChipWidths[] = [
          ...el.querySelectorAll<HTMLElement>("[data-chip-measure]"),
        ].map((m) => {
          const [full = 0, short = full] = [...m.children].map(
            (c) => (c as HTMLElement).offsetWidth,
          );
          return { full, short };
        });
        ({ n, tier } = fitChipTiers(chips, room, GAP));
        widths = tierWidths(chips, tier);
      } else {
        widths = [...el.querySelectorAll<HTMLElement>("[data-chip]")].map((k) => k.offsetWidth);
        n = fitChips(widths, room, GAP);
      }
      // "+N" right after the last chip shown, at the chosen tier's widths.
      const left = n < widths.length ? widths.slice(0, n).reduce((a, w) => a + w + GAP, 0) : 0;
      setFit({ n, tier, left });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [count, compact, deps]);
  return { ref, fit: Math.min(fit.n, count), tier: fit.tier, left: fit.left };
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
 * `hp.down`), muted + check once used (or no use left). Compact tiers cut the name and keep the
 * count. Display only (CBTX §4).
 */
function TriggerChipBadge({
  t,
  testId,
  tier = 0,
  natural = false,
  style,
  ...trigger
}: Omit<ComponentProps<"span">, "children"> & {
  t: TriggerChip;
  testId?: string;
  tier?: number;
  natural?: boolean;
}) {
  const cap = (CHIP_TIERS[tier] ?? CHIP_TIERS[0]).cap;
  return (
    <Badge
      {...trigger}
      variant="outline"
      data-testid={testId}
      data-record-id={testId && t.id}
      data-state={testId ? t.state : undefined}
      data-value={testId && t.uses ? t.uses.left : undefined}
      data-muted={testId ? t.muted : undefined}
      data-tier={testId ? tier : undefined}
      className={cn(
        "shrink-0 gap-0.5 truncate px-1 py-0 text-[11px] font-normal",
        t.muted ? "text-muted-foreground opacity-70" : TRIGGER_CLASS[t.state],
      )}
      style={{ ...style, maxWidth: natural ? CHIP_MAX_W : cap }}
    >
      <ZapIcon className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{t.name}</span>
      {t.uses && (
        <span className={cn("ml-0.5 shrink-0", t.down && "text-hp-down")}>{t.uses.text}</span>
      )}
      {t.muted && <CheckIcon className="size-3 shrink-0" aria-label="Used" />}
    </Badge>
  );
}

export function TriggerChipView({ t, tier = 0 }: { t: TriggerChip; tier?: number }) {
  return (
    <Tooltip content={t.tooltip}>
      <TriggerChipBadge t={t} testId={TRIGGER_CHIP_ID} tier={tier} />
    </Tooltip>
  );
}

type ChipItem = { kind: "effect"; e: EffectView } | { kind: "trigger"; t: TriggerChip };

const itemKey = (i: ChipItem) => (i.kind === "effect" ? i.e.id : `t:${i.t.id}`);

/**
 * One line of chips, concentration first, then the trigger chips (FR-CBTX-52, compact rows only);
 * what doesn't fit collapses into "+N" (hover and click list the hidden ones).
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
  const list: ChipItem[] = [
    ...chipOrder(effects).map((e) => ({ kind: "effect" as const, e })),
    ...triggers.map((t) => ({ kind: "trigger" as const, t })),
  ];
  const { ref, fit, tier, left } = useFit(
    list.length,
    compact,
    list
      .map((i) =>
        i.kind === "effect"
          ? `${i.e.id}:${compact ? chipLabel(i.e, round) : chipText(i.e, round)}`
          : `${i.t.id}:${i.t.name}:${i.t.uses?.text ?? ""}:${i.t.muted}`,
      )
      .join(),
  );
  if (list.length === 0) return null;
  const shown = list.slice(0, fit);
  const more = list.length - shown.length;
  return (
    <div
      ref={ref}
      data-chip-row
      className={cn(
        // Never narrower than the "+N" chip; chips collapse before the name truncates.
        "relative flex min-w-7 flex-1 flex-nowrap items-center gap-0.5 overflow-hidden",
        className,
      )}
    >
      {compact && (
        // BL-08: each chip's natural width with "3r" and with "3"; never shown.
        <div
          aria-hidden
          className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-0.5"
        >
          {list.map((i) => (
            <span key={itemKey(i)} data-chip-measure className="flex gap-0.5">
              {i.kind === "effect" ? (
                <>
                  <ChipBadge e={i.e} round={round} compact natural />
                  <ChipBadge e={i.e} round={round} compact natural tier={CHIP_TIERS.length - 1} />
                </>
              ) : (
                <TriggerChipBadge t={i.t} natural />
              )}
            </span>
          ))}
        </div>
      )}
      {list.map((item, i) => {
        const hidden = i >= fit;
        if (item.kind === "trigger") {
          return (
            <span
              key={itemKey(item)}
              data-chip
              className={cn("flex shrink-0", hidden && "invisible")}
              aria-hidden={hidden}
            >
              <TriggerChipView t={item.t} tier={tier} />
            </span>
          );
        }
        const e = item.e;
        const chip = (
          <EffectChip e={e} round={round} testId={testId} compact={compact} tier={tier} />
        );
        return (
          <span
            key={e.id}
            data-chip
            className={cn("flex shrink-0", hidden && "invisible")}
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
      {more > 0 && (
        <MoreChip hidden={list.slice(fit)} round={round} testId={testId} left={left} menu={menu} />
      )}
    </div>
  );
}

/**
 * The "+N" chip (P3 glitch 6): its Tooltip names the hidden effects and triggers only; a click
 * lists them, full text (DM: each effect with its chip menu, Edit… / End; triggers display only).
 */
function MoreChip({
  hidden,
  round,
  testId,
  left,
  menu,
}: {
  hidden: readonly ChipItem[];
  round: number | null;
  testId: string;
  left: number;
  menu?: (e: EffectView) => ReactNode;
}) {
  const text = (i: ChipItem) => (i.kind === "effect" ? chipText(i.e, round) : triggerLine(i.t));
  const names = hidden.map(text).join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute flex shrink-0 rounded-md"
          style={{ left }}
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
        {hidden.map((item) => {
          if (item.kind === "trigger") {
            const t = item.t;
            return (
              <DropdownMenuItem
                key={itemKey(item)}
                data-testid={`${TRIGGER_CHIP_ID}-more-item`}
                data-record-id={t.id}
                data-state={t.state}
                className={cn(t.muted && "text-muted-foreground")}
              >
                <ZapIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{triggerLine(t)}</span>
              </DropdownMenuItem>
            );
          }
          const e = item.e;
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
 * A combatant name that truncates in the middle and keeps its number: "Gob… 2" (Initiative row
 * ruling, CBTX walkthrough): Goblin and Goblin 2 stay distinct at any width. The text content
 * is the full name.
 */
export function RowName({
  name,
  testId,
  className,
}: {
  name: string;
  testId: string;
  className?: string;
}) {
  const { base, suffix } = splitNumbered(name);
  return (
    <span className="flex min-w-0 truncate" data-testid={testId} data-value={name} title={name}>
      <span data-name-base className={cn("min-w-[3ch] truncate", className)}>
        {base}
      </span>
      {suffix && (
        <span data-name-suffix className={cn("shrink-0 whitespace-pre", className)}>
          {suffix}
        </span>
      )}
    </span>
  );
}
