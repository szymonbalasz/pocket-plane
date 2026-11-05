// `notes.main` "Notes" (NOTES §7, FR-NOTES-13), both clients: default 760 × 560; r1 ruling:
// it opens smaller when there's no room (useful 440 × 420, min 320 × 280); launcher "Notes". The body, CodeMirror included, is its
// own lazy chunk, loaded when the window first opens (NOTES §12): the entry bundles carry only
// this definition.
import { NotebookPenIcon } from "lucide-react";
import { createElement, Suspense } from "react";
import { lazyChunk } from "../../lib/lazy-chunk";
import { defineWindow } from "../play-shell/registry";
import { NOTES_WINDOW_KIND } from "./kind";
import { notesUi } from "./ui";

const NotesBody = lazyChunk(() => import("./NotesWindow"), "window");

function LazyNotesWindow() {
  return createElement(Suspense, { fallback: null }, createElement(NotesBody));
}

export const notesWindow = defineWindow({
  kind: NOTES_WINDOW_KIND,
  title: "Notes",
  clients: ["dm", "player"],
  defaultSize: { w: 760, h: 560 },
  // r1 ruling: may open smaller when there is no room (the contract minimum, FR-SHELL-61).
  minSize: { w: 320, h: 280 },
  // r1 ruling: opens narrower when there is no room (fits beside the Dice tray at 1280 × 720).
  usefulSize: { w: 440, h: 420 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  launcher: { icon: NotebookPenIcon, label: "Notes", order: 60 },
  // FR-SHELL-200: the next open starts on the list, no note picked.
  onClose: () => notesUi.getState().reset(),
  component: LazyNotesWindow,
});
