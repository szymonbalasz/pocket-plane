// The note editor (FR-NOTES-13 – -21, ADR-0078 client): a CodeMirror view driven by a
// `NoteSession` over the sync connection. Opens straight into editing; others' carets and
// selections with name tags; undo of this tab's own changes only (history + its keymap); the
// browser's spell check; re-opens after every snapshot; typing carries on offline.
import { defaultKeymap, historyKeymap, redo } from "@codemirror/commands";
import { Compartment, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import {
  NOTES_BACKLINKS_SIGNAL,
  NOTES_CLOSED_SIGNAL,
  NOTES_CURSOR_SIGNAL,
  NOTES_HERE_SIGNAL,
  NOTES_UPDATES_SIGNAL,
  type NoteBacklinksSignal,
  type NoteClosedSignal,
  type NoteCursorSignal,
  type NoteHereSignal,
  type NoteUpdatesSignal,
} from "@shared/linked-notes/collab";
import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react";
import { useSync } from "../../sync/store";
import { type DrawnCursor, remoteCursors, setCursors } from "./cursors";
import { type LinkHost, noteLinks, refreshLinks } from "./link-view";
import { type NoteHost, NoteSession, type NoteTransport } from "./session";

/** How often the name tags' 2 s window is re-checked. */
const TAG_CHECK_MS = 250;

/** r1: redo on Ctrl+Shift+Z / Cmd+Shift+Z on every platform (FR-NOTES-17). */
export const REDO_KEYS = [{ key: "Mod-Shift-z", run: redo, preventDefault: true }];

/** An empty note's hint (N5 r1). */
export const NOTE_PLACEHOLDER = "Type @ to link a note · # heading · **bold** · - list";

/** What the pane around the editor reads and does. */
export interface EditorHandle {
  session: NoteSession | null;
  /** Scrolls to a cursor of this person (who-is-here chip click, FR-NOTES-16). */
  jumpTo(playerKey: string): void;
}

export interface NoteEditorProps {
  noteId: string;
  /** The note's title: the textbox's accessible name (r1). */
  title: string;
  /** False for a person live-sync shows offline: no caret (FR-NOTES-15, -16). */
  visible(c: { role: "dm" | "player"; playerId: string | null }): boolean;
  /** Changes when `visible` may answer differently (the online players). */
  presenceKey: string;
  /** N5: links, the picker and die buttons (read through a ref: always the latest). */
  links: LinkHost;
  /** Changes when the live titles change: chips re-resolve. */
  titlesKey: string;
  /** Person → caret colour and label (`You` for our own other tab). */
  person(c: { role: "dm" | "player"; playerId: string | null }): { color: string; label: string };
  onSession(): void;
}

const editable = new Compartment();
const named = new Compartment();
const nameAttr = (title: string) =>
  EditorView.contentAttributes.of({ "aria-label": title || "Note" });

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "0.875rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.55", overflow: "auto", minHeight: "0" },
  // Room above line 1 for a caret's name tag (16 px), so it is never cut (r1, every theme).
  ".cm-content": { padding: "20px 12px 10px", caretColor: "var(--foreground)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
});

export const NoteEditor = forwardRef<EditorHandle, NoteEditorProps>(function NoteEditor(
  { noteId, title, visible, presenceKey, links, titlesKey, person, onSession },
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
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const titleRef = useRef(title);
  titleRef.current = title;
  const redraw = useRef<(() => void) | null>(null);
  const linksRef = useRef(links);
  linksRef.current = links;
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
        if ((c.playerId ?? "dm") !== playerKey || !visibleRef.current(c)) continue;
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
    /** Which carets showed their tag at the last draw (redraw when one changes). */
    let tags = "";
    /** Session changes land outside CodeMirror updates: redraw cursors and editability after. */
    const flush = () => {
      queued = false;
      const s = sessionRef.current;
      const view = viewRef.current;
      if (!s || !view) return;
      const drawn: DrawnCursor[] = [];
      tags = "";
      for (const c of s.cursors.values()) {
        if (!visibleRef.current(c)) continue;
        const ranges = s.mapCursor(c);
        if (!ranges) continue;
        const tag = s.showTag(c);
        tags += `${c.clientId}:${tag};`;
        const p = personRef.current({ role: c.role, playerId: c.playerId });
        drawn.push({
          clientId: c.clientId,
          playerKey: c.playerId ?? "dm",
          label: p.label,
          color: p.color,
          tag,
          ranges,
        });
      }
      const canEdit = s.editable;
      view.dispatch({
        effects: [
          setCursors.of(drawn),
          editable.reconfigure(EditorView.editable.of(canEdit)),
          named.reconfigure(nameAttr(titleRef.current)),
        ],
      });
      bump();
      onSessionRef.current();
    };
    const later = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    };
    redraw.current = later;
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
      named.of(nameAttr(titleRef.current)),
      // r1: Ctrl+Shift+Z (Cmd+Shift+Z on a Mac) redoes everywhere, as Ctrl+Y does.
      keymap.of([...REDO_KEYS, ...historyKeymap, ...defaultKeymap]),
      EditorView.lineWrapping,
      // r1: linking is discoverable from an empty note.
      placeholder(NOTE_PLACEHOLDER),
      EditorView.contentAttributes.of({ spellcheck: "true", "data-testid": "notes-editor-text" }),
      remoteCursors,
      noteLinks({
        titles: () => linksRef.current.titles(),
        byFold: () => linksRef.current.byFold(),
        follow: (l) => linksRef.current.follow(l),
        create: (t, c) => linksRef.current.create(t, c),
        createAndOpen: (t, c) => linksRef.current.createAndOpen(t, c),
        roll: (x, e) => linksRef.current.roll(x, e),
      }),
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
        case NOTES_BACKLINKS_SIGNAL:
          return session.onBacklinks(f.data as NoteBacklinksSignal);
        case NOTES_CURSOR_SIGNAL:
          return session.onCursor(f.data as NoteCursorSignal, f.from);
      }
    });
    // r1: a name tag shows for 2 s after its person moves or types; redraw when one turns.
    const tagCheck = window.setInterval(() => {
      let now = "";
      for (const c of session.cursors.values())
        if (visibleRef.current(c) && session.mapCursor(c))
          now += `${c.clientId}:${session.showTag(c)};`;
      if (now !== tags) later();
    }, TAG_CHECK_MS);
    void session.open();
    return () => {
      offSignal();
      window.clearInterval(tagCheck);
      session.close();
      view?.destroy();
      viewRef.current = null;
      sessionRef.current = null;
      redraw.current = null;
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

  // A title change or a person going offline: redraw (name, carets).
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({ effects: named.reconfigure(nameAttr(title)) });
  }, [title]);
  useEffect(() => {
    if (presenceKey !== null) redraw.current?.();
  }, [presenceKey]);
  // N5: a note created, renamed, binned or restored: chips re-resolve (dotted ↔ solid).
  useEffect(() => {
    if (titlesKey !== null) viewRef.current?.dispatch({ effects: refreshLinks.of(null) });
  }, [titlesKey]);

  // r1: a framed editing area (the kit's input border) that scrolls inside itself.
  return (
    <div
      ref={box}
      className="h-full min-h-0 overflow-hidden rounded-md border border-input bg-transparent shadow-xs focus-within:ring-2 focus-within:ring-ring [&_.cm-editor]:h-full"
      data-testid="notes-editor"
    />
  );
});
