// linked-notes' player token menu line (FR-NOTES-29): **Open note** / **Create note**. Players
// only get tokens they may see (FR-MAP-26), so no hidden-token warning here.
import {
  hasTokenNote,
  TokenNoteMenuItem,
  useOpenTokenNote,
  useTokenNote,
} from "@ui/features/linked-notes/token-note-item";
import type { PlayerTokenMenuEntry, PlayerTokenMenuItemProps } from "../scenes-map/token-menu";

function NoteItem({ token }: PlayerTokenMenuItemProps) {
  const note = useTokenNote(token);
  const open = useOpenTokenNote();
  if (!note) return null;
  return <TokenNoteMenuItem token={token} note={note} onSelect={() => void open(token, note)} />;
}

export const notesTokenMenu: readonly PlayerTokenMenuEntry[] = [
  { id: "notes.token-note", order: 10, available: hasTokenNote, Item: NoteItem },
];
