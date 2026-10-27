// The reminder editor (FR-REM-19, -23): a Dialog with the target, text + counter, source, up to 4
// rolls (label, expression with a live check, category) and, for the DM, "DM only" and the
// stronghold / facility link. Save is disabled while invalid (FR-REM-02 mirrored), unchanged, not
// live or in flight; a reject shows inline with the values kept; a lost intent toasts. A row
// removed while open → "This reminder was removed"; changed elsewhere → a note, draft kept.
import { CATEGORY_LABEL, ROLL_CATEGORIES, type RollCategory } from "@shared/dice-roll-log/schemas";
import {
  REM_INTENTS,
  REMINDER_NOT_FOUND,
  REMINDER_ROLLS_MAX,
  REMINDER_SOURCE_MAX,
  REMINDER_TEXT_MAX,
  type ReminderView,
} from "@shared/reminders/schemas";
import {
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  type StrongholdIndexRecord,
  type StrongholdView,
} from "@shared/strongholds/schemas";
import { PlusIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { IntentRejected } from "../../sync/connection";
import { useLazyRecords, useRecords, useSync } from "../../sync/store";
import { Textarea } from "../party-board/controls";
import {
  draftError,
  draftOf,
  draftUnchanged,
  emptyRoll,
  expressionError,
  PARTY,
  type RemCharacter,
  type ReminderDraft,
  type RemViewer,
  saveInput,
} from "./logic";

/** FR-REM-19: a lost intent may or may not have committed. */
export const REM_LOST = "Connection lost — check the reminder before saving again";
export const CHANGED_ELSEWHERE = "Changed in another tab";

const NO_HOLD = "none";
const WHOLE = "whole";
const SELECT = "h-8 min-w-0 w-full";
/** K10 (K6 gap 8): a roll's Category Select, as small as the native select was. */
const SMALL_SELECT = "h-7 w-28 min-w-0 shrink-0 gap-1 px-1.5 py-0 text-xs [&>span]:truncate";

/** The DM's stronghold link: Stronghold Select, then Facility Select or "Whole stronghold". */
function LinkFields({
  d,
  set,
}: {
  d: ReminderDraft;
  set: (patch: Partial<ReminderDraft>) => void;
}) {
  const holds = useRecords<StrongholdIndexRecord>(STRONGHOLD_INDEX_TYPE);
  const ids = useMemo(() => (d.strongholdId ? [d.strongholdId] : []), [d.strongholdId]);
  const loaded = useLazyRecords<StrongholdView>(STRONGHOLD_TYPE, ids);
  const hold = loaded.rows.find((h) => h.id === d.strongholdId);
  const sorted = [...holds].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid grid-cols-2 gap-2">
      <Label className="flex min-w-0 flex-col gap-1 text-xs">
        Stronghold
        <Select
          value={d.strongholdId ?? NO_HOLD}
          onValueChange={(v) => set({ strongholdId: v === NO_HOLD ? null : v, facilityId: null })}
        >
          <SelectTrigger data-testid="rem-editor-hold" className={SELECT}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_HOLD}>None</SelectItem>
            {sorted.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      {d.strongholdId && (
        <Label className="flex min-w-0 flex-col gap-1 text-xs">
          Facility
          <Select
            value={d.facilityId ?? WHOLE}
            onValueChange={(v) => set({ facilityId: v === WHOLE ? null : v })}
          >
            <SelectTrigger data-testid="rem-editor-facility" className={SELECT}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE}>Whole stronghold</SelectItem>
              {(hold?.facilities ?? []).map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
              {/* A stored facility not loaded yet keeps its value selectable. */}
              {d.facilityId && !hold?.facilities.some((f) => f.id === d.facilityId) && (
                <SelectItem value={d.facilityId}>Facility</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Label>
      )}
    </div>
  );
}

export function ReminderEditor({
  draft: initial,
  row,
  ready,
  viewer,
  targets,
  onDone,
}: {
  draft: ReminderDraft;
  /** The stored row of an edit, as live now (undefined once removed). */
  row: ReminderView | undefined;
  /** `reminder` is loaded (false while a reload after a snapshot runs). */
  ready: boolean;
  viewer: RemViewer;
  /** The characters the viewer may target (FR-REM-08). */
  targets: readonly RemCharacter[];
  onDone: () => void;
}) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const set = (patch: Partial<ReminderDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setRejected(null);
  };
  // FR-REM-23 / REM §11: the row as it was when the editor opened; compared by content, so a
  // reload after a reconnect (new objects, same values) is no change. While a reload runs
  // (`ready` false) the row is unknown: neither removed nor changed.
  const base = useRef(row ? JSON.stringify(draftOf(row)) : null);
  const gone = ready && d.id !== undefined && row === undefined;
  const changed =
    ready &&
    row !== undefined &&
    base.current !== null &&
    JSON.stringify(draftOf(row)) !== base.current;
  const error = draftError(d, viewer);
  const unchanged = draftUnchanged(d, row, viewer);
  const off = !live || busy;
  const save = async () => {
    setBusy(true);
    try {
      await connection.sendIntent(REM_INTENTS.save, saveInput(d, viewer));
      onDone();
    } catch (err) {
      if (err instanceof IntentRejected && (err.code === "disconnected" || err.code === "offline"))
        toast.error(REM_LOST);
      else setRejected(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  const setRoll = (i: number, patch: Partial<ReminderDraft["rolls"][number]>) =>
    set({ rolls: d.rolls.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const shown = rejected ?? (gone ? null : changed ? CHANGED_ELSEWHERE : null);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onDone();
      }}
    >
      <DialogContent data-testid="rem-editor" data-record-id={d.id ?? ""} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit reminder" : "New reminder"}</DialogTitle>
          <DialogDescription>
            A note for the party or one character; no mechanics.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-w-0 flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!error && !off && !gone && !unchanged) void save();
          }}
        >
          <Label className="flex flex-col gap-1 text-xs">
            For
            <Select value={d.target} onValueChange={(v) => set({ target: v })}>
              <SelectTrigger data-testid="rem-editor-target" className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PARTY}>Party</SelectItem>
                {targets.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="flex flex-col gap-1 text-xs">
            <span className="flex justify-between">
              Text
              <span data-testid="rem-editor-counter" className="text-muted-foreground tabular-nums">
                {d.text.length} / {REMINDER_TEXT_MAX}
              </span>
            </span>
            <Textarea
              data-testid="rem-editor-text"
              className="min-h-20 text-sm"
              maxLength={REMINDER_TEXT_MAX}
              value={d.text}
              autoFocus
              onChange={(e) => set({ text: e.target.value })}
            />
          </Label>
          <Label className="flex flex-col gap-1 text-xs">
            Source
            <Input
              data-testid="rem-editor-source"
              className="h-8 text-sm"
              maxLength={REMINDER_SOURCE_MAX}
              placeholder="Greystone Keep: Steam Rooms"
              value={d.source}
              onChange={(e) => set({ source: e.target.value })}
            />
          </Label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">Rolls</span>
            {d.rolls.map((r, i) => {
              const bad = r.expression.trim() !== "" ? expressionError(r.expression) : null;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: draft rows have no id until saved
                  key={i}
                  className="flex min-w-0 flex-wrap items-center gap-1"
                >
                  <Input
                    data-testid="rem-editor-roll-label"
                    data-index={i}
                    aria-label="Roll label"
                    placeholder="Charm"
                    className="h-7 w-28 text-sm"
                    maxLength={40}
                    value={r.label}
                    onChange={(e) => setRoll(i, { label: e.target.value })}
                  />
                  <Input
                    data-testid="rem-editor-roll-expression"
                    data-index={i}
                    aria-label="Dice"
                    aria-invalid={bad !== null}
                    placeholder="1d4"
                    className="h-7 w-24 font-mono text-sm"
                    value={r.expression}
                    onChange={(e) => setRoll(i, { expression: e.target.value })}
                  />
                  <Select
                    value={r.category}
                    onValueChange={(v) => setRoll(i, { category: v as RollCategory })}
                  >
                    <SelectTrigger
                      data-testid="rem-editor-roll-category"
                      data-index={i}
                      data-value={r.category}
                      aria-label="Category"
                      className={SMALL_SELECT}
                    >
                      <SelectValue>{CATEGORY_LABEL[r.category]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLL_CATEGORIES.map((c) => (
                        <SelectItem
                          key={c}
                          value={c}
                          data-testid="rem-editor-roll-category-option"
                          data-value={c}
                        >
                          {CATEGORY_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    data-testid="rem-editor-roll-remove"
                    data-index={i}
                    aria-label="Remove roll"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => set({ rolls: d.rolls.filter((_, j) => j !== i) })}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                  {bad && <span className="w-full text-xs text-destructive">{bad}</span>}
                </div>
              );
            })}
            {d.rolls.length < REMINDER_ROLLS_MAX && (
              <Button
                type="button"
                data-testid="rem-editor-roll-add"
                size="sm"
                variant="outline"
                className="h-7 self-start"
                onClick={() => set({ rolls: [...d.rolls, emptyRoll()] })}
              >
                <PlusIcon className="size-3.5" /> Roll
              </Button>
            )}
          </div>
          {viewer.role === "dm" && (
            <>
              <Label className="flex items-center gap-2 text-xs">
                <Switch
                  data-testid="rem-editor-dm-only"
                  checked={d.dmOnly}
                  onCheckedChange={(v) => set({ dmOnly: v })}
                />
                DM only
              </Label>
              <LinkFields d={d} set={set} />
            </>
          )}
          {gone && (
            <p data-testid="rem-editor-gone" role="alert" className="text-xs text-destructive">
              {REMINDER_NOT_FOUND}
            </p>
          )}
          {shown && (
            <p data-testid="rem-editor-error" role="alert" className="text-xs text-destructive">
              {shown}
            </p>
          )}
          {!shown && !gone && error && d.text.trim() !== "" && (
            <p className="text-xs text-muted-foreground">{error}</p>
          )}
          <div className="flex items-center justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onDone}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="rem-editor-save"
              size="sm"
              className="h-8"
              disabled={off || gone || unchanged || error !== null}
            >
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
