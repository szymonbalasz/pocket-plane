// Launcher: bottom-centre bar, one button per available window type with a launcher entry, and
// a trailing "⋯" menu with "Reset layout" (FR-SHELL-09, FR-SHELL-14). It fits the viewport
// (FR-SHELL-43): icon-only buttons first (keeping the labels that fit, BL-113), then the buttons
// that still don't fit move into the "⋯" menu (`launcher-fit.ts`).
import { EllipsisIcon } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { useActivityDots } from "./activity";
import { badgeText, useBadgeVersion } from "./badges";
import type { Viewport } from "./geometry";
import { SHELL_ZONE_ATTR } from "./keys";
import { fitLauncher, type LauncherFit, launcherMetrics } from "./launcher-fit";
import { launcherState, launcherTooltip, type WindowAction, type Windows } from "./manager";
import type { WindowDef } from "./registry";
import { useShellState } from "./ShellContext";

let canvas: CanvasRenderingContext2D | null = null;
/** Label widths, px, per CSS font string (FR-THEME-07), then per label. */
const widths = new Map<string, Map<string, number>>();
/** Bumped when the widths are dropped, so the bar re-fits. */
let widthsGen = 0;
/** The last font read off a rendered launcher button; a remount starts from it. */
let lastFont: string | null = null;

/**
 * The font launcher labels render in (FR-THEME-07): the computed weight, size and family of a
 * rendered launcher button (`text-xs font-medium`; the label inherits it), so a theme's font is
 * what gets measured. `nav` = the launcher; null before it mounts.
 */
export function launcherFont(nav: ParentNode | null): string | null {
  const button =
    nav?.querySelector('[data-testid="ui-launcher-button"]') ??
    nav?.querySelector('[data-testid="ui-launcher-menu"]');
  if (!button) return null;
  const s = getComputedStyle(button);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

/** Before the first button renders: today's launcher label font. */
function fallbackFont(): string {
  const family =
    typeof getComputedStyle === "function" && typeof document !== "undefined" && document.body
      ? getComputedStyle(document.body).fontFamily
      : "";
  return `500 12px ${family}`;
}

/** Rendered width of a launcher label in `font`, px, measured once per font and label. */
export function labelWidth(label: string, font: string): number {
  let known = widths.get(font);
  if (!known) {
    known = new Map();
    widths.set(font, known);
  }
  const w0 = known.get(label);
  if (w0 !== undefined) return w0;
  if (!canvas && typeof document !== "undefined") {
    canvas = document.createElement("canvas").getContext("2d");
  }
  if (canvas) canvas.font = font;
  const w = Math.ceil(canvas ? canvas.measureText(label).width : label.length * 7) + 1;
  known.set(label, w);
  return w;
}

/** Drops the measured widths (a web font finished loading: same font string, new glyphs). */
export function forgetLabelWidths(): void {
  widths.clear();
  widthsGen++;
}

/**
 * FR-THEME-07: the launcher's label font, read after each mount, when `<html>`'s attributes change
 * (a theme switch) and when web fonts finish loading. A change re-fits before paint.
 */
function useLauncherFont(nav: RefObject<HTMLElement | null>): string {
  const [font, setFont] = useState(() => lastFont ?? fallbackFont());
  const [, setLoaded] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const f = launcherFont(nav.current);
      if (f === null) return;
      lastFont = f;
      setFont(f);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true });
    const loaded = () => {
      forgetLabelWidths();
      setLoaded((n) => n + 1);
      measure();
    };
    document.fonts?.addEventListener("loadingdone", loaded);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", loaded);
    };
  }, [nav]);
  return font;
}

/** The label font, set on every launcher button so its computed font is the label's (FR-THEME-07). */
export const LAUNCHER_FONT = "text-xs";

