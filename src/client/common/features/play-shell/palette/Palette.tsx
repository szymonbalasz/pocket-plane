// The palette (FR-SHELL-181–183, -194, -196, -197): a modal Dialog (`role="dialog"`, FR-SHELL-13
// keeps map keys out) 560 px wide (≤ 90 vw), top at 12 vh: the input, then the grouped listbox
// (≤ 60 vh, scrolls). Local rows answer every keystroke; compendium and rule rows arrive debounced
// under their headings. ↑ / ↓ move, Enter or a click runs; Escape, a click outside or a pick closes
// it, and focus goes back where it was.
import {
  AppWindowIcon,
  BookOpenIcon,
  HistoryIcon,
  ScrollTextIcon,
  SkullIcon,
  UserIcon,
  ZapIcon,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { PaletteEnv } from "./context";
import { isMac } from "./context";
import { keyLabel } from "./keys";
import {
  flatRows,
  localEntries,
  parseQuery,
  type Row,
  rankLocal,
  type Section,
  withServer,
} from "./rank";
import { closePalette, setInput, usePaletteUi } from "./state";
import { pushRecent, readRecent, recentKey } from "./storage";
import type { CommandCtx, PaletteGroup, SearchHit, SearchProvider } from "./types";

/** FR-SHELL-183: compendium search waits this long after the last keystroke. */
export const SERVER_DEBOUNCE_MS = 150;

const GROUP_ICON: Record<PaletteGroup, typeof ZapIcon> = {
  Recent: HistoryIcon,
  Commands: ZapIcon,
  Windows: AppWindowIcon,
  Characters: UserIcon,
  Creatures: SkullIcon,
  Rules: ScrollTextIcon,
  Compendium: BookOpenIcon,
};

/** The server groups' state (FR-SHELL-196); `local` = no server search for this query. */
export type ServerState = "local" | "searching" | "ready" | "error" | "offline";

/** Debounced server search of every provider with `search` (FR-SHELL-183); stale answers drop. */
function useServerSearch(
  input: string,
  providers: readonly SearchProvider[],
  ctx: CommandCtx,
): { hits: readonly SearchHit[]; state: ServerState; retry(): void } {
  const { mode, q } = parseQuery(input);
  const searchers = providers.filter((p) => p.search);
  const wanted = mode === "all" && q !== "" && searchers.length > 0;
  const [out, setOut] = useState<{ hits: readonly SearchHit[]; state: ServerState }>({
    hits: [],
    state: "local",
  });
  const [nonce, setNonce] = useState(0);
  const latest = useRef({ searchers, ctx });
  latest.current = { searchers, ctx };
  const live = ctx.live;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the Retry trigger
  useEffect(() => {
    if (!wanted) {
      setOut({ hits: [], state: "local" });
      return;
    }
    if (!live) {
      setOut({ hits: [], state: "offline" });
      return;
    }
    setOut((o) => ({ hits: o.hits, state: "searching" }));
    const abort = new AbortController();
    const t = setTimeout(() => {
      const { searchers, ctx } = latest.current;
      Promise.all(searchers.map((p) => p.search?.(q, ctx, abort.signal) ?? [])).then(
        (lists) => !abort.signal.aborted && setOut({ hits: lists.flat(), state: "ready" }),
        () => !abort.signal.aborted && setOut({ hits: [], state: "error" }),
      );
    }, SERVER_DEBOUNCE_MS);
    return () => {
      abort.abort();
      clearTimeout(t);
    };
  }, [wanted, q, live, nonce]);
  return { ...out, retry: () => setNonce((n) => n + 1) };
}

/** The `kbd` chips of a row's keys. */
export function KeyChips({ keys, mac }: { keys: readonly string[]; mac: boolean }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border bg-muted px-1.5 font-mono text-[11px] leading-5 text-muted-foreground"
        >
          {keyLabel(k, mac)}
        </kbd>
      ))}
    </span>
  );
}

