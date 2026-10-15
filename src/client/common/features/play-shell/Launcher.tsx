// Launcher: bottom-centre bar, one button per available window type with a launcher entry, and
// a trailing "⋯" menu with "Reset layout" (FR-SHELL-09, FR-SHELL-14).
import { EllipsisIcon } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { badgeText, useBadgeVersion } from "./badges";
import { SHELL_ZONE_ATTR } from "./keys";
import { launcherState, launcherTooltip, type WindowAction, type Windows } from "./manager";
import type { WindowDef } from "./registry";

export function Launcher({
  defs,
  windows,
  dispatch,
}: {
  defs: readonly WindowDef[];
  windows: Windows;
  dispatch: (a: WindowAction) => void;
}) {
  const store = useSync((s) => s.store);
  useBadgeVersion(); // re-render on `refreshBadges()`
  const entries = defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  return (
    <nav
      {...{ [SHELL_ZONE_ATTR]: "launcher" }}
      data-testid="ui-launcher"
      aria-label="Windows"
      tabIndex={-1}
      className="outline-none pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background/85 p-1 shadow-lg backdrop-blur"
    >
      {entries.map((d) => {
        const l = d.launcher;
        if (!l) return null;
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
              <span className="text-xs">{l.label}</span>
              {badge !== null && (
                <span
                  data-testid={`${d.kind.split(".")[0]}-launcher-badge`}
                  data-count={badge}
                  className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
                >
                  {badge}
                </span>
              )}
              {/* FR-SHELL-37: open = solid bar, minimised = hollow ring, closed = nothing. */}
              {state === "open" && (
                <span
                  data-marker="open"
                  className="absolute bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground"
                />
              )}
              {state === "minimised" && (
                <span
                  data-marker="minimised"
                  className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full border border-muted-foreground"
                />
              )}
            </Button>
          </Tooltip>
        );
      })}
      <M.Root>
        <M.Trigger asChild>
          <Button variant="ghost" size="sm" data-testid="ui-launcher-menu" aria-label="Layout menu">
            <EllipsisIcon className="size-4" />
          </Button>
        </M.Trigger>
        <M.Portal>
          <M.Content
            side="top"
            sideOffset={6}
            className="z-50 min-w-40 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          >
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
