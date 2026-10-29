// Row lists in edit mode (FR-CHARX-16): Add, delete, move (up / down as the drag handle's
// keyboard equivalent). Each edited field re-puts its whole row (`char.putRow` with `id`).
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import type { SheetRowList } from "@shared/events/character-sheet";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../components/ui/button";
import { Tip } from "../../components/ui/tip";
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

type Send = (row: Record<string, unknown>) => Promise<unknown>;

/**
 * One row's field edits: each re-puts the whole row with its change, built on the last put still
 * in flight, else on the row as rendered. Two quick edits (a damage type, then Magic) would
 * otherwise each carry the row from before the other's echo, and the second drops the first
 * (CI found it: e2e weapon-rows). `shape` normalises the merged row before it is sent.
 */
export function rowPutter(shape?: (next: Record<string, unknown>) => void) {
  const f: { n: number; row: Record<string, unknown> | null } = { n: 0, row: null };
  return (send: Send, rendered: object, patch: object): Promise<unknown> => {
    const next: Record<string, unknown> = { ...(f.n > 0 && f.row ? f.row : rendered), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    shape?.(next);
    f.n++;
    f.row = next;
    return send(next)
      .catch((err: unknown) => {
        // A refused row is no base for the next edit.
        if (f.row === next) f.row = null;
        throw err;
      })
      .finally(() => {
        if (--f.n === 0) f.row = null;
      });
  };
}

/** `rowPutter` for one rendered row of `list` (one per row editor). */
export function useRowPut<R extends object>(
  list: SheetRowList,
  row: R,
  shape?: (next: Record<string, unknown>) => void,
) {
  const rows = useRows(list);
  const putter = useRef<ReturnType<typeof rowPutter> | null>(null);
  putter.current ??= rowPutter(shape);
  const put = putter.current;
  return (patch: Partial<R>) => put(rows.put, row, patch);
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
      <Tip content="Move up" off={off || index === 0}>
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
      </Tip>
      <Tip content="Move down" off={off || index >= count - 1}>
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
      </Tip>
      <Tip content="Delete row" off={off}>
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
      </Tip>
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
