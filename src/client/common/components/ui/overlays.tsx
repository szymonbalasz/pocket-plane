// shadcn/ui Dialog, Select, Tooltip on radix-ui.
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Dialog as D, Select as S, Tooltip as T } from "radix-ui";
import * as React from "react";
import { cn } from "../../lib/utils";
import { enrollTrigger, TIP_ATTR } from "./roving";

// ---- Dialog ----
export const Dialog = D.Root;
export function DialogTrigger(props: React.ComponentProps<typeof D.Trigger>) {
  return <D.Trigger data-slot={props.asChild ? undefined : "dialog-trigger"} {...props} />;
}
export function DialogClose(props: React.ComponentProps<typeof D.Close>) {
  return <D.Close data-slot={props.asChild ? undefined : "dialog-close"} {...props} />;
}

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-overlay/60" />
      <D.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          data-slot="dialog-close"
          className="absolute right-4 top-4 opacity-70 hover:opacity-100"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-footer" className={cn("flex justify-end gap-2", className)} {...props} />
  );
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return (
    <D.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof D.Description>) {
  return (
    <D.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

// ---- Select ----
export const Select = S.Root;
export function SelectValue(props: React.ComponentProps<typeof S.Value>) {
  return <S.Value data-slot="select-value" {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof S.Trigger>) {
  return (
    <S.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-9 min-w-48 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <S.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </S.Icon>
    </S.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content
        data-slot="select-content"
        position="popper"
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
          className,
        )}
        {...props}
      >
        <S.Viewport className="p-1">{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}

export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof S.Item>) {
  return (
    <S.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <S.ItemIndicator>
          <CheckIcon className="size-4" />
        </S.ItemIndicator>
      </span>
      <S.ItemText>{children}</S.ItemText>
    </S.Item>
  );
}

// ---- Tooltip ----
// FR-SHELL-30/31: one open delay for every hover hint, a skip delay between triggers, and no
// tooltip while (or right after) its trigger's overlay is open. Timing and suppression live in
// `TooltipController` (unit-tested with fake timers); Radix only positions and renders.
// FR-SHELL-84: keyboard focus opens it too; a trigger that can't take focus is made reachable
// (`./roving`: one tab stop per chip row).

/** FR-SHELL-30: the one open delay (decided #172). */
export const TOOLTIP_DELAY_MS = 400;
/** FR-SHELL-30: moving to the next trigger within this window opens it at once (#172). */
export const TOOLTIP_SKIP_DELAY_MS = 300;
/**
 * FR-SHELL-31: "true" on an element whose overlay is open but which has no `aria-expanded`
 * (a `PopoverAnchor`); Radix triggers already set `aria-expanded`.
 */
export const OVERLAY_OPEN_ATTR = "data-overlay-open";

/** True while a popover / dialog / menu opened from `el` is open. */
export function overlayOpenOn(el: Element | null): boolean {
  return (
    el?.getAttribute("aria-expanded") === "true" || el?.getAttribute(OVERLAY_OPEN_ATTR) === "true"
  );
}

/** One per provider: the skip-delay window and the single open tooltip. */
export class TooltipGroup {
  private warm = false;
  private skipTimer: ReturnType<typeof setTimeout> | undefined;
  private current: TooltipController | null = null;

  constructor(
    readonly delay = TOOLTIP_DELAY_MS,
    readonly skipDelay = TOOLTIP_SKIP_DELAY_MS,
  ) {}

  /** A tooltip is open or closed less than `skipDelay` ago → the next one opens at once. */
  get skipping(): boolean {
    return this.warm;
  }

  opened(t: TooltipController): void {
    if (this.current && this.current !== t) this.current.dismiss();
    this.current = t;
    clearTimeout(this.skipTimer);
    this.warm = true;
  }

  closed(t: TooltipController): void {
    if (this.current !== t) return;
    this.current = null;
    clearTimeout(this.skipTimer);
    this.skipTimer = setTimeout(() => {
      this.warm = false;
    }, this.skipDelay);
  }

  dispose(): void {
    clearTimeout(this.skipTimer);
  }
}

/**
 * One tooltip's open state. Opens `delay` ms after the pointer enters (or keyboard focus lands
 * on) the trigger, at once inside the group's skip window. Pressing the trigger closes it and
 * keeps it shut until the pointer leaves; so does an overlay opened from the trigger, which also
 * covers focus returning to the trigger when that overlay closes (FR-SHELL-31).
 */
export class TooltipController {
  open = false;
  private hovering = false;
  private latched = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly group: TooltipGroup,
    private readonly overlayOpen: () => boolean,
    private readonly onChange: (open: boolean) => void,
  ) {}

  /** Pointer moved over the trigger; only the first move after entering counts. */
  pointerMove(): void {
    if (this.hovering) return;
    this.hovering = true;
    this.request();
  }

  pointerLeave(): void {
    this.hovering = false;
    this.latched = false;
    this.close();
  }

  /** Pointer down, Enter or Space on the trigger. */
  press(): void {
    this.latched = true;
    this.close();
  }

  /** Focus on the trigger; only keyboard (`:focus-visible`) focus opens. */
  focus(visible: boolean): void {
    if (visible) this.request();
  }

  blur(): void {
    // Focus moving into the trigger's own overlay keeps the latch for its return.
    if (!this.overlayOpen()) this.latched = false;
    this.close();
  }

  /** The trigger's overlay opened or closed. */
  overlayChanged(): void {
    if (!this.overlayOpen()) return;
    this.latched = true;
    this.close();
  }

  /** Escape, scroll, another tooltip opening, unmount. */
  dismiss(): void {
    this.close();
  }

  private blocked(): boolean {
    return this.latched || this.overlayOpen();
  }

  private request(): void {
    if (this.open || this.timer !== undefined || this.blocked()) return;
    if (this.group.skipping) {
      this.show();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.blocked()) this.show();
    }, this.group.delay);
  }

  private show(): void {
    this.open = true;
    this.group.opened(this);
    this.onChange(true);
  }

  private close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.open) return;
    this.open = false;
    this.group.closed(this);
    this.onChange(false);
  }
}