/** The listbox body: sections, the server state line, "No matches" (pure render, tested). */
export function PaletteList({
  sections,
  server,
  active,
  listId,
  mac,
  onHover,
  onPick,
  onRetry,
}: {
  sections: readonly Section[];
  server: ServerState;
  active: number;
  listId: string;
  mac: boolean;
  onHover?: (i: number) => void;
  onPick?: (row: Row) => void;
  onRetry?: () => void;
}) {
  let i = -1;
  const empty = sections.length === 0 && server !== "searching";
  return (
    <div
      id={listId}
      role="listbox"
      aria-label="Results"
      className="max-h-[60vh] overflow-y-auto p-1"
    >
      {sections.map((s) => {
        const Icon = GROUP_ICON[s.group];
        return (
          // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox group, not a form fieldset
          <div
            key={s.group}
            role="group"
            aria-label={s.group}
            data-testid="ui-palette-group"
            data-value={s.group}
          >
            <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {s.group}
            </div>
            {s.rows.map((row) => {
              i += 1;
              const at = i;
              const RowIcon = row.icon ?? Icon;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keys reach rows through the combobox input (aria-activedescendant)
                <div
                  key={row.key}
                  id={`${listId}-${at}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={at === active}
                  aria-disabled={row.disabled ? true : undefined}
                  data-testid="ui-palette-item"
                  data-record-id={row.id}
                  data-value={row.group}
                  data-kind={row.kind}
                  data-disabled={row.disabled ? "true" : undefined}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    at === active && "bg-accent text-accent-foreground",
                    row.disabled && "opacity-60",
                  )}
                  // Focus stays in the input.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => onHover?.(at)}
                  onClick={() => onPick?.(row)}
                >
                  <RowIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{row.title}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {row.disabled ?? row.hint}
                  </span>
                  {row.keys && row.keys.length > 0 && <KeyChips keys={row.keys} mac={mac} />}
                </div>
              );
            })}
          </div>
        );
      })}
      {server === "searching" && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</p>
      )}
      {server === "error" && (
        <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-destructive">
          Couldn't search the compendium
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            data-testid="ui-palette-retry"
            onClick={onRetry}
          >
            Retry
          </Button>
        </p>
      )}
      {server === "offline" && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Offline: compendium search unavailable
        </p>
      )}
      {empty && (
        <p
          data-testid="ui-palette-empty"
          className="px-2 py-3 text-center text-sm text-muted-foreground"
        >
          No matches
        </p>
      )}
    </div>
  );
}

/**
 * FR-SHELL-180: focus goes back to the element that had it when the dialog opened (Radix would
 * send it to a trigger these dialogs don't have). Returns the `onCloseAutoFocus` handler.
 */
export function useFocusReturn(): (e: Event) => void {
  const returnTo = useRef<Element | null>(null);
  useLayoutEffect(() => {
    returnTo.current = document.activeElement;
  }, []);
  return (e: Event) => {
    e.preventDefault();
    const el = returnTo.current as HTMLElement | null;
    if (el?.isConnected && typeof el.focus === "function") el.focus({ preventScroll: true });
  };
}

export function Palette({ env }: { env: PaletteEnv }) {
  const { ctx, commands, providers } = env;
  const input = usePaletteUi((s) => s.input);
  const listId = useId();
  const mac = isMac();
  const you = ctx.store.you;
  const rKey = you
    ? recentKey(
        you.campaignId,
        you.role === "player" && you.playerId ? { playerId: you.playerId } : { role: "dm" },
      )
    : null;
  const [recent, setRecent] = useState<string[]>(() => (rKey ? readRecent(rKey) : []));
  // Prepared once per store / layout change (FR-SHELL-198: matching stays per keystroke).
  const entries = useMemo(() => localEntries(commands, providers, ctx), [commands, providers, ctx]);
  const local = useMemo(() => rankLocal(entries, input, recent), [entries, input, recent]);
  const server = useServerSearch(input, providers, ctx);
  const sections = useMemo(() => withServer(local, server.hits, ctx), [local, server.hits, ctx]);
  const rows = flatRows(sections);
  const [active, setActive] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query highlights the first row
  useEffect(() => setActive(0), [input]);
  const at = Math.min(active, Math.max(rows.length - 1, 0));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[id="${CSS.escape(`${listId}-${at}`)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [at, listId]);

  const returnFocus = useFocusReturn();

  const pick = (row: Row) => {
    if (row.disabled) return;
    if (rKey && !row.key.startsWith("s:")) setRecent(pushRecent(rKey, row.key));
    closePalette();
    // After the palette is gone and focus is back: a command may move focus itself.
    setTimeout(() => row.run(), 0);
  };

  return (
    <D.Root open onOpenChange={(o) => !o && closePalette()}>
      <D.Overlay className="pointer-events-auto fixed inset-0 bg-black/40" />
      <D.Content
        data-testid="ui-palette"
        data-palette=""
        data-state={server.state}
        aria-describedby={undefined}
        className="pointer-events-auto fixed top-[12vh] left-1/2 flex w-[560px] max-w-[90vw] -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none"
        onCloseAutoFocus={returnFocus}
      >
        <D.Title className="sr-only">Search and commands</D.Title>
        <input
          data-testid="ui-palette-input"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={rows.length > 0 ? `${listId}-${at}` : undefined}
          aria-label="Search windows, commands, characters, rules and the compendium"
          placeholder="Search, or > for commands, @ for characters"
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = rows.length;
              if (n > 0) setActive((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const row = rows[at];
              if (row) pick(row);
            }
          }}
        />
        <div ref={listRef}>
          <PaletteList
            sections={sections}
            server={server.state}
            active={at}
            listId={listId}
            mac={mac}
            onHover={setActive}
            onPick={pick}
            onRetry={server.retry}
          />
        </div>
      </D.Content>
    </D.Root>
  );
}
