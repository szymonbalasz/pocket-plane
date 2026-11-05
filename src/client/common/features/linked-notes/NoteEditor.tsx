// The note editor (FR-NOTES-13 – -21, ADR-0078 client): a CodeMirror view driven by a
// `NoteSession` over the sync connection. Opens straight into editing; others' carets and
// selections with name tags; undo of this tab's own changes only (history + its keymap); the
// browser's spell check; re-opens after every snapshot; typing carries on offline.
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { Compartment, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  NOTES_CLOSED_SIGNAL,
  NOTES_CURSOR_SIGNAL,
  NOTES_HERE_SIGNAL,
  NOTES_UPDATES_SIGNAL,
  type NoteClosedSignal,
  type NoteCursorSignal,
  type NoteHereSignal,
  type NoteUpdatesSignal,
} from "@shared/linked-notes/collab";
import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react";
import { useSync } from "../../sync/store";
import { type DrawnCursor, remoteCursors, setCursors } from "./cursors";
import { CURSOR_TTL_MS, type NoteHost, NoteSession, type NoteTransport } from "./session";

/** What the pane around the editor reads and does. */
export interface EditorHandle {
  session: NoteSession | null;
  /** Scrolls to a cursor of this person (who-is-here chip click, FR-NOTES-16). */
  jumpTo(playerKey: string): void;
}

export interface NoteEditorProps {
  noteId: string;
  /** Person → caret colour and label (`You` for our own other tab). */
  person(c: { role: "dm" | "player"; playerId: string | null }): { color: string; label: string };
  onSession(): void;
}

const editable = new Compartment();

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "0.875rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.55", overflow: "auto" },
  ".cm-content": { padding: "10px 12px", caretColor: "var(--foreground)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
});

export const NoteEditor = forwardRef<EditorHandle, NoteEditorProps>(function NoteEditor(
  { noteId, person, onSession },
  ref,
) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const generation = useSync((s) => s.lazy.generation);
  const box = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sessionRef = useRef<NoteSession | null>(null);
  const personRef = useRef(person);
  personRef.current = person;
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [clientId] = useState(() => crypto.randomUUID());

  useImperativeHandle(ref, () => ({
    get session() {
      return sessionRef.current;
    },
    jumpTo(playerKey: string) {
      const s = sessionRef.current;
      const view = viewRef.current;
      if (!s || !view) return;
      for (const c of s.cursors.values()) {
        if ((c.playerId ?? "dm") !== playerKey) continue;
        const r = s.mapCursor(c)?.[0];
        if (!r) continue;
        view.dispatch({ effects: EditorView.scrollIntoView(r.head, { y: "center" }) });
        return;
      }
    },
  }));

  // One view + session per note (the pane keys this component by note).
  useEffect(() => {
    const parent = box.current;
    if (!parent) return;
    let queued = false;
    /** Session changes land outside CodeMirror updates: redraw cursors and editability after. */
    const flush = () => {
      queued = false;
      const s = sessionRef.current;
      const view = viewRef.current;
      if (!s || !view) return;
      const drawn: DrawnCursor[] = [];
      for (const c of s.cursors.values()) {
        const ranges = s.mapCursor(c);
        if (!ranges) continue;
        const p = personRef.current({ role: c.role, playerId: c.playerId });
        drawn.push({
          clientId: c.clientId,
          playerKey: c.playerId ?? "dm",
          label: p.label,
          color: p.color,
          ranges,
        });
      }
      const canEdit = s.editable;
      view.dispatch({
        effects: [setCursors.of(drawn), editable.reconfigure(EditorView.editable.of(canEdit))],
      });
      bump();
      onSessionRef.current();
    };
    const later = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    };
    const transport: NoteTransport = {
      live: () => connection.snapshot.state === "live",
      send: (name, payload) => connection.sendIntent(name, payload),
      signal: (name, data) => connection.sendSignal(name, data),
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number),
    };
    const extensions = [
      editable.of(EditorView.editable.of(false)),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true", "data-testid": "notes-editor-text" }),
      remoteCursors,
      theme,
      EditorView.updateListener.of((u) => {
        const s = sessionRef.current;
        if (!s) return;
        const local = u.transactions.some(
          (t) => t.docChanged && t.annotation(Transaction.remote) !== true,
        );
        if (local) s.edited();
        if (u.selectionSet || local) s.selectionChanged();
        if (u.docChanged) later();
      }),
    ];
    let view: EditorView | null = null;
    const host: NoteHost = {
      get state() {
        if (!view) throw new Error("editor not mounted");
        return view.state;
      },
      dispatch: (tr) => view?.dispatch(tr),
      setState: (state) => {
        view?.setState(state);
        later();
      },
    };
    const session = new NoteSession({
      noteId,
      clientId,
      transport,
      host,
      extensions,
      onChange: later,
    });
    view = new EditorView({ state: session.freshState("", 0), parent });
    viewRef.current = view;
    sessionRef.current = session;
    const offSignal = connection.onSignal((f) => {
      switch (f.name) {
        case NOTES_UPDATES_SIGNAL:
          return session.onUpdates(f.data as NoteUpdatesSignal);
        case NOTES_HERE_SIGNAL:
          return session.onHere(f.data as NoteHereSignal);
        case NOTES_CLOSED_SIGNAL:
          return session.onClosed(f.data as NoteClosedSignal);
        case NOTES_CURSOR_SIGNAL:
          return session.onCursor(f.data as NoteCursorSignal, f.from);
      }
    });
    const expiry = window.setInterval(() => {
      if (session.expireCursors()) later();
    }, CURSOR_TTL_MS / 5);
    void session.open();
    return () => {
      offSignal();
      window.clearInterval(expiry);
      session.close();
      view?.destroy();
      viewRef.current = null;
      sessionRef.current = null;
    };
  }, [connection, noteId, clientId]);

  // FR-NOTES-18: every snapshot (reconnect, resync, server restart) re-opens from our version.
  const seen = useRef(generation);
  useEffect(() => {
    if (!live) {
      sessionRef.current?.connectionChanged();
      return;
    }
    if (seen.current !== generation) {
      seen.current = generation;
      sessionRef.current?.resynced();
    } else sessionRef.current?.connectionChanged();
  }, [live, generation]);

  return <div ref={box} className="h-full min-h-0" data-testid="notes-editor" />;
});
