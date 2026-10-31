// FR-KIT-108: every search or filter field clears with one click. The × shows once there is text
// and hands the focus back to the field; its test ID is the field's plus `-clear`. FR-KIT-109: Esc
// in the field does the same.
import { XIcon } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import { Input } from "./primitives";
import { Tip } from "./tip";

/**
 * FR-KIT-109: Esc in a field with text clears it and nothing else; with the field empty, Esc does
 * what it did (a second Esc closes the host Dialog). Window capture runs before the Dialog's or
 * Popover's own Esc listener on the document, and stops the field's `onKeyDown` seeing this Esc.
 */
export function useEscapeClears(
  field: React.RefObject<HTMLInputElement | null>,
  onClear: () => void,
) {
  const latest = useRef(onClear);
  latest.current = onClear;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = field.current;
      if (e.key !== "Escape" || e.isComposing || !el || e.target !== el || el.value === "") return;
      e.stopPropagation();
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [field]);
}

/** The × alone, for a field that isn't an `Input`; the parent is `relative`. */
export function ClearSearchButton({ testId, onClear }: { testId?: string; onClear(): void }) {
  return (
    <Tip content="Clear search">
      <button
        type="button"
        aria-label="Clear search"
        data-testid={testId}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent"
        onClick={onClear}
      >
        <XIcon className="size-4" />
      </button>
    </Tip>
  );
}

export function SearchInput({
  value,
  onClear,
  wrapperClassName,
  className,
  ref,
  ...props
}: Omit<React.ComponentProps<"input">, "value"> & {
  value: string;
  onClear(): void;
  /** Layout of the field in its row (the wrapper takes the Input's place). */
  wrapperClassName?: string;
}) {
  const own = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  useEscapeClears(own, onClear);
  const id = (props as { "data-testid"?: string })["data-testid"];
  return (
    <div className={cn("relative w-full min-w-0", wrapperClassName)}>
      <Input ref={setRef} value={value} className={cn("pr-8", className)} {...props} />
      {value !== "" && !props.disabled && (
        <ClearSearchButton
          testId={id && `${id}-clear`}
          onClear={() => {
            onClear();
            own.current?.focus();
          }}
        />
      )}
    </div>
  );
}
