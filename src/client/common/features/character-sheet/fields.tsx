// Edit-mode inputs (FR-CHARX-27/28/38): scalars commit on blur / Enter, long text on Save; the
// client mirror blocks invalid input (nothing sent); a remote change to the field being edited
// keeps the draft and shows "Changed by …"; a lost commit keeps the draft as "Not saved".
import type { OverrideKey } from "@shared/entities/schemas";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useReducer, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useSync } from "../../sync/store";
import { changedHint, fieldReducer, idleField, parseIntField } from "./edit-model";
import { intentErrorText } from "./routing";
import { toastIntentError, useSheet, useSheetIntents } from "./sheet-context";
import { overrideTooltip } from "./view-model";

export const SELECT =
  "h-7 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

type Parsed<T> = { value: T } | { error: string };

export interface FieldProps<T> {
  /** `charx-field` `data-value` (field path, e.g. `ac`, `attacks.<id>.name`). */
  path: string;
  label: string;
  value: T;
  format(v: T): string;
  parse(text: string): Parsed<T>;
  commit(v: T): Promise<unknown>;
  /** Long text: a textarea committed by its Save button. */
  multiline?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  /** A number input whose arrows nudge by `step` (FR-CHARX-50 senses: ±5). */
  step?: number;
}

const isLost = (err: unknown) => err instanceof IntentRejected && err.code === "disconnected";

/** One scalar / text field of the sheet in edit mode. */
export function SheetField<T>(p: FieldProps<T>) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const [s, dispatch] = useReducer(fieldReducer, idleField);
  const id = useId();
  // FR-CHARX-28: a committed change while editing → hint, draft kept.
  const committed = JSON.stringify(p.value ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `committed` is the value's identity.
  useEffect(() => dispatch({ type: "remote", committed: p.value }), [committed]);
  const shown = s.draft ?? p.format(p.value);

  const commit = () => {
    if (s.draft === null || s.inFlight) return;
    const parsed = p.parse(s.draft);
    if ("error" in parsed) return dispatch({ type: "invalid", message: parsed.error });
    if (JSON.stringify(parsed.value ?? null) === committed && !s.unsaved) {
      return dispatch({ type: "cancel" });
    }
    if (!live) return dispatch({ type: "commitFail", lost: true });
    dispatch({ type: "commitStart" });
    p.commit(parsed.value).then(
      () => dispatch({ type: "commitOk" }),
      (err) => {
        // FR-CHARX-38: a `set` is idempotent; keep the draft and re-commit once live.
        dispatch({ type: "commitFail", lost: isLost(err) });
        if (!isLost(err)) {
          toast.error(intentErrorText(err));
          dispatch({ type: "cancel" });
        }
      },
    );
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !p.multiline) commit();
    if (e.key === "Escape") dispatch({ type: "cancel" });
  };
  const common = {
    id,
    "data-testid": "charx-field",
    "data-value": p.path,
    "aria-label": p.label,
    "aria-invalid": s.error !== null,
    value: shown,
    placeholder: p.placeholder,
    ...(p.step ? { type: "number", step: p.step } : {}),
    disabled: !live || s.inFlight,
    onFocus: () => dispatch({ type: "focus", text: p.format(p.value), committed: p.value }),
    onChange: (e: { target: { value: string } }) =>
      dispatch({ type: "input", text: e.target.value }),
    onKeyDown: onKey,
  };
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", p.className)}>
      {p.multiline ? (
        <>
          <textarea
            {...common}
            rows={5}
            className={cn(
              "w-full rounded-md border border-input bg-background px-2 py-1 text-xs",
              p.inputClassName,
            )}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              data-testid="charx-field-save"
              data-value={p.path}
              disabled={!live || s.inFlight || s.draft === null}
              onClick={commit}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <Input {...common} className={cn("h-7 px-1.5 text-xs", p.inputClassName)} onBlur={commit} />
      )}
      {s.error && <span className="text-[10px] text-destructive">{s.error}</span>}
      {s.changed && (
        <span data-testid="charx-field-changed" className="text-[10px] text-muted-foreground">
          {changedHint(ctx.client, { npc: ctx.npc, ownerName: ctx.ownerName })}
        </span>
      )}
      {s.unsaved && (
        <span data-testid="charx-field-unsaved" className="text-[10px] text-destructive">
          Not saved
        </span>
      )}
    </div>
  );
}

/** Integer field; empty clears it when `optional`. */
export function IntField(
  p: Omit<FieldProps<number | null>, "format" | "parse"> & {
    min: number;
    max: number;
    optional?: boolean;
  },
) {
  return (
    <SheetField<number | null>
      {...p}
      inputClassName={cn("w-14 tabular-nums", p.inputClassName)}
      format={(v) => (v === null || v === undefined ? "" : String(v))}
      parse={(t) => {
        const n = parseIntField(t);
        if (n === null) return p.optional ? { value: null } : { error: "Required" };
        if (Number.isNaN(n)) return { error: "Whole number" };
        if (n < p.min || n > p.max) return { error: `${p.min}–${p.max}` };
        if (p.step && n % p.step !== 0) return { error: `Multiple of ${p.step}` };
        return { value: n };
      }}
    />
  );
}