const TooltipGroupContext = React.createContext<TooltipGroup | null>(null);
const fallbackGroup = new TooltipGroup();

/** One per client (FR-SHELL-30); both `main.tsx` pass the shared constants. */
export function TooltipProvider({
  delayDuration,
  skipDelayDuration,
  children,
}: {
  delayDuration: number;
  skipDelayDuration: number;
  children: React.ReactNode;
}) {
  const group = React.useMemo(
    () => new TooltipGroup(delayDuration, skipDelayDuration),
    [delayDuration, skipDelayDuration],
  );
  React.useEffect(() => () => group.dispose(), [group]);
  return (
    <T.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      disableHoverableContent
    >
      <TooltipGroupContext.Provider value={group}>{children}</TooltipGroupContext.Provider>
    </T.Provider>
  );
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** The shared hover hint (FR-SHELL-30). `children` must take a ref and DOM event props. */
export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  const group = React.useContext(TooltipGroupContext) ?? fallbackGroup;
  const [trigger, setTrigger] = React.useState<HTMLElement | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  triggerRef.current = trigger;
  /** What keyboard focus reaches the trigger through (itself, or the chip's menu button). */
  const hostRef = React.useRef<Element | null>(null);
  const [open, setOpen] = React.useState(false);
  const ctl = React.useMemo(
    () =>
      new TooltipController(
        group,
        () => overlayOpenOn(triggerRef.current) || overlayOpenOn(hostRef.current),
        setOpen,
      ),
    [group],
  );
  React.useEffect(() => () => ctl.dismiss(), [ctl]);
  // FR-SHELL-84: reachable by keyboard; focus on a host around the trigger opens it as well.
  React.useEffect(() => {
    if (!trigger) return;
    const { host, dispose } = enrollTrigger(trigger);
    hostRef.current = host;
    if (host === trigger) return dispose;
    const focus = () => ctl.focus(isFocusVisible(host));
    const blur = () => ctl.blur();
    const key = (e: Event) => {
      const k = (e as KeyboardEvent).key;
      if (k === "Enter" || k === " ") ctl.press();
    };
    host.addEventListener("focus", focus);
    host.addEventListener("blur", blur);
    host.addEventListener("keydown", key);
    return () => {
      host.removeEventListener("focus", focus);
      host.removeEventListener("blur", blur);
      host.removeEventListener("keydown", key);
      hostRef.current = null;
      dispose();
    };
  }, [trigger, ctl]);
  React.useEffect(() => {
    if (!trigger) return;
    const observer = new MutationObserver(() => ctl.overlayChanged());
    observer.observe(trigger, {
      attributes: true,
      attributeFilter: ["aria-expanded", OVERLAY_OPEN_ATTR],
    });
    return () => observer.disconnect();
  }, [trigger, ctl]);
  return (
    <T.Root
      open={open}
      onOpenChange={(o) => {
        // Radix's own open requests are ignored; the controller decides when to open.
        if (!o) ctl.dismiss();
      }}
    >
      <T.Trigger
        asChild
        ref={setTrigger}
        {...{ [TIP_ATTR]: "" }}
        onPointerMove={(e) => {
          if (e.pointerType !== "touch") ctl.pointerMove();
        }}
        onPointerLeave={() => ctl.pointerLeave()}
        onPointerDown={() => ctl.press()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") ctl.press();
        }}
        onFocus={(e) => ctl.focus(isFocusVisible(e.currentTarget))}
        onBlur={() => ctl.blur()}
      >
        {children}
      </T.Trigger>
      <TooltipContent>{content}</TooltipContent>
    </T.Root>
  );
}

/** The hint's bubble, inside `Tooltip`'s root (its own part so a theme can style it, ADR-0069). */
export function TooltipContent({ children }: { children: React.ReactNode }) {
  return (
    <T.Portal>
      <T.Content
        data-slot="tooltip-content"
        data-testid="ui-tooltip"
        sideOffset={4}
        className="z-50 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
      >
        {children}
      </T.Content>
    </T.Portal>
  );
}
