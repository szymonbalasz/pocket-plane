// `cmp.compendium` body (FR-CMP-18–23), both clients: search (debounced 200 ms), Filters popover,
// kind Tabs per role, results with **More**, entry view with Back (list scroll kept). Reads on
// demand: refetch on open, search and Back (FR-CMP-23). DM extras come in as props: the import
// panel (`top`) and monster rows as drag sources (FR-CMP-21). The client supplies the `Api` with
// its credential (DM secret / `Authorization: Player`).

import type { EntrySummary } from "@shared/compendium/rest";
import {
  DEFINITION_DRAG_MIME,
  type DefinitionDragData,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import { ArrowLeftIcon, FilterIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { Api } from "../../api";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Badge, Input, Label, Skeleton } from "../../components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import { useDefinitions } from "./definitions";
import { type EntryRead, useDefinitionEntry, useEntry, useResults } from "./fetch";
import {
  activeFilterCount,
  badgeLabel,
  type CmpTab,
  FILTER_FIELDS,
  type Filters,
  isEntryless,
  type Role,
  searchParams,
  TAB_LABEL,
  tabsFor,
  WINDOW_DEBOUNCE_MS,
} from "./logic";
import {
  backToList,
  type CmpView,
  openDefinition,
  openEntry,
  setFilters,
  setQuery,
  setTab,
  useCmpNav,
} from "./nav";
import { Attribution, DragHandle, EntryView, StatBlock } from "./views";

const ANY = "__any__";

function FiltersPopover({ tab, filters }: { tab: CmpTab; filters: Filters }) {
  const fields = tab === "all" ? [] : FILTER_FIELDS[tab];
  const count = activeFilterCount(tab, filters);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2"
          data-testid="cmp-filters"
          data-value={count}
          disabled={fields.length === 0}
          aria-label="Filters"
        >
          <FilterIcon className="size-3.5" />
          {count > 0 && <span className="tabular-nums">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3" data-testid="cmp-filters-panel">
        {fields.map((f) => {
          const value = filters[f.key] ?? "";
          const set = (v: string) => setFilters({ ...filters, [f.key]: v });
          return (
            <div key={f.key} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <Label className="text-xs">{f.label}</Label>
              {f.options ? (
                <Select value={value || ANY} onValueChange={(v) => set(v === ANY ? "" : v)}>
                  <SelectTrigger className="h-8" data-testid="cmp-filter" data-value={f.key}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any</SelectItem>
                    {f.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8"
                  data-testid="cmp-filter"
                  data-value={f.key}
                  value={value}
                  maxLength={40}
                  onChange={(e) => set(e.target.value)}
                />
              )}
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            data-testid="cmp-filters-clear"
            disabled={count === 0}
            onClick={() => setFilters({})}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ResultRow({ r, viewer }: { r: EntrySummary; viewer: Role }) {
  const drag = viewer === "dm" && r.kind === "monster" && r.definitionId !== undefined;
  return (
    <li>
      <button
        type="button"
        data-testid="cmp-result"
        data-record-id={r.id}
        data-value={r.kind}
        draggable={drag}
        onDragStart={
          drag
            ? (e) => {
                const data: DefinitionDragData = { definitionId: r.definitionId as string };
                e.dataTransfer.setData(DEFINITION_DRAG_MIME, JSON.stringify(data));
                e.dataTransfer.effectAllowed = "copy";
              }
            : undefined
        }
        onClick={() =>
          isEntryless(r) ? openDefinition(r.definitionId as string) : openEntry(r.id)
        }
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          drag && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" data-testid="cmp-result-name">
            {r.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{r.line}</span>
        </span>
        <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">
          {badgeLabel(r.sourceLabel)}
        </Badge>
      </button>
    </li>
  );
}

function ResultsList({ api, viewer }: { api: Api; viewer: Role }) {
  const q = useCmpNav((s) => s.q);
  const tab = useCmpNav((s) => s.tab);
  const filters = useCmpNav((s) => s.filters);
  const nonce = useCmpNav((s) => s.listNonce);
  const params = useMemo(() => searchParams(q, tab, filters), [q, tab, filters]);
  const res = useResults(api, params, nonce, WINDOW_DEBOUNCE_MS);
  // CMP §7 states: a failed read → error Toast (once per failure) + Retry in the list.
  useEffect(() => {
    if (res.state === "error" && res.error) toast.error(res.error);
  }, [res.state, res.error]);
  const first = res.state === "loading" && res.results.length === 0;
  const unfiltered = Object.keys(params).length === 0;
  if (first) {
    return (
      <div className="space-y-1.5 p-2" data-testid="cmp-loading">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (res.state === "error" && res.results.length === 0) {
    return (
      <div className="space-y-2 p-3 text-sm" data-testid="cmp-error">
        <p className="text-destructive">{res.error}</p>
        <Button size="sm" variant="outline" data-testid="cmp-retry" onClick={() => backToList()}>
          Retry
        </Button>
      </div>
    );
  }
  if (res.results.length === 0) {
    let text = `No matches for ‘${q.trim()}’`;
    if (unfiltered) {
      text = viewer === "dm" ? "Nothing imported yet" : "The DM hasn't set up the compendium yet";
    } else if (q.trim() === "") text = "No matches";
    return (
      <p className="p-3 text-sm text-muted-foreground" data-testid="cmp-empty">
        {text}
      </p>
    );
  }
  return (
    <div data-testid="cmp-results" data-state={res.state}>
      <ul className="space-y-0.5 p-1">
        {res.results.map((r) => (
          <ResultRow key={r.id} r={r} viewer={viewer} />
        ))}
      </ul>
      {res.hasMore && (
        <div className="p-1 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full"
            data-testid="cmp-more"
            disabled={res.state === "loading"}
            onClick={res.more}
          >
            More
          </Button>
        </div>
      )}
    </div>
  );
}

function EntryReadView({ read, viewer }: { read: EntryRead; viewer: Role }) {
  if (read.state === "loading") {
    return (
      <div className="space-y-2" data-testid="cmp-entry-loading">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (read.state === "error") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="cmp-entry-error">
        {read.error}
      </p>
    );
  }
  return <EntryView data={read.data} viewer={viewer} />;
}

function EntryById({ api, id, viewer }: { api: Api; id: string; viewer: Role }) {
  const nonce = useCmpNav((s) => s.entryNonce);
  return <EntryReadView read={useEntry(api, id, nonce)} viewer={viewer} />;
}

/**
 * FR-CMP-22: an imported definition (token menu, entryless results). Its entry when one links it;
 * else the definition's stat block alone (e.g. the fixture Goblin).
 */
function DefinitionView({
  api,
  definitionId,
  viewer,
}: {
  api: Api;
  definitionId: string;
  viewer: Role;
}) {
  const defs = useDefinitions(useMemo(() => [definitionId], [definitionId]));
  const raw = defs.byId.get(definitionId);
  const def = raw ? ImportedEntityRecord.safeParse(raw) : null;
  const name = def?.success ? def.data.name : null;
  const found = useDefinitionEntry(api, definitionId, name);
  if (defs.state === "error") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="cmp-entry-error">
        Couldn't load this creature.
      </p>
    );
  }
  if (found.state === "error") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="cmp-entry-error">
        {found.error}
      </p>
    );
  }
  if (!def?.success || found.state === "loading")
    return <EntryReadView read={{ state: "loading" }} viewer={viewer} />;
  if (found.entryId !== null) return <EntryById api={api} id={found.entryId} viewer={viewer} />;
  const d = def.data;
  return (
    <article
      data-testid="cmp-entry"
      data-record-id={d.id}
      data-value="monster"
      className="space-y-2"
    >
      {viewer === "dm" && (
        <div className="flex items-center justify-end gap-1" data-testid="cmp-entry-actions">
          <DragHandle definitionId={d.id} name={d.name} />
        </div>
      )}
      <StatBlock name={d.name} definition={d} />
      <Attribution
        source={{
          key: d.source,
          name: d.source,
          licence: d.licence,
          attribution: d.attribution,
          url: null,
          version: d.importedAt,
        }}
        entry={{ shared: false }}
        viewer={viewer}
      />
    </article>
  );
}

function EntryPane({
  api,
  view,
  viewer,
}: {
  api: Api;
  view: Exclude<CmpView, { mode: "list" }>;
  viewer: Role;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center border-b px-1 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          data-testid="cmp-back"
          onClick={backToList}
        >
          <ArrowLeftIcon className="size-4" /> Back
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {view.mode === "entry" ? (
          <EntryById api={api} id={view.entryId} viewer={viewer} />
        ) : (
          <DefinitionView api={api} definitionId={view.definitionId} viewer={viewer} />
        )}
      </div>
    </div>
  );
}

export function CompendiumBody({ api, viewer, top }: { api: Api; viewer: Role; top?: ReactNode }) {
  const q = useCmpNav((s) => s.q);
  const tab = useCmpNav((s) => s.tab);
  const filters = useCmpNav((s) => s.filters);
  const view = useCmpNav((s) => s.view);
  const tabs = tabsFor(viewer);
  const shownTab = tabs.includes(tab) ? tab : "all";
  const listing = view.mode === "list";
  // Back returns with the list's scroll kept (CMP §7): saved on leaving, restored on return.
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    if (listing && scroller.current) scroller.current.scrollTop = scrollTop.current;
  }, [listing]);
  const leave = () => {
    scrollTop.current = scroller.current?.scrollTop ?? 0;
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cmp-window" data-view={view.mode}>
      {top}
      <div className={cn("flex min-h-0 flex-1 flex-col", !listing && "hidden")}>
        <div className="flex items-center gap-1.5 px-2 pt-2">
          <Input
            className="h-8"
            placeholder="Search"
            aria-label="Search the compendium"
            data-testid="cmp-search"
            maxLength={100}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
          />
          <FiltersPopover tab={shownTab} filters={filters} />
        </div>
        <Tabs value={shownTab} onValueChange={(v) => setTab(v as CmpTab)} className="px-2 pt-1.5">
          <TabsList className="w-full justify-start overflow-x-auto">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} data-testid="cmp-tab" data-value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div
          ref={scroller}
          className="mt-1 min-h-0 flex-1 overflow-y-auto"
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest('[data-testid="cmp-result"]')) leave();
          }}
        >
          <ResultsList api={api} viewer={viewer} />
        </div>
      </div>
      {!listing && <EntryPane api={api} view={view} viewer={viewer} />}
    </div>
  );
}
