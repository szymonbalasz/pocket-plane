// Window type `note.history` (FR-NOTE-17, protocol §24): both clients, closed by default,
// bottom-right above the toast region, 360×480 (min 280×240), launcher bell + unread badge.
// Its companion keeps the toast runtime mounted while the window is closed; the toast stack
// lives in a per-page memory, so a remount of the shell keeps it.
import { BellIcon } from "lucide-react";
import { defineWindow, type WindowDef } from "../play-shell/registry";
import { HistoryBody } from "./HistoryWindow";
import { HISTORY_KIND } from "./logic";
import { createNoteClient, type NoteClient } from "./note-client";
import { ToastRuntime } from "./ToastRuntime";
import { createToastMemory, type ToastMemoryStore } from "./toasts";
import type { NotificationViews } from "./views";

export function notificationsWindow(
  views: NotificationViews,
  note: NoteClient = createNoteClient(),
  memory: ToastMemoryStore = createToastMemory(Date.now()),
): WindowDef {
  return defineWindow({
    kind: HISTORY_KIND,
    title: "Notifications",
    clients: ["dm", "player"],
    defaultSize: { w: 360, h: 480 },
    minSize: { w: 280, h: 240 },
    defaultPosition: { anchor: "bottom-right", dy: 64 },
    // FR-NOTE-31: opens at 480 (over other windows if it must) rather than a shrunk slot.
    minOpenH: 480,
    launcher: { icon: BellIcon, label: "Notifications", order: 80 },
    badge: (store) => note.unread(store),
    companion: () => <ToastRuntime views={views} note={note} memory={memory} />,
    component: () => <HistoryBody views={views} note={note} />,
  });
}
