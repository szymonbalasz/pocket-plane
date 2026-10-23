// `hold.stronghold` "Stronghold" body, both clients (FR-HOLD-23, -24, -34; FR-SHELL-170): the
// selected stronghold (`memory.ts`), loaded with `useLazyRecords("stronghold")`; while it loads the
// title comes from `stronghold-index`; no index row (gone, or hidden from this player) → "This
// stronghold isn't available", no error toast. Header: name, DM "DM only" Badge + "Shown to
// players" Switch, the Defenders chip (DM: click to edit, eye-off toggle), DM menu Rename /
// Delete…, "All strongholds" (`openPartyTab("strongholds")`). Tabs Facilities, Staff, Stores,
// Reminders, Notes (tab per browser; visited tabs stay mounted, as FR-PARTY-50); totals under them
// (FR-HOLD-31). Disconnected → last view, every action disabled (FR-HOLD-34).
import { REMINDER_TYPE, type ReminderView } from "@shared/reminders/schemas";
import {
  DEFENDERS_MAX,
  HOLD_INTENTS,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  type StrongholdIndexRecord,
  type StrongholdRecord,
  type StrongholdView,
} from "@shared/strongholds/schemas";
import { EllipsisIcon, EyeOffIcon, ListIcon, ShieldIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Switch } from "../../components/ui/controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Input, Label, Skeleton } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useLazyRecords, useRecords, useSync } from "../../sync/store";
import { useOpenPartyTab } from "../party-board/open-tab";
import type { WindowProps } from "../play-shell/registry";
import type { ReminderDraft } from "../reminders/logic";
import { DeleteDialog, RenameDialog } from "./dialogs";
import { FacilitiesTab } from "./FacilitiesTab";
import { HoldReminderEditor, HoldReminders, prefillDraft } from "./HoldReminders";
import {
  HOLD_GONE,
  HOLD_PARTY_TAB,
  HOLD_TAB_LABELS,
  type HoldTab,
  orderSuggestions,
  totalsLine,
  visibleTabs,
} from "./logic";
import { useHoldSelection } from "./memory";
import { NotesTab } from "./NotesTab";
import { StaffTab } from "./StaffTab";
import { StoresTab } from "./StoresTab";
import { useHoldIntent, useLive } from "./send";

/** What every tab body gets: the record as this viewer holds it and the viewer's role. */
export interface HoldParts {
  hold: StrongholdView;
  dm: boolean;
}

