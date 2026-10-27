// `cmp.compendium` body (FR-CMP-18–23), both clients: search (debounced 200 ms), Filters popover,
// kind Tabs per role, results with **More**, entry view with Back (list scroll kept). Reads on
// demand: refetch on open, search and Back (FR-CMP-23). Duplicate groups (FR-CMP-35) are one row
// that expands its members in place (fetched with `sameAs` and the same q); Back keeps it open. DM extras come in as props: the import
// panel (`top`), the New homebrew button (`toolbar`), entry actions (`entryActions`: Derive…,
// Clone / Edit / Delete; C4) and monster rows as drag sources (FR-CMP-21). The client supplies
// the `Api` with its credential (DM secret / `Authorization: Player`). The list view's footer
// has the **Credits** link (FR-CMP-19 S4, FR-ENT-29).

import type { EntryResponse, EntrySummary } from "@shared/compendium/rest";
import {
  DEFINITION_DRAG_MIME,
  type DefinitionDragData,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, FilterIcon } from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
import { CreditsLink } from "./credits";
import { useDefinitions } from "./definitions";
import {
  type EntryRead,
  type MembersRead,
  useDefinitionEntry,
  useEntry,
  useGroupMembers,
  useResults,
} from "./fetch";
import {
  activeFilterCount,
  badgeLabel,
  type CmpTab,
  emptyText,
  FILTER_FIELDS,
  type Filters,
  isEntryless,
  type Role,
  searchParams,
  sourceName,
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
  toggleGroup,
  useCmpNav,
} from "./nav";
import { eagerApi } from "./search";
import { Attribution, DragHandle, EntryView, StatBlock } from "./views";

const ANY = "__any__";

/** The DM's extra buttons on an entry view (C4); players pass none. */
export type EntryActions = (data: EntryResponse) => ReactNode;

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

/** Monster rows (DM) drag onto the map (FR-CMP-21); a click opens the entry or definition. */
function rowProps(r: EntrySummary, viewer: Role) {
  const drag = viewer === "dm" && r.kind === "monster" && r.definitionId !== undefined;
  return {
    draggable: drag,
    onDragStart: drag
      ? (e: DragEvent) => {
          const data: DefinitionDragData = { definitionId: r.definitionId as string };
          e.dataTransfer.setData(DEFINITION_DRAG_MIME, JSON.stringify(data));
          e.dataTransfer.effectAllowed = "copy";
        }
      : undefined,
    onClick: () => (isEntryless(r) ? openDefinition(r.definitionId as string) : openEntry(r.id)),
    className: cn(ROW, drag && "cursor-grab active:cursor-grabbing"),
  };
}

/**
 * FR-KIT-76 (OQ-KIT-05 A): the results as a table, Name · Details · Source, from today's fields.
 * Each row is one grid line on the shared columns (a 40-px row, today's height ± 4 px); the rows
 * stay buttons, so drag, click and keyboard are unchanged.
 */
const COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_4.5rem] items-center gap-x-2";
const ROW = cn(
  COLS,
  "min-h-10 w-full px-2 py-1 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
);
/** Zebra rows: every other row of the table body (group members keep their group's stripe). */
const ZEBRA = "[&>li:nth-child(even)]:bg-muted/40";

/** The sticky header row; the columns are read by sight (each row's button names its entry). */
export function TableHead() {
  return (
    <div
      aria-hidden
      data-testid="cmp-table-head"
      data-slot="cmp-table-head"
      className={cn(
        COLS,
        "sticky top-0 z-10 border-b bg-background px-2 py-1 text-xs font-semibold text-muted-foreground",
      )}
    >
      <span>Name</span>
      <span>Details</span>
      <span>Source</span>
    </div>
  );
}

const SourceBadge = ({ label }: { label: string }) => (
  <Badge variant="outline" className="max-w-full justify-self-start truncate px-1.5 text-[10px]">
    {badgeLabel(label)}
  </Badge>
);

/**
 * Name and Details cells: the name in name type (a group's chevron before it); the details line
 * (`r.line`) right after it.
 */
function Cells({ r, lead }: { r: EntrySummary; lead?: ReactNode }) {
  return (
    <>
      <span
        className="flex min-w-0 items-center gap-1 font-medium"
        data-testid="cmp-result-name"
        data-slot="cmp-row-name"
      >
        {lead}
        <span className="truncate">{r.name}</span>
      </span>
      <span className="truncate text-xs text-muted-foreground tabular-nums">{r.line}</span>
    </>
  );
}

export function ResultRow({ r, viewer }: { r: EntrySummary; viewer: Role }) {
  return (
    <li>
      <button
        type="button"
        data-testid="cmp-result"
        data-slot="cmp-row"
        data-record-id={r.id}
        data-value={r.kind}
        {...rowProps(r, viewer)}
      >
        <Cells r={r} />
        <SourceBadge label={r.sourceLabel} />
      </button>
    </li>
  );
}

/**
 * FR-CMP-35 group row: name, the muted group line ("12 entries · Barbarian, Bard, …") and a
 * chevron; a click toggles its members in place below it, each with its own line.
 */
export function GroupRow({
  r,
  expanded,
  children,
}: {
  r: EntrySummary;
  expanded: boolean;
  /** The members while expanded. */
  children?: ReactNode;
}) {
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li>
      <div
        data-testid="cmp-result"
        data-slot="cmp-row"
        data-record-id={r.id}
        data-value={r.kind}
        data-group-count={r.group?.count}
      >
        <button
          type="button"
          data-testid="cmp-group-toggle"
          data-record-id={r.id}
          aria-expanded={expanded}
          onClick={() => toggleGroup(r.id)}
          className={ROW}
        >
          <Cells r={r} lead={<Chevron className="size-3.5 shrink-0 text-muted-foreground" />} />
          <SourceBadge label={r.sourceLabel} />
        </button>
      </div>
      {expanded && children}
    </li>
  );
}

