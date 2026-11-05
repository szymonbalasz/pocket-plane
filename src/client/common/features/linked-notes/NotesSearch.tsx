// The Notes window's search (NOTES §7, FR-NOTES-22; slice N4): a box above the list, results with
// the title and a short snippet (links as their chips read, the matching words marked) in the
// list's place once the first answer is in, a click opens the note. While typing, the last
// results (or the list) stay until new ones arrive; results on screen follow others' edits.
// Narrow (< 520 px): a "Search" button beside the dropdown opens the box and results in a
// dialog, like the Recycle bin. DM view = player view.
import type { NoteSearchHit } from "@shared/linked-notes/search";
import { SearchIcon, XIcon } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Api } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { pageApi } from "../../session";
import { useSync } from "../../sync/store";
import { isSearch, type NoteSearch, useNoteSearch } from "./search";
import { notesUi } from "./ui";

/** This page's REST client (DM secret or player link). */
export function useNotesApi(): Api {
  const role = useSync((s) => s.store.you?.role) === "dm" ? "dm" : "player";
  return useMemo(() => pageApi(role), [role]);
}

/**
 * The search input: a plain text box (no browser clear button) with the kit's ×; Escape clears.
 */
export function NoteSearchBox({
  q,
  onChange,
  testId = "notes-search",
  autoFocus,
}: {
  q: string;
  onChange(q: string): void;
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        role="searchbox"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        data-testid={testId}
        aria-label="Search notes"
        placeholder="Search notes…"
        className={`h-8 pl-7 ${q === "" ? "pr-2" : "pr-7"}`}
        value={q}
        autoFocus={autoFocus}
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q !== "") {
            e.stopPropagation();
            onChange("");
          }
        }}
      />
      {q !== "" && (
        <Tip content="Clear search">
          <button
            type="button"
            aria-label="Clear search"
            data-testid="notes-search-clear"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onChange("")}
          >
            <XIcon className="size-3.5" />
          </button>
        </Tip>
      )}
    </div>
  );
}

/** The snippet with its marked words. */
function Snippet({ hit }: { hit: NoteSearchHit }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of hit.marks) {
    if (a < at || b > hit.snippet.length) continue;
    parts.push(hit.snippet.slice(at, a));
    parts.push(
      <mark
        key={a}
        data-testid="notes-search-mark"
        className="rounded-sm bg-primary/25 px-px text-foreground"
      >
        {hit.snippet.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  parts.push(hit.snippet.slice(at));
  return (
    <span
      className="line-clamp-2 w-full text-xs break-words text-muted-foreground"
      data-testid="notes-search-snippet"
    >
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed pieces of one string, never reordered.
        <Fragment key={i}>{p}</Fragment>
      ))}
    </span>
  );
}

function ResultRow({
  hit,
  selected,
  onPick,
}: {
  hit: NoteSearchHit;
  selected: boolean;
  onPick(id: string): void;
}) {
  return (
    <button
      type="button"
      data-testid="notes-search-result"
      data-record-id={hit.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onPick(hit.id)}
      className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent ${
        selected ? "bg-accent text-accent-foreground" : ""
      }`}
    >
      <span className="w-full truncate text-sm font-medium">{hit.title}</span>
      {hit.snippet !== "" && <Snippet hit={hit} />}
    </button>
  );
}

/** Results are shown (in the list's place) once there is an answer, or an error, for a query. */
export const showsResults = (q: string, search: NoteSearch): boolean =>
  isSearch(q) && (search.page !== null || search.state === "error");

/** "Searching…" while the first answer for a query is on its way (the list stays meanwhile). */
export function SearchingLine({ q, search }: { q: string; search: NoteSearch }) {
  if (!isSearch(q) || showsResults(q, search)) return null;
  return (
    <p className="px-2 py-1 text-xs text-muted-foreground" data-testid="notes-search-pending">
      Searching…
    </p>
  );
}

/** The results of `search`, best first; a pick opens the note. */
export function NoteSearchResults({
  search,
  onPick,
}: {
  search: NoteSearch & { retry(): void };
  onPick(id: string): void;
}) {
  const selected = useStore(notesUi, (s) => s.selected);
  const page = search.page;
  return (
    <div
      className="flex flex-col gap-0.5"
      data-testid="notes-search-results"
      data-state={search.state}
      aria-live="polite"
      aria-busy={search.state === "loading"}
    >
      {search.state === "error" && (
        <div className="flex items-center gap-2 px-2 py-1 text-sm" role="alert">
          <span className="flex-1 text-destructive">Search failed</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            data-testid="notes-search-retry"
            onClick={search.retry}
          >
            Retry
          </Button>
        </div>
      )}
      {page && page.results.length === 0 && (
        <p className="px-2 py-1 text-sm text-muted-foreground" data-testid="notes-search-empty">
          No notes match
        </p>
      )}
      {page?.results.map((hit) => (
        <ResultRow key={hit.id} hit={hit} selected={hit.id === selected} onPick={onPick} />
      ))}
      {page?.more && (
        <p className="px-2 py-1 text-xs text-muted-foreground" data-testid="notes-search-more">
          Showing the first {page.results.length}. Add a word to narrow it.
        </p>
      )}
    </div>
  );
}

/** Narrow layout's opener: labelled "Search" (an icon alone read as the Recycle bin's). */
export function NarrowSearchButton({ onClick }: { onClick(): void }) {
  return (
    <Tip content="Search notes">
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0 gap-1 px-2"
        data-testid="notes-search-narrow"
        onClick={onClick}
      >
        <SearchIcon className="size-3.5" />
        Search
      </Button>
    </Tip>
  );
}

/** Narrow layout: a labelled Search button; the box and results in a dialog; a pick opens the note. */
export function NarrowNoteSearch({ refresh }: { refresh: unknown }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const api = useNotesApi();
  const search = useNoteSearch(api, open ? q : "", refresh);
  return (
    <>
      <NarrowSearchButton onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="notes-search-dialog">
          <DialogTitle>Search notes</DialogTitle>
          <NoteSearchBox q={q} onChange={setQ} testId="notes-search-dialog-input" autoFocus />
          <div className="max-h-80 overflow-y-auto">
            <SearchingLine q={q} search={search} />
            {showsResults(q, search) && (
              <NoteSearchResults
                search={search}
                onPick={(id) => {
                  notesUi.getState().select(id);
                  setOpen(false);
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
