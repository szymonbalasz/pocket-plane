// FR-DICE-103–105: a log row's right-click menu, both clients (long-press on touch: Radix). What it
// lists is pure (`entryMenuItems`); the menu's parts render only while it is open, so the 100 rows
// of a log pay for nothing else. Registry actions never run here: `onAction` asks the row's own
// hover button (FR-DICE-105), which owns the confirm and the physical form.

import { COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { labelAfterActor } from "@shared/dice-roll-log/actor-label";
import { baseExpression } from "@shared/dice-roll-log/grammar";
import { formatEntry } from "@shared/dice-roll-log/line";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { copyText } from "@shared/dice-roll-log/row";
import {
  type GameLogEntryView,
  REVEAL_GUARDED,
  RollEntryPayload,
  SET_ENTRY_HIDDEN,
  seenByPlayers,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import {
  CopyIcon,
  DicesIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  type LucideIcon,
  ScrollTextIcon,
  UserIcon,
} from "lucide-react";
import { Fragment, useMemo } from "react";
import { toast } from "sonner";
import { ContextMenuItem, ContextMenuSeparator } from "../../components/ui/context-menu";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";
import { openSheetFor } from "../character-sheet/selection";
import { CHAR_SHEET_KIND } from "../character-sheet/window";
import { stageTray, type TrayRequest } from "../dice-extras/store";
import { useOpenWindow } from "../play-shell/ShellContext";
import { openRollDetails } from "./details";
import { actionsFor, type EntryAction } from "./entry-actions";
import { focusLogEntry } from "./focus";
import { type ActorCreature, actorCreature } from "./logic";

/**
 * FR-DICE-104: "Copy to dice tray": a `roll` line of exactly one roll, as the roll bar stages it:
 * the expression as asked (the stored one has adv / dis baked in, FR-DICE-04, and `mode` would
 * apply it twice), mode, category, the label as the line reads it (BL-162). Else null.
 */
export function trayRequestOf(e: GameLogEntryView): TrayRequest | null {
  if (e.kind !== ROLL_KIND) return null;
  const items = RollEntryPayload.safeParse(e.payload);
  const item = items.success && items.data.length === 1 ? items.data[0] : undefined;
  if (!item) return null;
  const label = item.label ? labelAfterActor(item.label, e.actorName) : "";
  return {
    kind: "free",
    expression: baseExpression(item.expression, item.mode),
    mode: item.mode,
    category: e.category,
    ...(label ? { label } : {}),
  };
}

export interface EntryMenuItem {
  /** `dice-log-menu-item` `data-value`: a fixed key, or a registry action's id. */
  value: string;
  label: string;
  Icon: LucideIcon;
  /** Its separated group: details and copy; hide; actions. */
  group: 0 | 1 | 2;
  disabled: boolean;
}

/**
 * FR-DICE-103: the menu of one line for one viewer, in order. `actions`: the registry's available
 * ones (`actionsFor`). `creature`: the DM's one match of the actor's name, else null. Anything that
 * sends waits for `live`; what copies or shows doesn't.
 */
export function entryMenuItems(o: {
  entry: GameLogEntryView;
  isDm: boolean;
  live: boolean;
  landed: boolean;
  actions: readonly Pick<EntryAction, "id" | "label" | "Icon">[];
  creature: ActorCreature | null;
}): EntryMenuItem[] {
  const { entry: e, isDm, live, landed } = o;
  const view = (value: string, label: string, Icon: LucideIcon): EntryMenuItem => ({
    value,
    label,
    Icon,
    group: 0,
    disabled: false,
  });
  const items = [view("details", "Roll details…", InfoIcon)];
  if (landed && trayRequestOf(e)) items.push(view("tray", "Copy to dice tray", DicesIcon));
  if (landed) items.push(view("copy", "Copy text", CopyIcon));
  if (isDm) {
    const seen = seenByPlayers(e);
    items.push({
      value: seen ? "hide" : "reveal",
      label: seen ? "Hide from players" : "Reveal to players",
      Icon: seen ? EyeOffIcon : EyeIcon,
      group: 1,
      disabled: !live,
    });
  }
  for (const a of o.actions) {
    items.push({ value: a.id, label: a.label, Icon: a.Icon, group: 2, disabled: !live });
  }
  if (e.supersededBy !== null && !e.undone) {
    items.push({ ...view("new-roll", "Show new roll", ScrollTextIcon), group: 2 });
  }
  if (isDm && o.creature) {
    const label = o.creature.kind === "character" ? "Open sheet" : "Open NPC sheet";
    items.push({ ...view("sheet", label, UserIcon), group: 2 });
  }
  return items;
}

/** FR-DICE-99: a guarded reveal's refusal goes to `onGuarded` (the dialog), any other to a toast. */
export function sendEntryHidden(
  connection: { sendIntent(name: string, payload: unknown): Promise<unknown> },
  entryId: string,
  hidden: boolean,
  onGuarded: (entryId: string) => void,
  confirmGuarded = false,
) {
  const payload = { entryId, hidden, ...(confirmGuarded ? { confirmGuarded: true } : {}) };
  return connection.sendIntent(SET_ENTRY_HIDDEN, payload).catch((err: unknown) => {
    if (
      err instanceof IntentRejected &&
      err.code === "conflict" &&
      err.message === REVEAL_GUARDED
    ) {
      onGuarded(entryId);
    } else {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  });
}

/** The row's full line to the clipboard (FR-KIT-46's text). */
function copyLine(e: GameLogEntryView) {
  const text = copyText(formatEntry(e).segments);
  (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"))).catch(() =>
    toast.error("Couldn't copy to the clipboard"),
  );
}

/** The open menu's items. */
export function EntryMenuItems({
  e,
  isDm,
  landed,
  actions,
  onAction,
  onGuarded,
}: {
  e: GameLogEntryView;
  isDm: boolean;
  landed: boolean;
  actions: readonly EntryAction[];
  /** FR-DICE-105: run this registry action through the row's own button, once the menu closed. */
  onAction: (actionId: string) => void;
  onGuarded: (entryId: string) => void;
}) {
  const live = useSync((s) => s.state === "live");
  const store = useSync((s) => s.store);
  const connection = useSync((s) => s.connection);
  const open = useOpenWindow();
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const combatants = useRecords<CombatantRecord>(COMBATANT_TYPE);
  const tokens = useRecords<TokenView>(TOKEN_TYPE);
  const creature = useMemo(
    () => (isDm ? actorCreature(e.actorName, { entities, combatants, tokens }) : null),
    [isDm, e.actorName, entities, combatants, tokens],
  );
  const shown = useMemo(() => actionsFor(actions, store, e), [actions, store, e]);
  const items = entryMenuItems({ entry: e, isDm, live, landed, actions: shown, creature });
  const run = (value: string) => {
    switch (value) {
      case "details":
        return openRollDetails(e.id);
      case "tray": {
        const request = trayRequestOf(e);
        return request ? stageTray(request) : undefined;
      }
      case "copy":
        return copyLine(e);
      case "hide":
      case "reveal":
        return void sendEntryHidden(connection, e.id, value === "hide", onGuarded);
      case "new-roll":
        return e.supersededBy ? focusLogEntry(e.supersededBy) : undefined;
      case "sheet":
        if (!creature) return;
        openSheetFor(creature.id, creature.kind);
        return open(CHAR_SHEET_KIND);
      default:
        return onAction(value);
    }
  };
  return items.map(({ value, label, Icon, group, disabled }, i) => (
    <Fragment key={value}>
      {i > 0 && items[i - 1]?.group !== group && <ContextMenuSeparator />}
      <ContextMenuItem
        data-testid="dice-log-menu-item"
        data-value={value}
        data-record-id={e.id}
        disabled={disabled}
        onSelect={() => run(value)}
      >
        <Icon />
        {label}
      </ContextMenuItem>
    </Fragment>
  ));
}
