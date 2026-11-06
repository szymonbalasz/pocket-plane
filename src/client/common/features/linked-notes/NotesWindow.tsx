// The Notes window body (NOTES §7, FR-NOTES-01 – -06, -13 – -21, -25 – -28; slices N3, N8), one
// lazy chunk with the editor. Left: + New (title and category), the Recent toggle, the live notes
// in category fold-outs (or one Recent list) and the Recycle bin fold-out (newest first,
// Restore). Right: the open note: title, who-is-here chips, status, category, Rename, Delete,
// banners, the editor, the Linked from box. Narrow (< 520 px): the list becomes a dropdown. DM
// view = player view. The search box is ./NotesSearch.tsx (N4).

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABEL,
  NOTE_ROLL_LABEL,
  NOTE_TYPE,
  type NoteCategory,
  type NoteRecord,
  type RestoreNoteResult,
} from "@shared/linked-notes/schemas";
import { isNoteTitle, NOTE_TITLE_MAX } from "@shared/linked-notes/titles";
import { ChevronRightIcon, ClockIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input, Skeleton } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tip } from "../../components/ui/tip";
import { onlineDot } from "../../sync/presence";
import { useLazyRecords, usePresence, useSync } from "../../sync/store";
import { useColorOf } from "../campaign-management/colors";
import { toastIntentError } from "../combat-tracker/store";
import { notationRequest } from "../dice-extras/DiceText";
import { stageTray } from "../dice-extras/store";
import { usePhysicalDice } from "../dice-roll-log/physical";
import { relativeTime } from "../notifications/logic";
import { intentFailure } from "../party-board/logic";
import { type PickTitle, titlesByFold } from "./link-state";
import type { LinkHost } from "./link-view";
import {
  bannerText,
  binnedNotes,
  deletedParts,
  groupNotes,
  hereChips,
  liveNotes,
  nameOf,
  recentNotes,
  renamedAliases,
  STATUS_TEXT,
  withAliases,
} from "./logic";
import { type EditorHandle, NoteEditor } from "./NoteEditor";
import {
  NarrowNoteSearch,
  NoteSearchBox,
  NoteSearchResults,
  SearchingLine,
  showsResults,
  useNotesApi,
} from "./NotesSearch";
import {
  groupOpen,
  parseGroups,
  readGroupsRaw,
  useGroupsOpen,
  useNotesSort,
  writeGroupOpen,
} from "./prefs";
import { useNoteSearch } from "./search";
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

