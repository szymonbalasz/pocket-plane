// shadcn/ui ContextMenu on radix-ui: the DropdownMenu's look and slots (menus.tsx), opened by
// right-click.
import { ChevronRightIcon } from "lucide-react";
import { ContextMenu as CM } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { menuItem, menuSurface } from "./menu-styles";

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export const ContextMenuSub = CM.Sub;

export function ContextMenuContent({
  className,
  onPointerUpCapture,
  ...props
}: React.ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content
        data-slot="dropdown-menu-content"
        className={cn(menuSurface, className)}
        // As DropdownMenuContent: the release of the button that opened the menu never selects.
        onPointerUpCapture={(e) => {
          onPointerUpCapture?.(e);
          if (e.button === 2) e.preventDefault();
        }}
        {...props}
      />
    </CM.Portal>
  );
}

export function ContextMenuItem({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof CM.Item> & { variant?: "destructive" }) {
  return (
    <CM.Item
      data-slot="dropdown-menu-item"
      data-variant={variant ?? "default"}
      className={cn(
        menuItem,
        variant === "destructive" && "text-destructive focus:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CM.Separator>) {
  return (
    <CM.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CM.SubTrigger>) {
  return (
    <CM.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(menuItem, "data-[state=open]:bg-accent", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </CM.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(menuSurface, className)}
        {...props}
      />
    </CM.Portal>
  );
}
