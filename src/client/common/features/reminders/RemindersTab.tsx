// The Reminders list (FR-REM-17–26), shared by the Party Manager's Reminders tab (FR-PARTY-73),
// the sheet's Reminders tab (FR-CHARX-101, `characterId`) and the Stronghold window's Reminders
// tab (HOLD, `strongholdId` filters by link). Loads `reminder` lazily on mount (FR-REM-14):
// skeleton, Retry; reloads after a snapshot. Groups: Party, then characters (Party Manager: each
// with CBTX's read-only effects line, FR-REM-22); on a sheet: that character, then Party.
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { REMINDER_TYPE, type ReminderView } from "@shared/reminders/schemas";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useLazyRecords, useRecords, useSync } from "../../sync/store";
import { useColorOf } from "../campaign-management/colors";
import { EffectsLine } from "../combat-extras/sheet-sections";
import {
  canEditReminder,
  draftOf,
  PARTY,
  type RemCharacter,
  type ReminderDraft,
  type ReminderGroup,
  type RemSurface,
  type RemViewer,
  reminderGroups,
  rollActor,
  targetCharacters,
} from "./logic";
import { ReminderEditor } from "./ReminderEditor";
import { ReminderRow } from "./ReminderRow";

export const EMPTY_PARTY = "No party reminders yet";
export const LOAD_ERROR = "Couldn't load reminders";

/** The viewer and the characters from the store. */
export function useRemViewer(): RemViewer {
  const you = useSync((s) => s.store.you);
  return useMemo(
    () => ({ role: you?.role === "dm" ? "dm" : "player", playerId: you?.playerId ?? null }),
    [you],
  );
}

function GroupHeader({ g, count }: { g: ReminderGroup; count: number }) {
  const colorOf = useColorOf();
  const color =
    g.characterId !== null ? colorOf({ role: "player", playerId: g.ownerPlayerId }) : null;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {g.characterId !== null && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={color ? { backgroundColor: color } : undefined}
          aria-hidden
        />
      )}
      <span className="min-w-0 text-sm font-medium break-words">{g.title}</span>
      <span data-testid="rem-group-count" className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </span>
  );
}

export function RemindersTab({
  characterId,
  strongholdId,
  onOpenLink,
  className,
}: {
  /** A sheet's character (FR-CHARX-101): its rows, then Party; rolls as it. */
  characterId?: string;
  /** HOLD: only rows linked to this stronghold. */
  strongholdId?: string;
  onOpenLink?: (strongholdId: string) => void;
  className?: string;
}) {
  const viewer = useRemViewer();
  const live = useSync((s) => s.state === "live");
  const loaded = useLazyRecords<ReminderView>(REMINDER_TYPE);
  const entities = useRecords<RemCharacter>(ENTITY_TYPE);
  const [editing, setEditing] = useState<ReminderDraft | null>(null);
  const surface: RemSurface = useMemo(
    () => (characterId ? { kind: "sheet", characterId } : { kind: "party" }),
    [characterId],
  );
  const rows = useMemo(
    () =>
      strongholdId === undefined
        ? loaded.rows
        : loaded.rows.filter((r) => r.strongholdId === strongholdId),
    [loaded.rows, strongholdId],
  );
  const groups = useMemo(
    () => reminderGroups(rows, viewer, entities, surface),
    [rows, viewer, entities, surface],
  );
  const targets = useMemo(() => targetCharacters(entities, viewer), [entities, viewer]);
  const editRow = editing?.id ? loaded.rows.find((r) => r.id === editing.id) : undefined;
  return (
    <div
      data-testid="rem-tab"
      data-state={loaded.state}
      className={cn("flex min-w-0 flex-col gap-3 p-1", className)}
      aria-busy={loaded.state === "loading"}
    >
      {loaded.state === "error" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{LOAD_ERROR}</p>
          <Button
            type="button"
            data-testid="rem-retry"
            size="sm"
            variant="outline"
            className="h-7 self-start"
            onClick={loaded.retry}
          >
            Retry
          </Button>
        </div>
      )}
      {loaded.state === "loading" && (
        <div data-testid="rem-loading" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {loaded.state === "ready" &&
        groups.map((g) => (
          <section
            key={g.key}
            data-testid="rem-group"
            data-record-id={g.key}
            className="flex min-w-0 flex-col gap-1"
          >
            <div className="flex min-w-0 items-center gap-1">
              <GroupHeader g={g} count={g.rows.length} />
              {g.canAdd && (
                <Button
                  type="button"
                  data-testid="rem-group-add"
                  data-record-id={g.key}
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2"
                  disabled={!live}
                  onClick={() => setEditing(draftOf(null, g.key))}
                >
                  <PlusIcon className="size-3.5" /> Add
                </Button>
              )}
            </div>
            {surface.kind === "party" && g.characterId !== null && (
              <EffectsLine characterId={g.characterId} testId="rem-effects" />
            )}
            {g.key === PARTY && g.rows.length === 0 && (
              <p data-testid="rem-empty" className="text-xs text-muted-foreground">
                {EMPTY_PARTY}
              </p>
            )}
            {g.rows.length > 0 && (
              <ul className="flex min-w-0 flex-col gap-1">
                {g.rows.map((r) => (
                  <ReminderRow
                    key={r.id}
                    r={r}
                    viewer={viewer}
                    entities={entities}
                    actor={rollActor(r, surface)}
                    canEdit={canEditReminder(r, viewer, entities)}
                    onEdit={(x) => setEditing(draftOf(x))}
                    onOpenLink={onOpenLink}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      {/* Outside the states: a draft survives a reload after a reconnect (PARTY §11). */}
      {editing && (
        <ReminderEditor
          key={editing.id ?? `new:${editing.target}`}
          draft={editing}
          row={editRow}
          ready={loaded.state === "ready"}
          viewer={viewer}
          targets={targets}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  );
}
