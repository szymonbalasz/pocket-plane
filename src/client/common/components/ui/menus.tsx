// shadcn/ui DropdownMenu, Popover, ToggleGroup, Switch, Slider, Collapsible on radix-ui.
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import {
  Collapsible as C,
  DropdownMenu as DM,
  Popover as P,
  Slider as SL,
  Switch as SW,
  ToggleGroup as TG,
} from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { POPOVER_LAYER } from "./layers";
import { menuItem, menuSurface } from "./menu-styles";

// ---- DropdownMenu ----
export const DropdownMenu = DM.Root;
export function DropdownMenuTrigger(props: React.ComponentProps<typeof DM.Trigger>) {
  return <DM.Trigger data-slot={props.asChild ? undefined : "dropdown-menu-trigger"} {...props} />;
}
export const DropdownMenuSub = DM.Sub;
export function DropdownMenuRadioGroup(props: React.ComponentProps<typeof DM.RadioGroup>) {
  return <DM.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  onPointerUpCapture,
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(menuSurface, className)}
        // Radix selects an item on any pointer release over it. A menu opened by right-click opens
        // on the press on Linux / macOS (contextmenu fires on mousedown there), so the same
        // button's release would pick whatever item landed under the cursor: never select on a
        // right-button release (preventDefault skips Radix's own pointerup handler).
        onPointerUpCapture={(e) => {
          onPointerUpCapture?.(e);
          if (e.button === 2) e.preventDefault();
        }}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof DM.Item> & { variant?: "destructive" }) {
  return (
    <DM.Item
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

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DM.Separator>) {
  return (
    <DM.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return (
    <DM.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DM.SubTrigger>) {
  return (
    <DM.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(menuItem, "data-[state=open]:bg-accent", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DM.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(menuSurface, className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(menuItem, "pl-8", className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DM.ItemIndicator>
          <CheckIcon />
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.RadioItem>
  );
}

// ---- Popover ----
// One Popover root + anchor for both files: the anchor's Tooltip suppression (FR-SHELL-31).
export { Popover, PopoverAnchor, PopoverTrigger } from "./controls";

export function PopoverContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        data-slot="popover-content"
        sideOffset={sideOffset}
        className={cn(
          POPOVER_LAYER,
          "w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

// ---- ToggleGroup ----
// FR-KIT-06 (BL-127): the tool group (icon buttons, no border); `controls.tsx`'s is `segmented`.
export function ToggleGroup({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return (
    <TG.Root
      data-slot="toggle-group"
      data-variant="tool"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
      data-slot="toggle-group-item"
      data-variant="tool"
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

// ---- Switch ----
export function Switch({ className, ...props }: React.ComponentProps<typeof SW.Root>) {
  return (
    <SW.Root
      data-slot="switch"
      data-variant="tool"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SW.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SW.Root>
  );
}

// ---- Slider ----
export function Slider({ className, ...props }: React.ComponentProps<typeof SL.Root>) {
  return (
    <SL.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SL.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SL.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SL.Track>
      <SL.Thumb
        data-slot="slider-thumb"
        className="block size-4 rounded-full border border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </SL.Root>
  );
}

// ---- Collapsible ----
export function Collapsible(props: React.ComponentProps<typeof C.Root>) {
  return <C.Root data-slot="collapsible" {...props} />;
}
export function CollapsibleTrigger(props: React.ComponentProps<typeof C.Trigger>) {
  return <C.Trigger data-slot={props.asChild ? undefined : "collapsible-trigger"} {...props} />;
}
export function CollapsibleContent(props: React.ComponentProps<typeof C.Content>) {
  return <C.Content data-slot="collapsible-content" {...props} />;
}
