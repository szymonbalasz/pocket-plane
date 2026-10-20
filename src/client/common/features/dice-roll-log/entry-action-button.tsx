// FR-DICE-68 (sprint 7): the game log line's entry actions (`entry-actions.ts` registry), drawn by
// `GameLog.tsx` at the line end. A `confirm` action asks first ("Spend?" ✓ ✗, 4 s); a `roll`
// action is a `RollButton` (its own Tooltip: label + Alt hint, FR-DICEX-51), so physical-dice mode
// asks for the dice (FR-DICE-07) and the throw waits for the new entry (FR-DICEX-09).
import type { GameLogEntryView, ManualEntry } from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useSync } from "../../sync/store";
import { diceExtras } from "../dice-extras/store";
import { actionsFor, type EntryAction } from "./entry-actions";
import { RollButton, useRollControl } from "./roll-control";

function errorText(err: unknown): string {
  if (err instanceof IntentRejected) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

/** FR-DICE-68: how long an action's confirm ("Spend?" ✓ ✗) stays open. */
export const ACTION_CONFIRM_MS = 4000;

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
}: {
  action: EntryAction;
  entry: GameLogEntryView;
  store: RecordStore;
}) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), ACTION_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [asking]);
  const roll = action.roll?.(entry) ?? null;
  const go = (manual?: ManualEntry) => {
    setAsking(false);
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
  const disabled = !live || busy;
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
          <Button type="button" {...yes} onClick={() => go()}>
            <CheckIcon className="size-3.5" />
          </Button>
        )}
        <Button
          type="button"
          data-testid="dice-log-action-no"
          {...ids}
          aria-label={`${action.label}: no`}
          size="icon"
          variant="ghost"
          className={ACTION_BUTTON}
          onClick={() => setAsking(false)}
        >
          <XIcon className="size-3.5" />
        </Button>
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
        onClick={() => (action.confirm !== undefined ? setAsking(true) : go())}
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
}: {
  e: GameLogEntryView;
  actions: readonly EntryAction[];
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
        <EntryActionButton key={a.id} action={a} entry={e} store={store} />
      ))}
    </span>
  );
}
