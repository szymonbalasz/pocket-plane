// shadcn/ui Popover, Switch, Checkbox, ToggleGroup on radix-ui (new file; dice-roll-log first user).
import { CheckIcon } from "lucide-react";
import { Checkbox as C, Popover as P, Switch as S, ToggleGroup as T } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

// ---- Popover ----
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
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

// ---- Switch ----
export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </S.Root>
  );
}

// ---- Checkbox ----
export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "peer size-4 shrink-0 rounded-sm border border-input shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <C.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3.5" />
      </C.Indicator>
    </C.Root>
  );
}

// ---- ToggleGroup (single) ----
export function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof T.Root> & { type: "single" }) {
  return (
    <T.Root
      className={cn("inline-flex items-center rounded-md border border-input", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof T.Item>) {
  return (
    <T.Item
      className={cn(
        "inline-flex h-8 items-center justify-center px-2.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
