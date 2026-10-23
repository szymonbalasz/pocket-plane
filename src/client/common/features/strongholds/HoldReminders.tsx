// Reminders tab (FR-HOLD-29): the reminders linked to this stronghold that the viewer receives,
// grouped by facility ("Whole stronghold" first, then the DM's facility order), each with its
// target (Party / character name) over REM's shared row (FR-REM-25: rolls, DM eye-off, Edit /
// Delete where FR-REM-08 allows). DM: **Add reminder** (REM's editor prefilled: link = this
// stronghold, source "‹Stronghold›"); a facility's **Make reminder** opens the same editor
// (`HoldReminderEditor`, prefill per `reminderPrefill`).
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { REMINDER_TYPE, type ReminderView } from "@shared/reminders/schemas";
import { PlusIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui/button";
import { useLazyRecords, useRecords } from "../../sync/store";
import {
  canEditReminder,
  draftOf,
  PARTY,
  type RemCharacter,
  type ReminderDraft,
  rollActor,
  targetCharacters,
} from "../reminders/logic";
import { ReminderEditor } from "../reminders/ReminderEditor";
import { ReminderRow } from "../reminders/ReminderRow";
import { useRemViewer } from "../reminders/RemindersTab";
import { type ReminderPrefill, reminderGroups, reminderPrefill } from "./logic";
import type { HoldParts } from "./StrongholdWindow";
import { useLive } from "./send";

/** REM's editor draft from HOLD's prefill (FR-HOLD-29): a party reminder, visible, no rolls. */
export function prefillDraft(p: ReminderPrefill): ReminderDraft {
  return {
    target: PARTY,
    text: p.text,
    source: p.source,
    rolls: [],
    dmOnly: false,
    strongholdId: p.strongholdId,
    facilityId: p.facilityId,
  };
}

/** REM's editor (FR-REM-19) for a draft opened from the Stronghold window. */
export function HoldReminderEditor({ draft, onDone }: { draft: ReminderDraft; onDone(): void }) {
  const viewer = useRemViewer();
  const loaded = useLazyRecords<ReminderView>(REMINDER_TYPE);
  const entities = useRecords<RemCharacter>(ENTITY_TYPE);
  const targets = useMemo(() => targetCharacters(entities, viewer), [entities, viewer]);
  return (
    <ReminderEditor
      draft={draft}
      row={draft.id ? loaded.rows.find((r) => r.id === draft.id) : undefined}
      ready={loaded.state === "ready"}
      viewer={viewer}
      targets={targets}
      onDone={onDone}
    />
  );
}

export function HoldReminders({
  parts,
  reminders,
  onEdit,
}: {
  parts: HoldParts;
  reminders: readonly ReminderView[];
  /** Opens REM's editor on a draft (Edit, or the DM's Add reminder). */
  onEdit(d: ReminderDraft): void;
}) {
  const live = useLive();
  const viewer = useRemViewer();
  const entities = useRecords<RemCharacter>(ENTITY_TYPE);
  const nameOf = (id: string | null) =>
    id === null ? "Party" : (entities.find((e) => e.id === id)?.name ?? "A character");
  const groups = reminderGroups(parts.hold.id, parts.hold.facilities, reminders);
  return (
    <div className="flex flex-col gap-2" data-testid="hold-reminders">
      {parts.dm && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 self-start"
          data-testid="hold-reminders-add"
          disabled={!live}
          onClick={() => onEdit(prefillDraft(reminderPrefill(parts.hold)))}
        >
          <PlusIcon className="size-3.5" /> Add reminder
        </Button>
      )}
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="hold-reminders-empty">
          No reminders linked yet
        </p>
      )}
      {groups.map((g) => (
        <section
          key={g.facilityId ?? "whole"}
          data-testid="hold-reminders-group"
          data-record-id={g.facilityId ?? ""}
          className="flex flex-col gap-1"
        >
          <h4 className="text-xs font-medium text-muted-foreground">{g.label}</h4>
          {g.rows.map((r) => (
            <div key={r.id} data-testid="hold-reminder" data-record-id={r.id} className="min-w-0">
              <span className="text-xs text-muted-foreground" data-testid="hold-reminder-target">
                {nameOf(r.characterId)}
              </span>
              <ul className="min-w-0">
                <ReminderRow
                  r={r}
                  viewer={viewer}
                  entities={entities}
                  actor={rollActor(r, { kind: "party" })}
                  canEdit={canEditReminder(r, viewer, entities)}
                  onEdit={(x) => onEdit(draftOf(x))}
                />
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
