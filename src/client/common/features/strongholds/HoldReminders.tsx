// Reminders tab (FR-HOLD-29): the reminders linked to this stronghold that the viewer receives,
// grouped by facility ("Whole stronghold" first, then the DM's facility order), each showing its
// target (Party / character name), oldest first. Read-only rows here; REM's shared row / editor
// (FR-REM-25, RS1) and the DM's Add / Make reminder (`reminderPrefill`) join when RS1 merges.
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { EyeOffIcon } from "lucide-react";
import { useRecords } from "../../sync/store";
import { type LinkedReminder, reminderGroups } from "./logic";
import type { HoldParts } from "./StrongholdWindow";

export function HoldReminders({
  parts,
  reminders,
}: {
  parts: HoldParts;
  reminders: readonly LinkedReminder[];
}) {
  const entities = useRecords<{ id: string; name: string }>(ENTITY_TYPE);
  const nameOf = (id: string | null) =>
    id === null ? "Party" : (entities.find((e) => e.id === id)?.name ?? "A character");
  const groups = reminderGroups(parts.hold.id, parts.hold.facilities, reminders);
  return (
    <div className="flex flex-col gap-2" data-testid="hold-reminders">
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
          <ul className="flex flex-col gap-1">
            {g.rows.map((r) => (
              <li
                key={r.id}
                data-testid="hold-reminder"
                data-record-id={r.id}
                className="rounded-md border px-2 py-1 text-sm"
              >
                <div className="flex items-start gap-1.5">
                  {parts.dm && (r.dmOnly || r.linkHidden) && (
                    <EyeOffIcon
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      aria-label="DM only"
                    />
                  )}
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{r.text}</p>
                  <span
                    className="shrink-0 text-xs text-muted-foreground"
                    data-testid="hold-reminder-target"
                  >
                    {nameOf(r.characterId)}
                  </span>
                </div>
                {r.source && <p className="text-xs text-muted-foreground">{r.source}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
