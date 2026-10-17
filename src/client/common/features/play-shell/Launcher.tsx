// Launcher: bottom-centre bar, one button per available window type with a launcher entry, and
// a trailing "⋯" menu with "Reset layout" (FR-SHELL-09, FR-SHELL-14). It fits the viewport
// (FR-SHELL-43): icon-only buttons first, then the buttons that still don't fit move into the
// "⋯" menu (`launcher-fit.ts`).
import { EllipsisIcon } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { useActivityDots } from "./activity";
import { badgeText, useBadgeVersion } from "./badges";
import type { Viewport } from "./geometry";
import { SHELL_ZONE_ATTR } from "./keys";
import { fitLauncher, launcherMetrics } from "./launcher-fit";
import { launcherState, launcherTooltip, type WindowAction, type Windows } from "./manager";
import type { WindowDef } from "./registry";

let canvas: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Rendered width of a launcher label (`text-xs font-medium`), px, measured once per label. */
function labelWidth(label: string): number {
  const known = widths.get(label);
  if (known !== undefined) return known;
  if (canvas === undefined) {
    canvas =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (canvas) canvas.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
  }
  const w = Math.ceil(canvas ? canvas.measureText(label).width : label.length * 7) + 1;
  widths.set(label, w);
  return w;
}

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
  useBadgeVersion(); // re-render on `refreshBadges()`
  const dots = useActivityDots(windows);
  const entries = defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  const items = entries.map((d) => ({
    kind: d.kind,
    order: d.launcher?.order ?? 0,
    state: launcherState(windows, d.kind),
  }));
  // Label widths are measured once each; the fit itself is a few additions per render.
  const labels = new Map(entries.map((d) => [d.kind, d.launcher?.label ?? ""]));
  const fit = fitLauncher(items, viewport.w, launcherMetrics(labels, labelWidth));
  const inBar = new Set(fit.bar);
  const overflow = entries.filter((d) => !inBar.has(d.kind));
  return (
    <nav
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
              aria-label={l.label}
              aria-pressed={state === "open"}
              className={cn(
                "relative gap-1.5",
                state === "open" && "bg-secondary text-secondary-foreground",
              )}
              onClick={() => dispatch({ type: "toggle", kind: d.kind })}
            >
              <Icon className="size-4" />
              {!fit.compact && <span className="text-xs">{l.label}</span>}
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
