// FR-DICE-68 (sprint 7): the game log line's entry actions (`entry-actions.ts` registry), drawn by
// `GameLog.tsx` at the line end. A `confirm` action asks first ("Spend?" ✓ ✗, 4 s); a `roll`
// action is a `RollButton` (its own Tooltip: label + Alt hint, FR-DICEX-51), so physical-dice mode
// asks for the dice (FR-DICE-07) and the throw waits for the new entry (FR-DICEX-09).
import type { GameLogEntryView, ManualEntry } from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useSync } from "../../sync/store";
import { diceExtras } from "../dice-extras/store";
import { createActionConfirm } from "./entry-action-confirm";
import { actionsFor, type EntryAction } from "./entry-actions";
import { RollButton, type RollControl, useRollControl } from "./roll-control";

function errorText(err: unknown): string {
  if (err instanceof IntentRejected) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

const ACTION_BUTTON = "size-6 shrink-0";

/**
 * FR-DICE-68: one entry action. A `confirm` action asks first ("Spend?" ✓ ✗, 4 s); a `roll`
 * action's ✓ (or button) is a `RollButton`, so physical-dice mode asks for the dice (FR-DICE-07)
 * and the throw waits for the new entry (FR-DICEX-09). A reject → Toast.
 */
function EntryActionButton({
  action,
  entry,
  store,
  requested,
  onRequestDone,
}: {
  action: EntryAction;
  entry: GameLogEntryView;
  store: RecordStore;
  /** FR-DICE-105: the row menu asked for this action: act as a click on this Button would. */
  requested: boolean;
  onRequestDone: () => void;
}) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const [busy, setBusy] = useState(false);
  // The confirm closes after 4 s unless the physical form is open; a close that sent nothing
  // resets the roll control, so the next ✓ opens a fresh form (GM1 walkthrough f2).
  const controlRef = useRef<RollControl | null>(null);
  const [confirm] = useState(() => createActionConfirm(() => controlRef.current?.cancelManual()));
  const asking = useStore(confirm.api, (s) => s.asking);
  useEffect(() => () => confirm.cancel(), [confirm]);
  const roll = action.roll?.(entry) ?? null;
  const go = (manual?: ManualEntry) => {
    confirm.done();
    setBusy(true);
    action
      .run(entry, {
        store,
        send: (name, payload) => connection.sendIntent(name, payload),
        ...(manual ? { manual } : {}),
      })
      .catch((err: unknown) => {
        if (roll) diceExtras.failed();
        toast.error(errorText(err));
      })
      .finally(() => setBusy(false));
  };
  const control = useRollControl({
    expressions: [roll?.expression ?? "1d20"],
    category: roll?.category ?? entry.category,
    label: roll?.label ?? action.label,
    mode: roll?.mode ?? "normal",
    onRoll: (r) => go(r.manual?.[0]),
  });
  controlRef.current = control;
  const formOpen = control.manual !== null;
  useEffect(() => confirm.form(formOpen), [confirm, formOpen]);
  const disabled = !live || busy;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per request from the menu
  useEffect(() => {
    if (!requested) return;
    onRequestDone();
    if (disabled) return;
    if (action.confirm !== undefined) confirm.ask();
    else if (roll) control.roll({});
    else go();
  }, [requested]);
  const ids = { "data-value": action.id, "data-record-id": entry.id };
  const Icon = action.Icon;
  // A roll action keeps the line's mode: the control rolls without Shift / Ctrl (Alt stages it).
  if (asking) {
    const yes = {
      "data-testid": "dice-log-action-yes",
      ...ids,
      "aria-label": `${action.label}: yes`,
      size: "icon" as const,
      variant: "ghost" as const,
      className: ACTION_BUTTON,
      disabled,
    };
    return (
      <span
        data-testid="dice-log-action-confirm"
        {...ids}
        className="flex shrink-0 items-center gap-0.5 text-xs"
      >
        <span>{action.confirm}</span>
        {roll ? (
          <RollButton
            control={control}
            hint={yes["aria-label"]}
            type="button"
            {...yes}
            onClick={(e) => {
              e.preventDefault();
              control.roll({ altKey: e.altKey });
            }}
          >
            <CheckIcon className="size-3.5" />
          </RollButton>
        ) : (
          <Tip content={yes["aria-label"]} off={disabled}>
            <Button type="button" {...yes} onClick={() => go()}>
              <CheckIcon className="size-3.5" />
            </Button>
          </Tip>
        )}
        <Tip content={`${action.label}: no`}>
          <Button
            type="button"
            data-testid="dice-log-action-no"
            {...ids}
            aria-label={`${action.label}: no`}
            size="icon"
            variant="ghost"
            className={ACTION_BUTTON}
            onClick={() => confirm.cancel()}
          >
            <XIcon className="size-3.5" />
          </Button>
        </Tip>
      </span>
    );
  }
  const props = {
    "data-testid": "dice-log-action",
    ...ids,
    "aria-label": action.label,
    size: "icon" as const,
    variant: "ghost" as const,
    className: cn(ACTION_BUTTON, "text-muted-foreground"),
    disabled,
  };
  // A roll action without a confirm anchors its physical form on the button itself (its own
  // Tooltip: the label + the Alt hint, FR-DICEX-51).
  if (roll && action.confirm === undefined) {
    return (
      <RollButton
        control={control}
        hint={action.label}
        type="button"
        {...props}
        onClick={(e) => {
          e.preventDefault();
          control.roll({ altKey: e.altKey });
        }}
      >
        <Icon className="size-3.5" />
      </RollButton>
    );
  }
  return (
    <Tooltip content={action.label}>
      <Button
        type="button"
        {...props}
        onClick={() => (action.confirm !== undefined ? confirm.ask() : go())}
      >
        <Icon className="size-3.5" />
      </Button>
    </Tooltip>
  );
}

/**
 * FR-DICE-68: the line's available actions, shown on hover / keyboard focus of the line (always
 * on touch) and while one asks to confirm; none → nothing rendered (lines unchanged).
 */
export function EntryActions({
  e,
  actions,
  request = null,
  onRequestDone = () => {},
}: {
  e: GameLogEntryView;
  actions: readonly EntryAction[];
  /** FR-DICE-105: the action the row menu picked, once the menu closed. */
  request?: string | null;
  onRequestDone?: () => void;
}) {
  const store = useSync((s) => s.store);
  const shown = useMemo(() => actionsFor(actions, store, e), [actions, store, e]);
  if (shown.length === 0) return null;
  return (
    <span
      data-testid="dice-log-actions"
      className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/entry:opacity-100 has-[[data-testid=dice-log-action-confirm]]:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {shown.map((a) => (
        <EntryActionButton
          key={a.id}
          action={a}
          entry={e}
          store={store}
          requested={request === a.id}
          onRequestDone={onRequestDone}
        />
      ))}
    </span>
  );
}
