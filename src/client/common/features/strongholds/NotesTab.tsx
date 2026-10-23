// Notes tab (FR-HOLD-30): players read the notes as plain text (line breaks kept; the tab is
// hidden when they are DM-only or empty); the DM edits them: Textarea with a counter, "DM only"
// Switch, Save (same locks as FR-HOLD-26: disabled while unchanged, not `live` or in flight).
import { HOLD_INTENTS, HOLD_NOTES_MAX, type StrongholdRecord } from "@shared/strongholds/schemas";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import { Label } from "../../components/ui/primitives";
import { Textarea } from "../party-board/controls";
import { CHANGED_ELSEWHERE } from "./logic";
import type { HoldParts } from "./StrongholdWindow";
import { useHoldIntent, useLive } from "./send";

function DmNotes({ hold }: { hold: StrongholdRecord }) {
  const live = useLive();
  const intent = useHoldIntent();
  const uid = useId();
  const [base, setBase] = useState({ notes: hold.notes, notesDmOnly: hold.notesDmOnly });
  const [draft, setDraft] = useState(base);
  const dirty = draft.notes !== base.notes || draft.notesDmOnly !== base.notesDmOnly;
  const changed = hold.notes !== base.notes || hold.notesDmOnly !== base.notesDmOnly;
  // Follow other tabs' edits while nothing is typed here (FR-HOLD-34); keep a draft otherwise.
  useEffect(() => {
    if (!dirty) {
      const next = { notes: hold.notes, notesDmOnly: hold.notesDmOnly };
      setBase(next);
      setDraft(next);
    }
  }, [hold.notes, hold.notesDmOnly, dirty]);
  const save = async () => {
    const patch: Record<string, unknown> = { strongholdId: hold.id };
    if (draft.notes !== hold.notes) patch.notes = draft.notes;
    if (draft.notesDmOnly !== hold.notesDmOnly) patch.notesDmOnly = draft.notesDmOnly;
    if (Object.keys(patch).length === 1) {
      setBase(draft);
      return;
    }
    if (await intent.send(HOLD_INTENTS.update, patch)) setBase(draft);
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="hold-notes">
      <Textarea
        data-testid="hold-notes-edit"
        aria-label="Notes"
        rows={8}
        value={draft.notes}
        maxLength={HOLD_NOTES_MAX}
        onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Switch
          id={`${uid}-dm`}
          data-testid="hold-notes-dm-only"
          checked={draft.notesDmOnly}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, notesDmOnly: v }))}
        />
        <Label htmlFor={`${uid}-dm`} className="text-sm">
          DM only
        </Label>
        <span className="ml-auto text-xs text-muted-foreground">
          {draft.notes.length} / {HOLD_NOTES_MAX}
        </span>
        <Button
          size="sm"
          className="h-7"
          data-testid="hold-notes-save"
          disabled={!live || intent.busy || !dirty}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      {dirty && changed && <p className="text-xs text-muted-foreground">{CHANGED_ELSEWHERE}</p>}
      {intent.error && (
        <p role="alert" className="text-xs text-destructive" data-testid="hold-notes-error">
          {intent.error}
        </p>
      )}
    </div>
  );
}

export function NotesTab({ parts }: { parts: HoldParts }) {
  if (parts.dm) return <DmNotes hold={parts.hold as StrongholdRecord} />;
  return (
    <p data-testid="hold-notes" className="whitespace-pre-wrap break-words text-sm">
      {parts.hold.notes ?? ""}
    </p>
  );
}
