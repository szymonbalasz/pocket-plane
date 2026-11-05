// The Notes window's search (NOTES §7, FR-NOTES-22; slice N4): a box above the list, results with
// the title and a short snippet in the list's place while the box holds a query, a click opens
// the note. Narrow (< 520 px): a Search button beside the dropdown opens the box and results in a
// dialog, like the Recycle bin. DM view = player view.
import type { NoteSearchHit } from "@shared/linked-notes/search";
import { SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/overlays";
import { Input, Skeleton } from "../../components/ui/primitives";
import { pageApi } from "../../session";
import { useSync } from "../../sync/store";
import { isSearch, useNoteSearch } from "./search";
import { notesUi } from "./ui";

/** The search input; Escape clears it. */
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
        type="search"
        data-testid={testId}
        aria-label="Search notes"
        placeholder="Search notes…"
        className="h-8 pr-7 pl-7"
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
        <button
          type="button"
          aria-label="Clear search"
          data-testid="notes-search-clear"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
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
      {hit.snippet !== "" && (
        <span
          className="line-clamp-2 w-full text-xs break-words text-muted-foreground"
          data-testid="notes-search-snippet"
        >
          {hit.snippet}
        </span>
      )}
    </button>
  );
}

/**
 * Results for `q` (searched once the typing pauses), best first. `refresh`: the note list; a
 * create, rename, delete or restore searches again.
 */
export function NoteSearchResults({
  q,
  refresh,
  onPick,
}: {
  q: string;
  refresh: unknown;
  onPick(id: string): void;
}) {
  const role = useSync((s) => s.store.you?.role) === "dm" ? "dm" : "player";
  const api = useMemo(() => pageApi(role), [role]);
  const selected = useStore(notesUi, (s) => s.selected);
  const search = useNoteSearch(api, q, refresh);
  const page = search.page;
  return (
    <div
      className="flex flex-col gap-0.5"
      data-testid="notes-search-results"
      data-state={search.state}
      aria-live="polite"
    >
      {search.state === "loading" &&
        page === null &&
        [0, 1].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
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
      {page && page.results.length === 0 && search.state === "ready" && (
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

/** Narrow layout: a Search button; the box and results in a dialog; a pick opens the note. */
export function NarrowNoteSearch({ refresh }: { refresh: unknown }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0 px-2"
        aria-label="Search notes"
        data-testid="notes-search-narrow"
        onClick={() => setOpen(true)}
      >
        <SearchIcon className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="notes-search-dialog">
          <DialogTitle>Search notes</DialogTitle>
          <NoteSearchBox q={q} onChange={setQ} testId="notes-search-dialog-input" autoFocus />
          {isSearch(q) && (
            <div className="max-h-80 overflow-y-auto">
              <NoteSearchResults
                q={q}
                refresh={refresh}
                onPick={(id) => {
                  notesUi.getState().select(id);
                  setOpen(false);
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