/**
 * New note / Rename: a title (FR-NOTES-02), refused inline on a clash or a cap. New also asks for
 * one of the eight categories, none picked first (FR-NOTES-25).
 */
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
  const [category, setCategory] = useState<NoteCategory | null>(null);
  /** r1: Enter in the title with no category picked says so. */
  const [askCategory, setAskCategory] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle(note?.title ?? "");
      setCategory(null);
      setAskCategory(false);
      intent.setError(null);
    }
  }, [open, note?.title, intent.setError]);
  const clean = title.trim();
  const valid = isNoteTitle(clean) && (note !== undefined || category !== null);
  const save = async () => {
    if (note) {
      if (await intent.send("notes.rename", { noteId: note.id, title: clean })) onOpenChange(false);
      return;
    }
    const r = await intent.send<{ noteId: string }>("notes.create", { title: clean, category });
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
            data-testid={note ? "notes-title-input" : "notes-new-title"}
            aria-label="Title"
            placeholder="Title"
            autoFocus
            value={title}
            maxLength={NOTE_TITLE_MAX + 20}
            onChange={(e) => {
              setTitle(e.target.value);
              intent.setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !note && category === null) {
                e.preventDefault();
                setAskCategory(true);
              }
            }}
          />
          {clean !== "" && !isNoteTitle(clean) && (
            <p className="text-xs text-muted-foreground">
              1–{NOTE_TITLE_MAX} characters, no [[, ]], | or line break
            </p>
          )}
          {/* r1: the kit's segmented control (its on / off looks in every theme): one Tab stop,
              the arrows move between the eight; none picked first. */}
          {!note && (
            <ToggleGroup
              type="single"
              aria-label="Category"
              className="grid w-full grid-cols-4"
              data-testid="notes-new-categories"
              value={category ?? ""}
              onValueChange={(v) => {
                if (v === "") return; // the picked one stays picked
                setCategory(v as NoteCategory);
                setAskCategory(false);
                intent.setError(null);
              }}
            >
              {NOTE_CATEGORIES.map((c) => (
                <ToggleGroupItem
                  key={c}
                  value={c}
                  className="rounded-none px-1"
                  data-testid="notes-category-pick"
                  data-category={c}
                >
                  {NOTE_CATEGORY_LABEL[c]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          {!note && askCategory && category === null && (
            <p role="alert" className="text-xs text-destructive" data-testid="notes-category-hint">
              Pick a category
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

function NoteRow({
  note,
  selected,
  now,
  showCategory,
}: {
  note: NoteRecord;
  selected: boolean;
  now: number;
  /** FR-NOTES-27: Recent rows name the category too. */
  showCategory?: boolean;
}) {
  const players = usePlayers();
  // r1: the open note's row comes into view (a regroup, a pick from the dropdown or a link).
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      data-testid="notes-list-item"
      data-record-id={note.id}
      data-category={note.category}
      aria-current={selected ? "true" : undefined}
      onClick={() => notesUi.getState().select(note.id)}
      className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent ${
        selected ? "bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--primary)]" : ""
      }`}
    >
      <span className="w-full truncate text-sm font-medium">{note.title}</span>
      <span className="text-xs text-muted-foreground">
        {showCategory && `${NOTE_CATEGORY_LABEL[note.category]} · `}
        {nameOf(note.updatedBy, players)} · {relativeTime(note.updatedAt, now)}
      </span>
    </button>
  );
}

/** r1: a count in lining figures (Gilt's label face draws old-style "1" as "ı"). */
function Count({ n }: { n: number }) {
  return (
    <span className="tabular-nums" data-slot="notes-count">
      ({n})
    </span>
  );
}

/**
 * FR-NOTES-26: one category's fold-out, like the Recycle bin's: its name and count; open as this
 * browser last left it (Session open at first).
 */
function CategoryGroup({
  category,
  notes,
  selected,
  now,
  open,
  onOpenChange,
}: {
  category: NoteCategory;
  notes: readonly NoteRecord[];
  selected: string | null;
  now: number;
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group h-7 w-full justify-start gap-1 px-1.5 font-semibold"
          data-testid="notes-group"
          data-category={category}
          data-count={notes.length}
        >
          <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          {NOTE_CATEGORY_LABEL[category]} <Count n={notes.length} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5 pl-2">
        {notes.map((n) => (
          <NoteRow key={n.id} note={n} selected={n.id === selected} now={now} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** FR-NOTES-04 – -06: the bin's rows, newest first: title, "Deleted by <name> · <when>", Restore. */
function BinRows({
  rows,
  now,
  onRestored,
}: {
  rows: NoteRecord[];
  now: number;
  onRestored?(): void;
}) {
  const players = usePlayers();
  const live = useLive();
  const intent = useIntent();
  return (
    <div className="flex flex-col gap-1">
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
            {/* Who deleted it is never cut: the time moves to a second line when the name and
                the time don't fit together (any theme's type), and never wraps itself. */}
            <div
              className="flex min-w-0 flex-wrap text-xs text-muted-foreground"
              data-testid="notes-bin-deleted"
            >
              <span className="break-words" data-testid="notes-bin-who">
                {deletedParts(n, players, now).who}
              </span>
              <span className="whitespace-nowrap">
                &nbsp;· {deletedParts(n, players, now).when}
              </span>
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
              if (r) {
                notesUi.getState().select(n.id);
                onRestored?.();
              }
            }}
          >
            Restore
          </Button>
        </div>
      ))}
      {intent.error && (
        <p role="alert" className="px-2 text-xs text-destructive" data-testid="notes-restore-error">
          {intent.error}
        </p>
      )}
    </div>
  );
}

/** The wide layout's fold-out at the list's foot (NOTES §7). */
function RecycleBin({ rows, now }: { rows: NoteRecord[]; now: number }) {
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
          Recycle bin <Count n={rows.length} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <BinRows rows={rows} now={now} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** r1: the narrow layout's way to the bin: a button beside the dropdown, the rows in a dialog. */
function NarrowBin({ rows, now }: { rows: NoteRecord[]; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* r2: a text label (not a bare trash can that reads as "delete"), last in the header,
          away from the note's Delete. */}
      <Button
        size="sm"
        variant="ghost"
        className="ml-1 h-8 shrink-0 gap-1 px-2 text-muted-foreground"
        data-testid="notes-bin-narrow"
        data-count={rows.length}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon className="size-3.5" />
        Recycle bin <Count n={rows.length} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="notes-bin-dialog">
          <DialogTitle>
            Recycle bin <Count n={rows.length} />
          </DialogTitle>
          <BinRows rows={rows} now={now} onRestored={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The open note: header, chips, status, banner, editor. Keyed by note (a fresh session each). */
/**
 * N5: what the editor's links, picker and die buttons call. Follow opens the note with that
 * folded title; a missing one is made with the category the chip asked for (FR-NOTES-10, -25:
 * `ifMissing`, so a note someone created meanwhile opens); a die click rolls labelled "Note" (FR-NOTES-23), or goes to the dice
 * tray on Alt+click or in physical-dice mode (FR-DICE-07, FR-DICEX-06).
 */
function useLinkHost(live: readonly NoteRecord[]): { host: LinkHost; titlesKey: string } {
  const connection = useSync((s) => s.connection);
  const [physical] = usePhysicalDice();
  const titles = useMemo(() => live.map((n) => ({ id: n.id, title: n.title })), [live]);
  // N6: a renamed note's record can land a moment before its links' rewrite: its old title keeps
  // resolving for a few seconds, so those chips stay solid.
  const aliases = useRef(new Map<string, { note: PickTitle; until: number }>());
  const previous = useRef(new Map<string, string>());
  const byFold = useMemo(() => {
    const now = Date.now();
    renamedAliases(previous.current, titles, now, aliases.current);
    previous.current = new Map(titles.map((t) => [t.id, t.title]));
    return withAliases(titlesByFold(titles), aliases.current, now);
  }, [titles]);
  const titlesKey = titles.map((t) => `${t.id}:${t.title}`).join("|");
  const create = async (title: string, category: NoteCategory): Promise<string | null> => {
    try {
      const r = (await connection.sendIntent("notes.create", {
        title,
        category,
        ifMissing: true,
      })) as { noteId: string };
      return r.noteId;
    } catch (err) {
      toast.error(intentFailure(err, LOST).message);
      return null;
    }
  };
  const host: LinkHost = {
    titles: () => titles,
    byFold: () => byFold,
    follow: (link) => {
      const hit = byFold.get(link.fold);
      if (hit) notesUi.getState().select(hit.id);
      return hit !== undefined;
    },
    create: async (title, category) => (await create(title, category)) !== null,
    createAndOpen: (title, category) => {
      void create(title, category).then((id) => {
        if (id) notesUi.getState().select(id);
      });
    },
    roll: (expression, e) => {
      const request = notationRequest(expression, { label: NOTE_ROLL_LABEL }, e, undefined);
      if (physical || e.altKey) {
        stageTray(request);
        return;
      }
      connection
        .sendIntent("dice.roll", {
          expression,
          mode: request.mode,
          category: "other",
          label: NOTE_ROLL_LABEL,
        })
        .catch(toastIntentError);
    },
  };
  return { host, titlesKey };
}

function NotePane({
  note,
  gone,
  live: liveRows,
}: {
  note: NoteRecord | null;
  gone: boolean;
  live: readonly NoteRecord[];
}) {
  const links = useLinkHost(liveRows);
  const selected = useStore(notesUi, (s) => s.selected) as string;
  const you = useSync((s) => s.store.you);
  const live = useLive();
  const waiting = useSync((s) => s.state === "waiting");
  const players = usePlayers();
  const colorOf = useColorOf();
  const presence = usePresence();
  // FR-NOTES-16: a player live-sync shows offline has no chip and no caret. Presence reaches the
  // DM only (FR-SYNC-23); a player's client relies on the server's `notes.here` pruning.
  const visible = (c: { role: "dm" | "player"; playerId: string | null }) =>
    me.role !== "dm" || c.role === "dm" || onlineDot(presence, c.playerId ?? "") !== "offline";
  const presenceKey = presence.known ? [...presence.online].sort().join(",") : "?";
  const editor = useRef<EditorHandle | null>(null);
  const [, setTick] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const restore = useIntent();
  const recategorize = useIntent();
  const me = { role: (you?.role ?? "player") as "dm" | "player", playerId: you?.playerId ?? null };
  const person = (c: { role: "dm" | "player"; playerId: string | null }) => {
    const mine = c.role === me.role && (c.role === "dm" || c.playerId === me.playerId);
    return {
      color: colorOf(c) ?? "var(--foreground)",
      label: mine ? "You" : nameOf(c, players),
    };
  };
  const session = editor.current?.session ?? null;
  const chips = hereChips(session?.here ?? [], me).filter((c) => c.you || visible(c));
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
          className={`text-xs ${session?.status === "full" ? "font-medium text-destructive" : "text-muted-foreground"}`}
          data-testid="notes-status"
          data-state={session?.status ?? "loading"}
          aria-live="polite"
        >
          {STATUS_TEXT[session?.status ?? "loading"]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-3 py-1">
        {/* FR-NOTES-25: anyone changes the category here; it reaches everyone (FR-NOTES-30). */}
        <Select
          value={note?.category ?? ""}
          disabled={!live || !note || note.deletedAt !== null || recategorize.busy}
          onValueChange={(v) => {
            if (note && v !== note.category)
              void recategorize.send("notes.setCategory", { noteId: note.id, category: v });
          }}
        >
          <SelectTrigger
            className="h-7 w-auto min-w-24 gap-1 text-xs"
            aria-label="Category"
            data-testid="notes-category"
            data-category={note?.category ?? ""}
          >
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {NOTE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} data-testid="notes-category-option" data-category={c}>
                {NOTE_CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        {recategorize.error && (
          <span
            role="alert"
            className="text-xs text-destructive"
            data-testid="notes-category-error"
          >
            {recategorize.error}
          </span>
        )}
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
      {/* r1: the editor keeps about three lines; the Linked from box gives way first. */}
      <div className="min-h-[4.75rem] flex-1" data-testid="notes-editor-box">
        <NoteEditor
          key={selected}
          ref={editor}
          noteId={selected}
          title={note?.title ?? ""}
          visible={visible}
          presenceKey={presenceKey}
          links={links.host}
          titlesKey={links.titlesKey}
          person={person}
          onSession={() => setTick((n) => n + 1)}
        />
      </div>
      {/* FR-NOTES-12, -28: the live notes linking here, refreshed live, in a titled box four rows
          tall (the same when empty), scrolling past that. r1: in a short window it shrinks to its
          title and one row (scrolling) before the editor gives up its last three lines. */}
      <section
        className="mx-3 mb-2 flex min-h-[3.25rem] shrink flex-col overflow-hidden rounded-md border"
        aria-label="Linked from"
        data-testid="notes-backlinks"
        data-count={session?.backlinks.length ?? 0}
      >
        {/* r1: the kit's section heading (`section-label`). */}
        <h4
          data-slot="section-label"
          className="m-0 flex shrink-0 items-center gap-1 border-b px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          data-testid="notes-backlinks-title"
        >
          Linked from <Count n={session?.backlinks.length ?? 0} />
        </h4>
        <ul
          className="m-0 h-24 min-h-6 shrink list-none overflow-y-auto p-0"
          data-testid="notes-backlinks-list"
        >
          {(session?.backlinks ?? []).length === 0 && (
            <li className="flex h-6 items-center px-2 text-xs text-muted-foreground">
              No links here yet
            </li>
          )}
          {(session?.backlinks ?? []).map((b) => (
            <li key={b.id} className="h-6">
              <button
                type="button"
                className="flex h-6 w-full items-center truncate px-2 text-left text-xs hover:bg-accent hover:underline"
                data-testid="notes-backlink"
                data-record-id={b.id}
                onClick={() => notesUi.getState().select(b.id)}
              >
                <span className="truncate">{b.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
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
  const [q, setQ] = useState("");
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
  const [sort, setSort] = useNotesSort();
  const [isOpen, setOpen] = useGroupsOpen();
  const groups = useMemo(() => groupNotes(rows), [rows]);
  const recent = useMemo(() => recentNotes(rows), [rows]);
  const recentOn = sort === "recent";
  const current_ = selected ? rows.find((n) => n.id === selected) : undefined;
  const openCategory = current_ && current_.deletedAt === null ? current_.category : null;
  // r1: the open note's fold-out opens (picked elsewhere, or its category changed), so its row
  // shows as selected; folding it again by hand afterwards is kept.
  useEffect(() => {
    if (sort !== "category" || openCategory === null || selected === null) return;
    if (!groupOpen(parseGroups(readGroupsRaw()), openCategory)) writeGroupOpen(openCategory, true);
  }, [sort, openCategory, selected]);
  const notesApi = useNotesApi();
  const search = useNoteSearch(notesApi, q, live_);
  const results = showsResults(q, search);
  const bin = useMemo(() => binnedNotes(rows), [rows]);
  const current = selected ? (rows.find((n) => n.id === selected) ?? null) : null;
  const loaded = state === "ready";

  const list = (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <NoteSearchBox q={q} onChange={setQ} />
        <Button
          size="sm"
          className="h-8 shrink-0"
          data-testid="notes-new"
          disabled={!live}
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="size-3.5" /> New
        </Button>
      </div>
      {/* FR-NOTES-27: category fold-outs, or one list last edited first; per browser. */}
      <div className="flex items-center" hidden={results}>
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 gap-1 px-2 text-xs ${recentOn ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
          aria-pressed={recentOn}
          data-testid="notes-sort"
          data-sort={sort}
          onClick={() => setSort(recentOn ? "category" : "recent")}
        >
          <ClockIcon className="size-3.5" /> Recent
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <SearchingLine q={q} search={search} />
        <div className="flex flex-col gap-0.5 py-1" hidden={results} data-testid="notes-list">
          {state === "loading" && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
          {loaded && live_.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground" data-testid="notes-empty">
              No notes yet
            </p>
          )}
          {recentOn
            ? recent.map((n) => (
                <NoteRow key={n.id} note={n} selected={n.id === selected} now={now} showCategory />
              ))
            : groups.map((g) => (
                <CategoryGroup
                  key={g.category}
                  category={g.category}
                  notes={g.notes}
                  selected={selected}
                  now={now}
                  open={isOpen(g.category)}
                  onOpenChange={(o) => setOpen(g.category, o)}
                />
              ))}
        </div>
        {results && (
          <div className="py-1">
            <NoteSearchResults search={search} onPick={(id) => notesUi.getState().select(id)} />
          </div>
        )}
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
            {/* The wide list's order: Recent, or every category's notes under its name. */}
            {recentOn
              ? recent.map((n) => (
                  <SelectItem
                    key={n.id}
                    value={n.id}
                    data-testid="notes-list-item"
                    data-record-id={n.id}
                    data-category={n.category}
                  >
                    {n.title}
                  </SelectItem>
                ))
              : groups.map((g) => (
                  <SelectGroup
                    key={g.category}
                    data-testid="notes-group-narrow"
                    data-category={g.category}
                  >
                    <SelectLabel>
                      {NOTE_CATEGORY_LABEL[g.category]} <Count n={g.notes.length} />
                    </SelectLabel>
                    {g.notes.map((n) => (
                      <SelectItem
                        key={n.id}
                        value={n.id}
                        data-testid="notes-list-item"
                        data-record-id={n.id}
                        data-category={n.category}
                      >
                        {n.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
          </SelectContent>
        </Select>
        <Tip content={recentOn ? "Group by category" : "Recent first"}>
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 shrink-0 px-2 ${recentOn ? "bg-accent text-accent-foreground" : ""}`}
            aria-label="Recent"
            aria-pressed={recentOn}
            data-testid="notes-sort-narrow"
            data-sort={sort}
            onClick={() => setSort(recentOn ? "category" : "recent")}
          >
            <ClockIcon className="size-3.5" />
          </Button>
        </Tip>
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
        <NarrowNoteSearch refresh={live_} />
        {loaded && <NarrowBin rows={bin} now={now} />}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r p-2 @[520px]/notes:flex">
          {list}
        </aside>
        {selected ? (
          <NotePane note={current} gone={loaded && current === null} live={live_} />
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
