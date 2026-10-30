// FR-KIT-108: every search or filter field clears with one click. The × shows once there is text
// and hands the focus back to the field; its test ID is the field's plus `-clear`.
import { XIcon } from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import { cn } from "../../lib/utils";
import { Input } from "./primitives";
import { Tip } from "./tip";

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
