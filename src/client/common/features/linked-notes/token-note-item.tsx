// FR-NOTES-29 (N9): the token menu's **Open note** / **Create note** line, both clients (each
// client's token menu registry adds it). Opening a note from outside the Notes window: pick it in
// `notesUi`, then open the window. Small on purpose: the window's body and the editor stay in their
// lazy chunk (NOTES §12).
import { NOTE_TYPE, type NoteRecord } from "@shared/linked-notes/schemas";
import { NotebookPenIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { DropdownMenuItem } from "../../components/ui/menus";
import { useLazyRecords, useSync } from "../../sync/store";
import { useOpenWindow } from "../play-shell/ShellContext";
import { toastReject } from "../scenes-map/intents";
import { NOTES_WINDOW_KIND } from "./kind";
import { tokenNoteCreate, tokenNoteMatch, tokenNoteTitle } from "./token-note";
import { notesUi } from "./ui";

export const OPEN_NOTE_LABEL = "Open note";
export const CREATE_NOTE_LABEL = "Create note";
/** FR-NOTES-29: the DM's Create on a hidden token asks first with this. */
export const HIDDEN_TOKEN_NOTE_WARNING = "Players will see this note's title.";

/** The token fields the entry reads (DM and player token records both have them). */
export interface TokenNoteToken {
  id: string;
  name: string;
  characterId: string | null;
  hidden: boolean;
}

export interface TokenNote {
  title: string;
  /** The live note it opens; null = Create. */
  noteId: string | null;
  /** The notes list is loaded (until then the line waits). */
  ready: boolean;
}

/** The entry's state for a token, or null when its name leaves no valid title (no entry). */
export function useTokenNote(token: TokenNoteToken): TokenNote | null {
  const { rows, state } = useLazyRecords<NoteRecord>(NOTE_TYPE);
  const title = tokenNoteTitle(token.name);
  return useMemo(
    () =>
      title === null
        ? null
        : { title, noteId: tokenNoteMatch(title, rows), ready: state !== "loading" },
    [title, rows, state],
  );
}

/**
 * Opens the token's note in the Notes window, creating it first when missing. `ifMissing`: a
 * note someone created meanwhile (two people clicking at once) is the one that opens.
 */
export function useOpenTokenNote(): (token: TokenNoteToken, note: TokenNote) => Promise<void> {
  const connection = useSync((s) => s.connection);
  const openWindow = useOpenWindow();
  return useCallback(
    async (token, note) => {
      const show = (id: string) => {
        notesUi.getState().select(id);
        openWindow(NOTES_WINDOW_KIND);
      };
      if (note.noteId) {
        show(note.noteId);
        return;
      }
      try {
        const r = (await connection.sendIntent(
          "notes.create",
          tokenNoteCreate(token, note.title),
        )) as { noteId: string };
        show(r.noteId);
      } catch (err) {
        toastReject(err);
      }
    },
    [connection, openWindow],
  );
}

/** The menu line itself: `notes-token-note` + the token's `data-record-id`. */
export function TokenNoteMenuItem({
  token,
  note,
  onSelect,
}: {
  token: TokenNoteToken;
  note: TokenNote;
  onSelect(): void;
}) {
  return (
    <DropdownMenuItem
      data-testid="notes-token-note"
      data-record-id={token.id}
      data-state={note.noteId ? "open" : "create"}
      disabled={!note.ready}
      onSelect={onSelect}
    >
      <NotebookPenIcon /> {note.noteId ? OPEN_NOTE_LABEL : CREATE_NOTE_LABEL}
    </DropdownMenuItem>
  );
}

/** Registry `available`: the token's name leaves a valid title (registry tests pass partial tokens). */
export const hasTokenNote = (t: { name?: string }): boolean =>
  typeof t.name === "string" && tokenNoteTitle(t.name) !== null;
