// The Notes window body (NOTES §7, FR-NOTES-01 – -06, -13 – -21; slice N3), one lazy chunk with
// the editor. Left: + New, the live notes (last changed first) and the Recycle bin fold-out
// (newest first, Restore). Right: the open note: title, who-is-here chips, status, Rename,
// Delete, banners, the editor. Narrow (< 520 px): the list becomes a dropdown. DM view = player
// view. No search box (N4), no links (N5).

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { NOTE_TYPE, type NoteRecord, type RestoreNoteResult } from "@shared/linked-notes/schemas";
import { isNoteTitle, NOTE_TITLE_MAX } from "@shared/linked-notes/titles";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input, Skeleton } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tip } from "../../components/ui/tip";
import { useLazyRecords, useSync } from "../../sync/store";
import { useColorOf } from "../campaign-management/colors";
import { relativeTime } from "../notifications/logic";
import { intentFailure } from "../party-board/logic";
import { bannerText, binnedNotes, hereChips, liveNotes, nameOf, STATUS_TEXT } from "./logic";
import { type EditorHandle, NoteEditor } from "./NoteEditor";
import { notesUi } from "./ui";

const LOST = "Connection lost — check the note before trying again";

function useLive(): boolean {
  return useSync((s) => s.state === "live");
}

function usePlayers(): Record<string, PlayerRecord> {
  return (useSync((s) => s.store.records.player) ?? {}) as Record<string, PlayerRecord>;
}