/** Text field: trimmed, `max` chars; `required` refuses empty. */
export function TextField(
  p: Omit<FieldProps<string>, "format" | "parse"> & { max: number; required?: boolean },
) {
  return (
    <SheetField<string>
      {...p}
      format={(v) => v ?? ""}
      parse={(t) => {
        const v = p.multiline ? t : t.trim();
        if (p.required && v.trim() === "") return { error: "Required" };
        if ([...v].length > p.max) return { error: `At most ${p.max} characters` };
        return { value: v };
      }}
    />
  );
}

/** Commit-on-change select (enums). */
export function SelectField<T extends string>(p: {
  path: string;
  label: string;
  value: T | null;
  options: readonly { value: T | ""; label: string }[];
  commit(v: T | null): Promise<unknown>;
}) {
  const live = useSync((s) => s.state === "live");
  const [busy, setBusy] = useState(false);
  return (
    <select
      data-testid="charx-field"
      data-value={p.path}
      aria-label={p.label}
      className={SELECT}
      value={p.value ?? ""}
      disabled={!live || busy}
      onChange={(e) => {
        const v = (e.target.value || null) as T | null;
        setBusy(true);
        p.commit(v)
          .catch((err) => toast.error(intentErrorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      {p.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** One in-flight intent per control (FR-CHARX-27). */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run(p: () => Promise<unknown>) {
      if (busy) return;
      setBusy(true);
      p()
        .catch(toastIntentError)
        .finally(() => setBusy(false));
    },
  };
}

/**
 * Overridden marker + Tooltip "Derived +3 · Override: note" (CHARX §7); in edit mode also the
 * "Override" popover (value + note, Clear) on any derived number (FR-CHARX-06).
 */
export function OverrideControl({ okey, children }: { okey: OverrideKey; children: ReactNode }) {
  const ctx = useSheet();
  const tip = overrideTooltip(ctx.stats, okey);
  return (
    <span className="inline-flex items-center gap-0.5">
      {tip ? (
        <Tooltip content={tip}>
          <span
            data-testid="charx-overridden"
            data-value={okey}
            className="inline-flex items-center"
          >
            {children}
            <span className="ml-0.5 text-[9px] text-primary">*</span>
          </span>
        </Tooltip>
      ) : (
        children
      )}
      <OverrideEdit okey={okey} />
    </span>
  );
}

/**
 * A derived number inside a roll button: the marker only (no nested Tooltip or button); the
 * button's hint carries `overrideTooltip` and `OverrideEdit` sits next to the button.
 */
export function OverrideMark({ okey, children }: { okey: OverrideKey; children: ReactNode }) {
  const ctx = useSheet();
  if (!ctx.stats.overrides?.[okey]) return <>{children}</>;
  return (
    <span data-testid="charx-overridden" data-value={okey} className="inline-flex items-center">
      {children}
      <span className="ml-0.5 text-[9px] text-primary">*</span>
    </span>
  );
}

/** Edit mode: the "Override" popover (value + note, Clear) of one derived number. */
export function OverrideEdit({ okey }: { okey: OverrideKey }) {
  const ctx = useSheet();
  return ctx.editing && ctx.canEdit ? <OverridePopover okey={okey} /> : null;
}

function OverridePopover({ okey }: { okey: OverrideKey }) {
  const ctx = useSheet();
  const intents = useSheetIntents();
  const live = useSync((s) => s.state === "live");
  const cur = ctx.stats.overrides?.[okey];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useBusy();
  const save = (next: { value: number; note?: string } | null) => {
    const all = { ...(ctx.stats.overrides ?? {}) };
    if (next) all[okey] = next;
    else delete all[okey];
    busy.run(() =>
      intents
        .edit(ctx.creature.id, { overrides: Object.keys(all).length ? all : null })
        .then(() => setOpen(false)),
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValue(cur ? String(cur.value) : "");
          setNote(cur?.note ?? "");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="charx-override"
          data-value={okey}
          aria-label={`Override ${okey}`}
          disabled={!live}
          className="rounded px-0.5 text-[9px] text-muted-foreground hover:text-foreground"
        >
          ±
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-56 flex-col gap-2 p-2">
        <span className="text-xs font-medium">Override</span>
        <Input
          data-testid="charx-override-value"
          aria-label="Override value"
          className="h-7 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Input
          data-testid="charx-override-note"
          aria-label="Override note"
          placeholder="Note (e.g. item)"
          className="h-7 text-xs"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <span className="text-[10px] text-destructive">{error}</span>}
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            data-testid="charx-override-clear"
            disabled={!cur || busy.busy || !live}
            onClick={() => save(null)}
          >
            Clear
          </Button>
          <Button
            size="sm"
            data-testid="charx-override-save"
            disabled={busy.busy || !live}
            onClick={() => {
              const n = parseIntField(value);
              if (n === null || Number.isNaN(n) || n < -20 || n > 40) {
                return setError("Whole number −20…40");
              }
              if (note.trim().length > 60) return setError("Note: at most 60 characters");
              save(note.trim() ? { value: n, note: note.trim() } : { value: n });
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
