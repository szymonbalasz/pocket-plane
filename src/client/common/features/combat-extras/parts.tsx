// Small combat-extras parts for both clients: effect chips on one line ("+N" for the rest: the
// hidden ones on hover and click, P3 glitch 6; FR-CBTX-33/34; compact labels measured against the room left, FR-CBTX-46), death pips + state badge (FR-CBTX-33/34), roll / intent helpers.
import type { DeathCounters, EffectView } from "@shared/combat-extras/schemas";
import type { DeathState } from "@shared/entities/schemas";
import { EyeOffIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
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
import { EffectIcon, effectValue } from "./icons";
import { chipLabel, chipOrder, chipText, DEATH_LABEL, fitChips, splitNumbered } from "./logic";

/**
 * How many of a row's chips fit its width (FR-CBTX-46: the width left on the name line after the
 * full name, `fitChips`); the rest stay in flow but invisible (clipped by the row) and "+N" sits
 * after the last one that fits. Measured after layout, on resize (ResizeObserver) and when the
 * chips change, so a row never wraps or grows (FR-SHELL-32's 6 rows hold).
 */
function useFit(count: number, deps: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ n: count, left: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the chips change
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const kids = [...el.querySelectorAll<HTMLElement>("[data-chip]")];
      const width = el.clientWidth;
      if (width === 0) {
        setFit({ n: count, left: 0 });
        return;
      }
      const n = fitChips(
        kids.map((k) => k.offsetWidth),
        width,
      );
      const last = kids[n - 1];
      setFit({ n, left: n < kids.length && last ? last.offsetLeft + last.offsetWidth + 2 : 0 });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [count, deps]);
  return { ref, fit: Math.min(fit.n, count), left: fit.left };
}

export function EffectChip({
  e,
  round,
  testId,
  className,
  compact = false,
}: {
  e: EffectView;
  round: number | null;
  testId: string;
  className?: string;
  /** FR-CBTX-46 Initiative rows: compact label, ≤ 96 px, full text in a Tooltip. */
  compact?: boolean;
}) {
  const Icon = EffectIcon(e);
  const badge = (
    <Badge
      variant="outline"
      data-testid={testId}
      data-record-id={e.id}
      data-value={effectValue(e)}
      data-secret={e.secret === true}
      className={cn(
        "shrink-0 gap-0.5 truncate px-1 py-0 text-[11px] font-normal",
        compact ? "max-w-[96px]" : "max-w-[9rem]",
        e.secret && "border-dashed",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{compact ? chipLabel(e, round) : chipText(e, round)}</span>
      {e.secret && <EyeOffIcon className="size-3 shrink-0" aria-label="Hidden from players" />}
    </Badge>
  );
  return compact ? <Tooltip content={chipText(e, round)}>{badge}</Tooltip> : badge;
}

/**
 * One line of chips, concentration first; what doesn't fit collapses into "+N" (hover and click
 * list the hidden ones).
 * `menu(e)` (DM): the chip opens a menu with those items.
 */
export function EffectChips({
  effects,
  round,
  testId,
  menu,
  className,
  compact = false,
}: {
  effects: readonly EffectView[];
  round: number | null;
  testId: string;
  menu?: (e: EffectView) => ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const list = chipOrder(effects);
  const { ref, fit, left } = useFit(
    list.length,
    list.map((e) => `${e.id}:${compact ? chipLabel(e, round) : chipText(e, round)}`).join(),
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
      {list.map((e, i) => {
        const chip = <EffectChip e={e} round={round} testId={testId} compact={compact} />;
        const hidden = i >= fit;
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
 * The "+N" chip (P3 glitch 6): its Tooltip names the hidden effects only; a click lists them,
 * full text (DM: each with its chip menu, Edit… / End).
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
  left: number;
  menu?: (e: EffectView) => ReactNode;
}) {
  const names = hidden.map((e) => chipText(e, round)).join(", ");
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