/** One intent at a time per form; a reject shows inline, a lost one toasts. */
function useIntent() {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `{result}` on an ack (a void ack too), undefined after a failure (already shown). */
  const send = async <R,>(name: string, payload: unknown): Promise<{ result: R } | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      return { result: (await connection.sendIntent(name, payload)) as R };
    } catch (err) {
      const f = intentFailure(err, LOST);
      if (f.kind === "toast") toast.error(f.message);
      else setError(f.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}

/** New note / Rename: a title (FR-NOTES-02), refused inline on a clash or a cap. */
function TitleDialog({
  open,
  onOpenChange,
  note,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  /** Rename this note; absent → New note. */
  note?: NoteRecord;
}) {
  const live = useLive();
  const intent = useIntent();
  const [title, setTitle] = useState(note?.title ?? "");
  useEffect(() => {
    if (open) {
      setTitle(note?.title ?? "");
      intent.setError(null);
    }
  }, [open, note?.title, intent.setError]);
  const clean = title.trim();
  const valid = isNoteTitle(clean);
  const save = async () => {
    if (note) {
      if (await intent.send("notes.rename", { noteId: note.id, title: clean })) onOpenChange(false);
      return;
    }
    const r = await intent.send<{ noteId: string }>("notes.create", { title: clean });
    if (r) {
      notesUi.getState().select(r.result.noteId);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        data-testid={note ? "notes-rename-dialog" : "notes-new-dialog"}
      >
        <DialogTitle>{note ? "Rename note" : "New note"}</DialogTitle>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void save();
          }}
        >
          <Input
            data-testid="notes-title-input"
            aria-label="Title"
            placeholder="Title"
            autoFocus
            value={title}
            maxLength={NOTE_TITLE_MAX + 20}
            onChange={(e) => {
              setTitle(e.target.value);
              intent.setError(null);
            }}
          />
          {clean !== "" && !valid && (
            <p className="text-xs text-muted-foreground">
              1–{NOTE_TITLE_MAX} characters, no [[, ]], | or line break
            </p>
          )}
          {intent.error && (
            <p role="alert" className="text-xs text-destructive" data-testid="notes-title-error">
              {intent.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="notes-title-save"
              disabled={!live || intent.busy || !valid || clean === note?.title}
            >
              {note ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** FR-NOTES-04: Delete asks first; the note goes to the Recycle bin. */
function DeleteDialog({
  note,
  open,
  onOpenChange,
}: {
  note: NoteRecord;
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const live = useLive();
  const intent = useIntent();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid="notes-delete-dialog">
        <DialogTitle>Delete note</DialogTitle>
        <DialogDescription>
          “{note.title}” moves to the Recycle bin. Anyone can restore it from there.
        </DialogDescription>
        {intent.error && (
          <p role="alert" className="text-xs text-destructive" data-testid="notes-delete-error">
            {intent.error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="notes-delete-confirm"
            disabled={!live || intent.busy}
            onClick={async () => {
              if (await intent.send("notes.delete", { noteId: note.id })) {
                onOpenChange(false);
                if (notesUi.getState().selected === note.id) notesUi.getState().select(null);
              }
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteRow({ note, selected, now }: { note: NoteRecord; selected: boolean; now: number }) {
  const players = usePlayers();
  return (
    <button
      type="button"
      data-testid="notes-list-item"
      data-record-id={note.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => notesUi.getState().select(note.id)}
      className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent ${
        selected ? "bg-accent text-accent-foreground" : ""
      }`}
    >
      <span className="w-full truncate text-sm font-medium">{note.title}</span>
      <span className="text-xs text-muted-foreground">
        {nameOf(note.updatedBy, players)} · {relativeTime(note.updatedAt, now)}
      </span>
    </button>
  );
}

/** FR-NOTES-04 – -06: the Recycle bin fold-out, newest first: title, who deleted it, when, Restore. */
function RecycleBin({ rows, now }: { rows: NoteRecord[]; now: number }) {
  const players = usePlayers();
  const live = useLive();
  const intent = useIntent();
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group w-full justify-start gap-1 text-muted-foreground"
          data-testid="notes-bin"
          data-count={rows.length}
        >
          <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Recycle bin ({rows.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1 pt-1">
        {rows.length === 0 && <p className="px-2 text-xs text-muted-foreground">Empty</p>}
        {rows.map((n) => (
          <div
            key={n.id}
            className="flex items-center gap-2 rounded-md px-2 py-1"
            data-testid="notes-bin-item"
            data-record-id={n.id}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{n.title}</div>
              <div className="text-xs text-muted-foreground">
                {n.deletedBy ? nameOf(n.deletedBy, players) : ""} ·{" "}
                {relativeTime(n.deletedAt ?? "", now)}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0"
              data-testid="notes-restore"
              data-record-id={n.id}
              disabled={!live || intent.busy}
              onClick={async () => {
                const r = await intent.send<RestoreNoteResult>("notes.restore", { noteId: n.id });
                if (r) notesUi.getState().select(n.id);
              }}
            >
              Restore
            </Button>
          </div>
        ))}
        {intent.error && (
          <p
            role="alert"
            className="px-2 text-xs text-destructive"
            data-testid="notes-restore-error"
          >
            {intent.error}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The open note: header, chips, status, banner, editor. Keyed by note (a fresh session each). */
function NotePane({ note, gone }: { note: NoteRecord | null; gone: boolean }) {
  const selected = useStore(notesUi, (s) => s.selected) as string;
  const you = useSync((s) => s.store.you);
  const live = useLive();
  const waiting = useSync((s) => s.state === "waiting");
  const players = usePlayers();
  const colorOf = useColorOf();
  const editor = useRef<EditorHandle | null>(null);
  const [, setTick] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const restore = useIntent();
  const me = { role: (you?.role ?? "player") as "dm" | "player", playerId: you?.playerId ?? null };
  const person = (c: { role: "dm" | "player"; playerId: string | null }) => {
    const mine = c.role === me.role && (c.role === "dm" || c.playerId === me.playerId);
    return {
      color: colorOf(c) ?? "var(--foreground)",
      label: mine ? "You" : nameOf(c, players),
    };
  };
  const session = editor.current?.session ?? null;
  const chips = hereChips(session?.here ?? [], me);
  const sessionBanner = session?.banner ?? null;
  // A campaign switch (players wait, FR-SYNC-07) or a note this campaign doesn't have.
  const banner =
    sessionBanner ??
    (waiting || (gone && note === null) ? ({ kind: "gone", text: "" } as const) : null);
  const deleted =
    banner?.kind === "deleted" || (banner?.kind === "gone" && note?.deletedAt != null);
  const text = banner?.text ?? "";
  // FR-NOTES-05: restored (here or by someone else) while we show it binned → open it again.
  const binned = note?.deletedAt != null;
  useEffect(() => {
    const s = editor.current?.session;
    if (!binned && (s?.banner?.kind === "deleted" || s?.banner?.kind === "gone")) s.resynced();
  }, [binned]);
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="notes-pane"
      data-record-id={selected}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate font-semibold" data-testid="notes-title">
          {note?.title ?? ""}
        </h3>
        <fieldset className="m-0 flex items-center gap-1 border-0 p-0" aria-label="Who is here">
          {chips.map((c) => {
            const p = person(c);
            return (
              <button
                type="button"
                key={c.key}
                data-testid="notes-here"
                data-player-id={c.key}
                aria-label={c.you ? "You" : `Go to ${p.label}'s cursor`}
                onClick={() => editor.current?.jumpTo(c.key)}
                className="rounded-full border px-2 py-0.5 text-xs font-medium"
                style={{ borderColor: p.color, color: p.color }}
              >
                {p.label}
              </button>
            );
          })}
        </fieldset>
        <span
          className="text-xs text-muted-foreground"
          data-testid="notes-status"
          aria-live="polite"
        >
          {STATUS_TEXT[session?.status ?? "loading"]}
        </span>
      </div>
      <div className="flex items-center gap-1 px-3 py-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          data-testid="notes-rename"
          disabled={!live || !note || note.deletedAt !== null}
          onClick={() => setRenaming(true)}
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          data-testid="notes-delete"
          disabled={!live || !note || note.deletedAt !== null}
          onClick={() => setDeleting(true)}
        >
          Delete
        </Button>
      </div>
      {banner && (
        <div
          role="alert"
          data-testid="notes-banner"
          data-kind={deleted ? "deleted" : banner.kind}
          className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"
        >
          <span className="flex-1">{bannerText(deleted ? { kind: "deleted", text } : banner)}</span>
          {text !== "" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              data-testid="notes-copy-text"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(text)
                  .then(() => toast.success("Copied your text"))
                  .catch(() => toast.error("Couldn't copy"));
              }}
            >
              Copy my text
            </Button>
          )}
          {deleted && note && (
            <Button
              size="sm"
              className="h-7"
              data-testid="notes-restore"
              data-record-id={note.id}
              disabled={!live || restore.busy}
              onClick={async () => {
                if (await restore.send("notes.restore", { noteId: note.id }))
                  editor.current?.session?.resynced();
              }}
            >
              Restore
            </Button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <NoteEditor
          key={selected}
          ref={editor}
          noteId={selected}
          person={person}
          onSession={() => setTick((n) => n + 1)}
        />
      </div>
      {note && <TitleDialog open={renaming} onOpenChange={setRenaming} note={note} />}
      {note && <DeleteDialog note={note} open={deleting} onOpenChange={setDeleting} />}
    </div>
  );
}

export default function NotesWindow() {
  const { rows, state, retry } = useLazyRecords<NoteRecord>(NOTE_TYPE);
  const selected = useStore(notesUi, (s) => s.selected);
  const newRequest = useStore(notesUi, (s) => s.newRequest);
  const live = useLive();
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  // The palette's "New note" (NOTES §7).
  const seenRequest = useRef(newRequest);
  useEffect(() => {
    if (newRequest !== seenRequest.current) {
      seenRequest.current = newRequest;
      setCreating(true);
    }
  }, [newRequest]);
  const live_ = useMemo(() => liveNotes(rows), [rows]);
  const bin = useMemo(() => binnedNotes(rows), [rows]);
  const current = selected ? (rows.find((n) => n.id === selected) ?? null) : null;
  const loaded = state === "ready";

  const list = (
    <div className="flex min-h-0 flex-col gap-1">
      <Button
        size="sm"
        className="h-8"
        data-testid="notes-new"
        disabled={!live}
        onClick={() => setCreating(true)}
      >
        <PlusIcon className="size-3.5" /> New
      </Button>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 py-1">
          {state === "loading" && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
          {loaded && live_.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground" data-testid="notes-empty">
              No notes yet
            </p>
          )}
          {live_.map((n) => (
            <NoteRow key={n.id} note={n} selected={n.id === selected} now={now} />
          ))}
        </div>
      </ScrollArea>
      {loaded && <RecycleBin rows={bin} now={now} />}
    </div>
  );

  return (
    <div className="@container/notes flex h-full min-h-0 flex-col" data-testid="notes-window">
      {state === "error" && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm" role="alert">
          <span className="flex-1 text-destructive">Couldn't load the notes</span>
          <Button size="sm" variant="outline" onClick={retry} data-testid="notes-retry">
            Retry
          </Button>
        </div>
      )}
      {/* Narrow (< 520 px): the list is a dropdown above the note. */}
      <div className="flex items-center gap-1 border-b p-2 @[520px]/notes:hidden">
        <Select value={selected ?? ""} onValueChange={(v) => notesUi.getState().select(v)}>
          <SelectTrigger className="h-8 min-w-0 flex-1" data-testid="notes-picker-narrow">
            <SelectValue placeholder={live_.length === 0 ? "No notes yet" : "Pick a note"} />
          </SelectTrigger>
          <SelectContent>
            {live_.map((n) => (
              <SelectItem
                key={n.id}
                value={n.id}
                data-testid="notes-list-item"
                data-record-id={n.id}
              >
                {n.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip content="New note" off={!live}>
          <Button
            size="sm"
            className="h-8"
            aria-label="New note"
            disabled={!live}
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </Tip>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r p-2 @[520px]/notes:flex">
          {list}
        </aside>
        {selected ? (
          <NotePane note={current} gone={loaded && current === null} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            {loaded && live_.length === 0 ? "No notes yet" : "Pick a note, or make a new one"}
          </div>
        )}
      </div>
      <TitleDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
