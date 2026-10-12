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

// ---- DropdownMenu ----
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuSub = DM.Sub;
export const DropdownMenuRadioGroup = DM.RadioGroup;

const menuSurface =
  "z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md";
const menuItem =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={sideOffset} className={cn(menuSurface, className)} {...props} />
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
  return <DM.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return (
    <DM.Label
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
    <DM.SubTrigger className={cn(menuItem, "data-[state=open]:bg-accent", className)} {...props}>
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
      <DM.SubContent className={cn(menuSurface, className)} {...props} />
    </DM.Portal>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem className={cn(menuItem, "pl-8", className)} {...props}>
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
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

// ---- ToggleGroup ----
export function ToggleGroup({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return <TG.Root className={cn("flex items-center gap-1", className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
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
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SW.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SW.Root>
  );
}

// ---- Slider ----
export function Slider({ className, ...props }: React.ComponentProps<typeof SL.Root>) {
  return (
    <SL.Root
      className={cn(
        "relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SL.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SL.Range className="absolute h-full bg-primary" />
      </SL.Track>
      <SL.Thumb className="block size-4 rounded-full border border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </SL.Root>
  );
}

// ---- Collapsible ----
export const Collapsible = C.Root;
export const CollapsibleTrigger = C.Trigger;
export const CollapsibleContent = C.Content;