function DefendersChip({ parts }: { parts: HoldParts }) {
  const live = useLive();
  const intent = useHoldIntent();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const hold = parts.hold;
  const dm = parts.dm ? (hold as StrongholdRecord) : null;
  const [value, setValue] = useState("");
  const [hidden, setHidden] = useState(false);
  if (hold.defenders === undefined) return null;
  const chip = (
    <Badge
      variant="outline"
      data-testid="hold-defenders"
      data-value={hold.defenders}
      className="shrink-0"
    >
      {dm?.defendersDmOnly && <EyeOffIcon className="size-3" aria-label="DM only" />}
      <ShieldIcon className="size-3" /> Defenders {hold.defenders}
    </Badge>
  );
  if (!dm) return chip;
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= DEFENDERS_MAX;
  const unchanged = n === dm.defenders && hidden === dm.defendersDmOnly;
  const save = async () => {
    const patch: Record<string, unknown> = { strongholdId: dm.id };
    if (n !== dm.defenders) patch.defenders = n;
    if (hidden !== dm.defendersDmOnly) patch.defendersDmOnly = hidden;
    if (await intent.send(HOLD_INTENTS.update, patch)) setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setValue(String(dm.defenders));
          setHidden(dm.defendersDmOnly);
          intent.setError(null);
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-label="Edit defenders" disabled={!live}>
          {chip}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56" data-testid="hold-defenders-edit">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor={`${uid}-n`} className="text-xs">
            Defenders
          </Label>
          <Input
            id={`${uid}-n`}
            data-testid="hold-defenders-input"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Switch
              id={`${uid}-dm`}
              data-testid="hold-defenders-dm-only"
              checked={hidden}
              onCheckedChange={setHidden}
            />
            <Label htmlFor={`${uid}-dm`} className="text-sm">
              DM only
            </Label>
          </div>
          {!valid && (
            <p className="text-xs text-destructive">A whole number, 0 to {DEFENDERS_MAX}</p>
          )}
          {intent.error && (
            <p role="alert" className="text-xs text-destructive">
              {intent.error}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            data-testid="hold-defenders-save"
            disabled={!live || intent.busy || !valid || unchanged}
          >
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function DmHeader({ hold }: { hold: StrongholdRecord }) {
  const live = useLive();
  const intent = useHoldIntent();
  const uid = useId();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const shown = !hold.dmOnly;
  return (
    <>
      {hold.dmOnly && (
        <Badge variant="outline" className="text-muted-foreground" data-testid="hold-dm-only">
          <EyeOffIcon className="size-3" /> DM only
        </Badge>
      )}
      <div className="flex items-center gap-1.5">
        <Switch
          id={`${uid}-shown`}
          data-testid="hold-show"
          data-value={String(shown)}
          checked={shown}
          disabled={!live || intent.busy}
          onCheckedChange={(v) =>
            void intent.send(HOLD_INTENTS.update, { strongholdId: hold.id, dmOnly: !v })
          }
        />
        <Label htmlFor={`${uid}-shown`} className="text-xs">
          Shown to players
        </Label>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label={`${hold.name} menu`}
            data-testid="hold-menu"
            disabled={!live}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="hold-rename" onSelect={() => setRenaming(true)}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="hold-delete"
            variant="destructive"
            onSelect={() => setDeleting(true)}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {intent.error && (
        <span role="alert" className="text-xs text-destructive">
          {intent.error}
        </span>
      )}
      <RenameDialog hold={hold} open={renaming} onOpenChange={setRenaming} />
      <DeleteDialog hold={hold} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}

/** FR-PARTY-50's rule: each tab mounts on its first visit, then stays while the window is open. */
function useVisited(tab: HoldTab): ReadonlySet<HoldTab> {
  const [visited, setVisited] = useState<ReadonlySet<HoldTab>>(() => new Set([tab]));
  if (!visited.has(tab)) {
    const next = new Set(visited).add(tab);
    setVisited(next);
    return next;
  }
  return visited;
}

function Loaded({
  parts,
  all,
  reminders,
}: {
  parts: HoldParts;
  all: readonly StrongholdView[];
  reminders: readonly ReminderView[];
}) {
  const sel = useHoldSelection();
  const openTab = useOpenPartyTab();
  const tabs = visibleTabs({ role: parts.dm ? "dm" : "player" }, parts.hold);
  const tab = tabs.includes(sel.tab) ? sel.tab : "facilities";
  const visited = useVisited(tab);
  // FR-HOLD-29: one REM editor for Add reminder, a facility's Make reminder and a row's Edit.
  const [remDraft, setRemDraft] = useState<ReminderDraft | null>(null);
  const body = (t: HoldTab) => {
    switch (t) {
      case "facilities":
        return (
          <FacilitiesTab
            parts={parts}
            reminders={reminders}
            suggestions={orderSuggestions(all)}
            onMakeReminder={(p) => setRemDraft(prefillDraft(p))}
          />
        );
      case "staff":
        return <StaffTab parts={parts} />;
      case "stores":
        return <StoresTab parts={parts} />;
      case "reminders":
        return <HoldReminders parts={parts} reminders={reminders} onEdit={setRemDraft} />;
      case "notes":
        return <NotesTab parts={parts} />;
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <header className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <h3 className="min-w-0 break-words text-base font-semibold" data-testid="hold-name">
          {parts.hold.name}
        </h3>
        <DefendersChip parts={parts} />
        {parts.dm && <DmHeader hold={parts.hold as StrongholdRecord} />}
        {/* An icon keeps the header on one line at the useful width (FR-SHELL-171). */}
        <Tooltip content="All strongholds">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ml-auto size-7 shrink-0"
            aria-label="All strongholds"
            data-testid="hold-all"
            onClick={() => openTab(HOLD_PARTY_TAB)}
          >
            <ListIcon className="size-4" />
          </Button>
        </Tooltip>
      </header>
      <Tabs
        value={tab}
        onValueChange={(v) => sel.chooseTab(v as HoldTab)}
        className="flex min-h-0 flex-1 flex-col gap-1.5"
      >
        <TabsList className="w-full max-w-full justify-start overflow-x-auto overflow-y-hidden">
          {tabs.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              data-testid="hold-tab"
              data-value={t}
              className="shrink-0"
            >
              {HOLD_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t} value={t} forceMount hidden={tab !== t} className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="pr-2">{visited.has(t) ? body(t) : null}</div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
      <p className="text-xs text-muted-foreground" data-testid="hold-totals">
        {totalsLine(parts.hold)}
      </p>
      {remDraft && <HoldReminderEditor draft={remDraft} onDone={() => setRemDraft(null)} />}
    </div>
  );
}

export function StrongholdWindow(_: WindowProps) {
  const { strongholdId } = useHoldSelection();
  const dm = useSync((s) => s.store.you?.role === "dm");
  const index = useRecords<StrongholdIndexRecord>(STRONGHOLD_INDEX_TYPE);
  const holds = useLazyRecords<StrongholdView>(STRONGHOLD_TYPE);
  const reminders = useLazyRecords<ReminderView>(REMINDER_TYPE);
  const row = strongholdId ? index.find((r) => r.id === strongholdId) : undefined;
  const hold = row ? holds.rows.find((r) => r.id === row.id) : undefined;
  let body: React.ReactNode;
  if (!row) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="hold-gone">
        {HOLD_GONE}
      </p>
    );
  } else if (hold) {
    body = <Loaded parts={{ hold, dm }} all={holds.rows} reminders={reminders.rows} />;
  } else if (holds.state === "error") {
    body = (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="font-semibold">{row.name}</p>
        <p className="text-destructive">Couldn't load this stronghold.</p>
        <Button size="sm" variant="outline" data-testid="hold-retry" onClick={holds.retry}>
          Retry
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2" data-testid="hold-loading">
        <p className="font-semibold" data-testid="hold-name">
          {row.name}
        </p>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  return (
    <div className="h-full min-h-0" data-testid="hold-window" data-record-id={row?.id ?? ""}>
      {body}
    </div>
  );
}
