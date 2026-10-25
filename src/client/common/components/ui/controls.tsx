// shadcn/ui Popover, Switch, Checkbox, ToggleGroup on radix-ui (new file; dice-roll-log first user).
import { CheckIcon } from "lucide-react";
import { Checkbox as C, Popover as P, Switch as S, ToggleGroup as T } from "radix-ui";
import * as React from "react";
import { cn } from "../../lib/utils";
import { OVERLAY_OPEN_ATTR } from "./overlays";

// ---- Popover ----
interface PopoverState {
  open: boolean;
  /** The `PopoverAnchor` element, if any. */
  anchor: React.RefObject<HTMLElement | null>;
  /** The popover closed by a pointer / focus interaction outside it. */
  outside: React.RefObject<boolean>;
}
const PopoverStateContext = React.createContext<PopoverState | null>(null);

/**
 * FR-SHELL-31: Radix returns focus on close only to a `PopoverTrigger`; an anchored popover
 * returns it to its anchor the same way (not after an outside interaction, which keeps focus
 * where the user clicked). The anchor's Tooltip stays shut on that focus return.
 */
export function returnFocusToAnchor(
  event: Event,
  anchor: HTMLElement | null,
  interactedOutside: boolean,
): void {
  if (event.defaultPrevented || interactedOutside || !anchor?.isConnected) return;
  event.preventDefault();
  anchor.focus({ preventScroll: true });
}

/** Radix Popover root that tells its `PopoverAnchor` whether it is open (FR-SHELL-31). */
export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof P.Root>) {
  const [inner, setInner] = React.useState(defaultOpen ?? false);
  const actual = open ?? inner;
  const anchor = React.useRef<HTMLElement | null>(null);
  const outside = React.useRef(false);
  const state = React.useMemo(() => ({ open: actual, anchor, outside }), [actual]);
  return (
    <PopoverStateContext.Provider value={state}>
      <P.Root
        open={actual}
        onOpenChange={(o) => {
          setInner(o);
          onOpenChange?.(o);
        }}
        {...props}
      />
    </PopoverStateContext.Provider>
  );
}
export function PopoverTrigger(props: React.ComponentProps<typeof P.Trigger>) {
  return <P.Trigger data-slot={props.asChild ? undefined : "popover-trigger"} {...props} />;
}

/** Marks the anchor while its popover is open so the anchor's Tooltip stays shut (FR-SHELL-31). */
export function PopoverAnchor({ ref, ...props }: React.ComponentProps<typeof P.Anchor>) {
  const state = React.useContext(PopoverStateContext);
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (state) state.anchor.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [state, ref],
  );
  return (
    <P.Anchor
      data-slot={props.asChild ? undefined : "popover-anchor"}
      {...{ [OVERLAY_OPEN_ATTR]: state?.open ? "true" : undefined }}
      {...props}
      ref={setRef}
    />
  );
}
export function PopoverClose(props: React.ComponentProps<typeof P.Close>) {
  return <P.Close data-slot={props.asChild ? undefined : "popover-close"} {...props} />;
}

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  onOpenAutoFocus,
  onInteractOutside,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  const state = React.useContext(PopoverStateContext);
  return (
    <P.Portal>
      <P.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          className,
        )}
        onOpenAutoFocus={(e) => {
          if (state) state.outside.current = false;
          onOpenAutoFocus?.(e);
        }}
        onInteractOutside={(e) => {
          onInteractOutside?.(e);
          if (state && !e.defaultPrevented) state.outside.current = true;
        }}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          if (!state) return;
          returnFocusToAnchor(e, state.anchor.current, state.outside.current);
          state.outside.current = false;
        }}
        {...props}
      />
    </P.Portal>
  );
}

// ---- Switch ----
export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <S.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </S.Root>
  );
}

// ---- Checkbox ----
export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-sm border border-input shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <C.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
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
      data-slot="toggle-group"
      className={cn("inline-flex items-center rounded-md border border-input", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof T.Item>) {
  return (
    <T.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-8 items-center justify-center px-2.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
