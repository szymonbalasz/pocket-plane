// Row lists in edit mode (FR-CHARX-16): Add, delete, move (up / down as the drag handle's
// keyboard equivalent). Each edited field re-puts its whole row (`char.putRow` with `id`).
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import type { SheetRowList } from "@shared/events/character-sheet";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { rowError } from "./edit-model";
import { useBusy } from "./fields";
import { useSheet, useSheetIntents } from "./sheet-context";

export function useRows(list: SheetRowList) {
  const ctx = useSheet();
  const intents = useSheetIntents();
  const creatureId = ctx.creature.id;
  return {
    /** Re-put a row with one change; the client mirror refuses invalid rows (nothing sent). */
    put(row: Record<string, unknown>): Promise<unknown> {
      const err = rowError(creatureId, list, row);
      if (err) return Promise.reject(new Error(err));
      return intents.send(CHARX_INTENTS.putRow, { creatureId, list, row });
    },
    remove: (rowId: string) => intents.send(CHARX_INTENTS.deleteRow, { creatureId, list, rowId }),
    move: (rowId: string, toIndex: number) =>
      intents.send(CHARX_INTENTS.moveRow, { creatureId, list, rowId, toIndex }),
  };
}

/** Delete + move controls of one row (edit mode). */
export function RowTools({
  list,
  rowId,
  index,
  count,
}: {
  list: SheetRowList;
  rowId: string | undefined;
  index: number;
  count: number;
}) {
  const rows = useRows(list);
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const off = !live || busy.busy || rowId === undefined;
  return (
    <span className="flex shrink-0 items-center">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        data-testid="charx-row-move"
        data-value={list}
        data-record-id={rowId}
        aria-label="Move up"
        disabled={off || index === 0}
        onClick={() => rowId && busy.run(() => rows.move(rowId, index - 1))}
      >
        <ChevronUpIcon className="size-3" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        data-testid="charx-row-move-down"
        data-value={list}
        data-record-id={rowId}
        aria-label="Move down"
        disabled={off || index >= count - 1}
        onClick={() => rowId && busy.run(() => rows.move(rowId, index + 1))}
      >
        <ChevronDownIcon className="size-3" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        data-testid="charx-row-delete"
        data-value={list}
        data-record-id={rowId}
        aria-label="Delete row"
        disabled={off}
        onClick={() => rowId && busy.run(() => rows.remove(rowId))}
      >
        <Trash2Icon className="size-3" />
      </Button>
    </span>
  );
}

/** "Add" for a list: puts a starter row (FR-CHARX-16: no id → create). */
export function AddRow({
  list,
  row,
  label,
  full,
}: {
  list: SheetRowList;
  row: Record<string, unknown>;
  label: string;
  full: boolean;
}) {
  const rows = useRows(list);
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-fit"
      data-testid="charx-row-add"
      data-value={list}
      disabled={!live || busy.busy || full}
      onClick={() => busy.run(() => rows.put(row))}
    >
      <PlusIcon className="size-3" />
      {label}
    </Button>
  );
}
