// FR-CMPX-17 DM import panel, 5etools section: the folder's state, then its books (search,
// checkbox per book, counts, "imported ‹date›" or **Update**), **Import selected** / **Update all**
// → confirm → one `POST /api/compendium/import` per book, one after another (FR-CMPX-12): progress
// "Book i / N", then a Toast with the totals and warning count, an error Toast per failed book.
// Disabled while running or not live.
import {
  type BookStatus,
  bookPanelState,
  booksSummary,
  type FiveEtoolsStatus,
  ImportResponse,
} from "@shared/compendium/import";
import { type Api, ApiError, call } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import { Badge, Input } from "@ui/components/ui/primitives";
import { Progress } from "@ui/components/ui/progress";
import { refetch } from "@ui/features/compendium/nav";
import { useSync } from "@ui/sync/store";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { filterBooks, importBooks, updatableBooks } from "./five-etools";
import { ConfirmImport, importedDay } from "./ImportConfirm";

export const BOOKS_CONFIRM = "Players will pause for a few seconds per book";

const plural = (n: number, one: string) =>
  `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

/** "MM · 450 monsters · 0 spells · 0 items · imported 30 Oct 2026". */
export const bookLine = (b: BookStatus) =>
  [
    b.abbr,
    plural(b.counts.monster, "monster"),
    plural(b.counts.spell, "spell"),
    plural(b.counts.item, "item"),
    ...(b.importedAt ? [`imported ${importedDay(b.importedAt)}`] : []),
  ].join(" · ");

function BookRow({
  book,
  version,
  checked,
  disabled,
  onChange,
}: {
  book: BookStatus;
  version: string | undefined;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}) {
  const state = bookPanelState(book, version);
  return (
    <div
      className="flex items-center gap-2 px-1 py-0.5"
      data-testid="cmpx-book"
      data-value={book.key}
      data-state={state}
    >
      <Checkbox
        id={`cmpx-book-${book.key}`}
        data-testid="cmpx-book-check"
        aria-label={book.name}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <label htmlFor={`cmpx-book-${book.key}`} className="min-w-0 flex-1 text-xs">
        <span className="block truncate">{book.name}</span>
        <span className="block truncate text-muted-foreground">{bookLine(book)}</span>
      </label>
      {state === "imported" && <Badge variant="secondary">Imported</Badge>}
      {state === "outdated" && <Badge variant="outline">Update</Badge>}
    </div>
  );
}

/** FR-CMPX-17: replaces the footer while a run is going. */
export function RunProgress({ index, total }: { index: number; total: number }) {
  return (
    <div className="space-y-1" data-testid="cmpx-progress" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        Book {index} / {total}
      </p>
      <Progress value={((index - 1) / total) * 100} />
    </div>
  );
}

function BookList({ api, status, reload }: { api: Api; status: FiveEtoolsStatus; reload(): void }) {
  const live = useSync((st) => st.state === "live");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<{
    books: readonly BookStatus[];
    action: "Import" | "Update";
  } | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const updatable = updatableBooks(status);
  const chosen = status.books.filter((b) => selected.has(b.key));
  const running = progress !== null;

  const start = async (books: readonly BookStatus[]) => {
    setProgress({ index: 1, total: books.length });
    const { done, failed } = await importBooks(
      books,
      async (key, run) =>
        ImportResponse.parse(
          await call<unknown>(api.api.compendium.import.$post({ json: { source: key, run } })),
        ),
      (index) => setProgress({ index, total: books.length }),
    );
    for (const f of failed) {
      toast.error(
        `${f.book.name}: ${f.error instanceof ApiError ? f.error.message : "Import failed"}`,
      );
    }
    if (done.length > 0) toast.success(booksSummary(done));
    setProgress(null);
    setSelected(new Set());
    reload();
    if (done.length > 0) refetch(); // FR-CMP-23: the DM's own writes refetch at once.
  };

  return (
    <>
      <Input
        className="h-7 text-xs"
        placeholder="Search books"
        aria-label="Search books"
        data-testid="cmpx-book-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-40 overflow-y-auto">
        {filterBooks(status.books, q).map((b) => (
          <BookRow
            key={b.key}
            book={b}
            version={status.version}
            checked={selected.has(b.key)}
            disabled={running}
            onChange={(on) =>
              setSelected((s) => {
                const next = new Set(s);
                if (on) next.add(b.key);
                else next.delete(b.key);
                return next;
              })
            }
          />
        ))}
      </div>
      {progress ? (
        <RunProgress index={progress.index} total={progress.total} />
      ) : (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            data-testid="cmpx-update-all"
            disabled={updatable.length === 0 || !live}
            onClick={() => setPending({ books: updatable, action: "Update" })}
          >
            <RefreshCwIcon className="size-3.5" /> Update all
          </Button>
          <Button
            size="sm"
            className="h-7 px-2"
            data-testid="cmpx-import"
            disabled={chosen.length === 0 || !live}
            onClick={() => setPending({ books: chosen, action: "Import" })}
          >
            <DownloadIcon className="size-3.5" /> Import selected
          </Button>
        </div>
      )}
      <ConfirmImport
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={`${pending?.action} ${plural(pending?.books.length ?? 0, "book")}?`}
        description={BOOKS_CONFIRM}
        action={pending?.action ?? "Import"}
        onConfirm={() => {
          if (pending) void start(pending.books);
        }}
      />
    </>
  );
}

function statusText(s: FiveEtoolsStatus): string {
  if (s.state === "ready") return `5etools ${s.release ?? ""}`.trim();
  return "Set PP_5ETOOLS_DIR in .env to your extracted 5etools folder";
}

export function FiveEtoolsPanel({
  api,
  status,
  reload,
}: {
  api: Api;
  status: FiveEtoolsStatus;
  reload(): void;
}) {
  return (
    <section className="space-y-1" data-testid="cmpx-panel">
      <div
        className="text-xs text-muted-foreground"
        data-testid="cmpx-status"
        data-state={status.state}
      >
        <p>{statusText(status)}</p>
        {status.state === "not-found" && (
          <>
            <p className="break-all">{status.path}</p>
            {status.issues?.map((i) => (
              <p key={i} className="text-destructive">
                {i}
              </p>
            ))}
          </>
        )}
      </div>
      {status.state === "ready" && <BookList api={api} status={status} reload={reload} />}
    </section>
  );
}
