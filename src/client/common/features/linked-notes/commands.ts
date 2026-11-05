// The Notes palette commands (NOTES §7): "Open Notes" and "New note" (the window's New note
// dialog). Both clients; no intent of their own (the dialog sends `notes.create`).
import type { PaletteCommand } from "../play-shell/palette/types";
import { NOTES_WINDOW_KIND } from "./kind";
import { notesUi } from "./ui";

export const NOTES_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "notes.open",
    title: "Open Notes",
    keywords: ["notes", "journal", "quest log"],
    group: "Commands",
    clients: ["dm", "player"],
    run: (ctx) => ctx.shell.openWindow(NOTES_WINDOW_KIND),
  },
  {
    id: "notes.new",
    title: "New note",
    keywords: ["note", "create", "write"],
    group: "Commands",
    clients: ["dm", "player"],
    when: (ctx) => ctx.live || "Offline",
    run: (ctx) => {
      ctx.shell.openWindow(NOTES_WINDOW_KIND);
      notesUi.getState().requestNew();
    },
  },
];
