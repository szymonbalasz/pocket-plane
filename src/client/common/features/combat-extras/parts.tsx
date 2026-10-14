// Small combat-extras parts for both clients: effect chips on one line ("+N" for the rest, full
// list on hover; FR-CBTX-33/34), death pips + state badge (FR-CBTX-33/34), roll / intent helpers.
import type { DeathCounters, EffectView } from "@shared/combat-extras/schemas";
import type { DeathState } from "@shared/entities/schemas";
import { EyeOffIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { EffectIcon, effectValue } from "./icons";
import { chipOrder, chipText, DEATH_LABEL } from "./logic";

/** Width kept for the "+N" chip when some chips don't fit, px. */
const MORE_W = 30;

/**
 * How many of a row's chips fit its width; the rest stay in flow but invisible (clipped by the
 * row) and "+N" sits after the last one that fits. Measured after layout and on resize, so a row
 * never wraps or grows (FR-SHELL-32's 6 rows hold).
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
      const right = (k: HTMLElement) => k.offsetLeft + k.offsetWidth;
      if (width === 0 || kids.every((k) => right(k) <= width)) {
        setFit({ n: count, left: 0 });
        return;
      }
      let n = 0;
      while (n < kids.length && right(kids[n] as HTMLElement) <= width - MORE_W) n++;
      setFit({ n, left: n > 0 ? right(kids[n - 1] as HTMLElement) + 2 : 0 });
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
}: {
  e: EffectView;
  round: number | null;
  testId: string;
  className?: string;
}) {
  const Icon = EffectIcon(e);
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-record-id={e.id}
      data-value={effectValue(e)}
      data-secret={e.secret === true}
      className={cn(
        "max-w-[9rem] shrink-0 gap-0.5 truncate px-1 py-0 text-[11px] font-normal",
        e.secret && "border-dashed",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{chipText(e, round)}</span>
      {e.secret && <EyeOffIcon className="size-3 shrink-0" aria-label="Hidden from players" />}
    </Badge>
  );
}

/**
 * One line of chips, concentration first; what doesn't fit collapses into "+N" (hover lists all).
 * `menu(e)` (DM): the chip opens a menu with those items.
 */
export function EffectChips({
  effects,
  round,
  testId,
  menu,
  className,
}: {
  effects: readonly EffectView[];
  round: number | null;
  testId: string;
  menu?: (e: EffectView) => ReactNode;
  className?: string;
}) {
  const list = chipOrder(effects);
  const { ref, fit, left } = useFit(list.length, list.map((e) => `${e.id}:${e.endsRound}`).join());
  if (list.length === 0) return null;
  const shown = list.slice(0, fit);
  const more = list.length - shown.length;
  return (
    <div
      ref={ref}
      className={cn(
        // Never narrower than the "+N" chip: a long name shrinks first.
        "relative flex min-w-[2.25rem] flex-1 flex-nowrap items-center gap-0.5 overflow-hidden",
        className,
      )}
    >
      {list.map((e, i) => {
        const chip = <EffectChip e={e} round={round} testId={testId} />;
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
        <Tooltip content={list.map((e) => chipText(e, round)).join(", ")}>
          <Badge
            variant="secondary"
            data-testid={`${testId}-more`}
            data-value={more}
            className="absolute shrink-0 px-1 py-0 text-[11px]"
            style={{ left }}
          >
            +{more}
          </Badge>
        </Tooltip>
      )}
    </div>
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