export function GroupMembers({
  group,
  members,
  viewer,
}: {
  group: EntrySummary;
  members: MembersRead;
  viewer: Role;
}) {
  if (members.state === "loading") {
    return (
      <div className="space-y-1 py-0.5 pl-6" data-testid="cmp-group-loading">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }
  if (members.state === "error") {
    return (
      <p className="py-1 pl-8 text-xs text-destructive" data-testid="cmp-group-error">
        {members.error}
      </p>
    );
  }
  return (
    <ul data-testid="cmp-group-members" data-record-id={group.id}>
      {members.members.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            data-testid="cmp-group-member"
            data-record-id={m.id}
            data-value={m.kind}
            data-slot="cmp-row"
            {...rowProps(m, viewer)}
          >
            {/* The member's own line, indented under its group's name, over Name + Details. */}
            <span className="col-span-2 truncate pl-5">{m.line || m.name}</span>
            <SourceBadge label={m.sourceLabel} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function LiveMembers({
  api,
  group,
  q,
  viewer,
}: {
  api: Api;
  group: EntrySummary;
  q: string;
  viewer: Role;
}) {
  const nonce = useCmpNav((s) => s.listNonce);
  const members = useGroupMembers(api, group.id, q, nonce);
  return <GroupMembers group={group} members={members} viewer={viewer} />;
}

function LiveGroupRow({
  api,
  r,
  q,
  viewer,
}: {
  api: Api;
  r: EntrySummary;
  q: string;
  viewer: Role;
}) {
  const expanded = useCmpNav((s) => s.expanded.includes(r.id));
  return (
    <GroupRow r={r} expanded={expanded}>
      <LiveMembers api={api} group={r} q={q} viewer={viewer} />
    </GroupRow>
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
  const unfiltered = Object.keys(res.params).length === 0;
  const shownQ = res.params.q ?? "";
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
    return (
      <p className="p-3 text-sm text-muted-foreground" data-testid="cmp-empty">
        {emptyText(shownQ, unfiltered, viewer)}
      </p>
    );
  }
  return (
    <div data-testid="cmp-results" data-slot="cmp-table" data-state={res.state}>
      <TableHead />
      <ul className={ZEBRA}>
        {res.results.map((r) =>
          r.group ? (
            <LiveGroupRow key={r.id} api={api} r={r} q={shownQ} viewer={viewer} />
          ) : (
            <ResultRow key={r.id} r={r} viewer={viewer} />
          ),
        )}
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

function EntryReadView({
  read,
  viewer,
  actions,
}: {
  read: EntryRead;
  viewer: Role;
  actions?: EntryActions;
}) {
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
  return <EntryView data={read.data} viewer={viewer} actions={actions?.(read.data)} />;
}

function EntryById({
  api,
  id,
  viewer,
  actions,
}: {
  api: Api;
  id: string;
  viewer: Role;
  actions?: EntryActions;
}) {
  const nonce = useCmpNav((s) => s.entryNonce);
  return <EntryReadView read={useEntry(api, id, nonce)} viewer={viewer} actions={actions} />;
}

/**
 * FR-CMP-22: an imported definition (token menu, entryless results). Its entry when one links it;
 * else the definition's stat block alone (e.g. the fixture Goblin).
 */
function DefinitionView({
  api,
  definitionId,
  viewer,
  actions,
}: {
  api: Api;
  definitionId: string;
  viewer: Role;
  actions?: EntryActions;
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
  if (found.entryId !== null) {
    return <EntryById api={api} id={found.entryId} viewer={viewer} actions={actions} />;
  }
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
          name: sourceName(d.source),
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
  actions,
}: {
  api: Api;
  view: Exclude<CmpView, { mode: "list" }>;
  viewer: Role;
  actions?: EntryActions;
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
          <EntryById api={api} id={view.entryId} viewer={viewer} actions={actions} />
        ) : (
          <DefinitionView
            api={api}
            definitionId={view.definitionId}
            viewer={viewer}
            actions={actions}
          />
        )}
      </div>
    </div>
  );
}

export function CompendiumBody({
  api,
  viewer,
  top,
  toolbar,
  entryActions,
}: {
  api: Api;
  viewer: Role;
  top?: ReactNode;
  toolbar?: ReactNode;
  entryActions?: EntryActions;
}) {
  const q = useCmpNav((s) => s.q);
  const tab = useCmpNav((s) => s.tab);
  const filters = useCmpNav((s) => s.filters);
  const view = useCmpNav((s) => s.view);
  const tabs = tabsFor(viewer);
  const credits = useMemo(() => eagerApi(api), [api]);
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
            placeholder="Search: words in any order"
            aria-label="Search the compendium"
            data-testid="cmp-search"
            maxLength={100}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
          />
          <FiltersPopover tab={shownTab} filters={filters} />
          {toolbar}
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
            const t = e.target as HTMLElement;
            if (t.closest('[data-testid="cmp-result"], [data-testid="cmp-group-member"]')) leave();
          }}
        >
          <ResultsList api={api} viewer={viewer} />
        </div>
        {/* FR-CMP-19 (S4): always shown, also with nothing imported (FR-ENT-29). */}
        <footer className="flex justify-end border-t px-2 py-0.5">
          <CreditsLink api={credits} testId="cmp-credits" />
        </footer>
      </div>
      {!listing && <EntryPane api={api} view={view} viewer={viewer} actions={entryActions} />}
    </div>
  );
}