export function Launcher({
  defs,
  windows,
  viewport,
  dispatch,
}: {
  defs: readonly WindowDef[];
  windows: Windows;
  viewport: Viewport;
  dispatch: (a: WindowAction) => void;
}) {
  const store = useSync((s) => s.store);
  const layoutKey = useShellState((s) => s.key);
  useBadgeVersion(); // re-render on `refreshBadges()`
  const dots = useActivityDots(windows);
  const navRef = useRef<HTMLElement | null>(null);
  const font = useLauncherFont(navRef);
  const entries = defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  const items = entries.map((d) => ({
    kind: d.kind,
    order: d.launcher?.order ?? 0,
    state: launcherState(windows, d.kind),
  }));
  // Recomputed on viewport resize, availability change and layout restore only (FR-SHELL-43):
  // opening a window from the menu leaves it there until then. Label widths: measured once each
  // per font; a new font (FR-THEME-07: theme switch, web font loaded) re-fits too.
  const labels = new Map(entries.map((d) => [d.kind, d.launcher?.label ?? ""]));
  const fitKey = `${viewport.w}|${layoutKey}|${[...labels].join(",")}|${font}|${widthsGen}`;
  const fitRef = useRef<{ key: string; fit: LauncherFit } | null>(null);
  if (fitRef.current?.key !== fitKey) {
    const fit = fitLauncher(
      items,
      viewport.w,
      launcherMetrics(labels, (l) => labelWidth(l, font)),
    );
    fitRef.current = { key: fitKey, fit };
  }
  const { fit } = fitRef.current;
  const inBar = new Set(fit.bar);
  const labelled = new Set(fit.labelled);
  const overflow = entries.filter((d) => !inBar.has(d.kind));
  return (
    <nav
      ref={navRef}
      {...{ [SHELL_ZONE_ATTR]: "launcher" }}
      data-testid="ui-launcher"
      data-compact={fit.compact}
      aria-label="Windows"
      tabIndex={-1}
      className="outline-none pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background/85 p-1 shadow-lg backdrop-blur"
    >
      {entries.map((d) => {
        const l = d.launcher;
        if (!l || !inBar.has(d.kind)) return null;
        const state = launcherState(windows, d.kind);
        const Icon = l.icon;
        const badge = badgeText(d.badge && (() => d.badge?.(store) ?? 0));
        return (
          <Tooltip key={d.kind} content={launcherTooltip(l.label, state)}>
            <Button
              variant="ghost"
              size="sm"
              data-testid="ui-launcher-button"
              data-record-id={d.kind}
              data-state={state}
              data-compact={!labelled.has(d.kind)}
              aria-label={l.label}
              aria-pressed={state === "open"}
              className={cn(
                LAUNCHER_FONT,
                "relative gap-1.5",
                state === "open" && "bg-secondary text-secondary-foreground",
              )}
              onClick={() => dispatch({ type: "toggle", kind: d.kind })}
            >
              <Icon className="size-4" />
              {labelled.has(d.kind) && <span>{l.label}</span>}
              {badge !== null && (
                <span
                  data-testid={`${d.kind.split(".")[0]}-launcher-badge`}
                  data-count={badge}
                  className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
                >
                  {badge}
                </span>
              )}
              {/* FR-SHELL-38: "new" dot, top-left (the badge keeps top-right). */}
              {dots.has(d.kind) && (
                <span
                  data-testid="ui-launcher-activity"
                  className="absolute -top-0.5 -left-0.5 size-2 rounded-full bg-warning"
                />
              )}
              <StateMarker state={state} />
            </Button>
          </Tooltip>
        );
      })}
      <M.Root>
        {/* FR-SHELL-43: the overflow count rides on the menu trigger's wrapper. */}
        <span
          data-testid="ui-launcher-overflow"
          data-count={overflow.length}
          className="relative inline-flex"
        >
          <M.Trigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={LAUNCHER_FONT}
              data-testid="ui-launcher-menu"
              aria-label={overflow.length > 0 ? `More windows (${overflow.length})` : "Layout menu"}
            >
              <EllipsisIcon className="size-4" />
            </Button>
          </M.Trigger>
          {overflow.some((d) => dots.has(d.kind)) && (
            <span className="pointer-events-none absolute -top-0.5 -left-0.5 size-2 rounded-full bg-warning" />
          )}
        </span>
        <M.Portal>
          <M.Content
            side="top"
            sideOffset={6}
            className="z-50 min-w-40 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          >
            {overflow.map((d) => {
              const l = d.launcher;
              if (!l) return null;
              const state = launcherState(windows, d.kind);
              const Icon = l.icon;
              const badge = badgeText(d.badge && (() => d.badge?.(store) ?? 0));
              return (
                <M.Item
                  key={d.kind}
                  data-testid="ui-launcher-overflow-item"
                  data-record-id={d.kind}
                  data-state={state}
                  className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent"
                  onSelect={() => dispatch({ type: "toggle", kind: d.kind })}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{l.label}</span>
                  {badge !== null && (
                    <span className="rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                      {badge}
                    </span>
                  )}
                  {dots.has(d.kind) && <span className="size-2 rounded-full bg-warning" />}
                  {/* The moved button keeps its state: open = dot, minimised = ring. */}
                  {state === "open" && (
                    <span data-marker="open" className="size-1.5 rounded-full bg-foreground" />
                  )}
                  {state === "minimised" && (
                    <span
                      data-marker="minimised"
                      className="size-1.5 rounded-full border border-muted-foreground"
                    />
                  )}
                </M.Item>
              );
            })}
            {overflow.length > 0 && <M.Separator className="my-1 h-px bg-border" />}
            <M.Item
              data-testid="ui-launcher-reset"
              className="cursor-default rounded-sm px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={() => dispatch({ type: "reset" })}
            >
              Reset layout
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
    </nav>
  );
}

/** FR-SHELL-37: open = solid bar, minimised = hollow ring, closed = nothing. */
function StateMarker({ state }: { state: string }) {
  if (state === "open") {
    return (
      <span
        data-marker="open"
        className="absolute bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground"
      />
    );
  }
  if (state === "minimised") {
    return (
      <span
        data-marker="minimised"
        className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full border border-muted-foreground"
      />
    );
  }
  return null;
}
