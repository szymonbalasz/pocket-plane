// linked-notes' DM token menu line (FR-NOTES-29, registry FR-MAP-29): **Open note** / **Create
// note**. On a hidden token Create asks first: players see every note's title (FR-NOTES-01).
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { tokenNoteAction } from "@ui/features/linked-notes/token-note";
import {
  CREATE_NOTE_LABEL,
  HIDDEN_TOKEN_NOTE_WARNING,
  hasTokenNote,
  TokenNoteMenuItem,
  useOpenTokenNote,
  useTokenNote,
} from "@ui/features/linked-notes/token-note-item";
import { useLive } from "@ui/features/scenes-map/intents";
import type {
  TokenMenuDialogProps,
  TokenMenuEntry,
  TokenMenuItemProps,
} from "../scenes-map/token-menu";

function NoteItem({ token, openDialog }: TokenMenuItemProps) {
  const note = useTokenNote(token);
  const open = useOpenTokenNote();
  if (!note) return null;
  return (
    <TokenNoteMenuItem
      token={token}
      note={note}
      onSelect={() => {
        if (tokenNoteAction(token, note.noteId) === "confirm") openDialog();
        else void open(token, note);
      }}
    />
  );
}

/** FR-NOTES-29: "Players will see this note's title", then Create note. */
function HiddenTokenNoteConfirm({ token, close }: TokenMenuDialogProps) {
  const note = useTokenNote(token);
  const open = useOpenTokenNote();
  const live = useLive();
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid="notes-token-note-dialog">
        <DialogTitle>{CREATE_NOTE_LABEL}</DialogTitle>
        <DialogDescription data-testid="notes-token-note-warning">
          {HIDDEN_TOKEN_NOTE_WARNING}
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" data-testid="notes-token-note-cancel" onClick={close}>
            Cancel
          </Button>
          <Button
            data-testid="notes-token-note-confirm"
            autoFocus
            disabled={!live || !note?.ready}
            onClick={() => {
              close();
              if (note) void open(token, note);
            }}
          >
            {CREATE_NOTE_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** After compendium's Stat block (5), before scenes-map's entries (10–60). */
export const notesTokenMenu: readonly TokenMenuEntry[] = [
  {
    id: "notes.token-note",
    order: 6,
    available: hasTokenNote,
    Item: NoteItem,
    Dialog: HiddenTokenNoteConfirm,
  },
];
