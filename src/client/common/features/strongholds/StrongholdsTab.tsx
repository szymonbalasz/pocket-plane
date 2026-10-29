// Party Manager **Strongholds** tab content (FR-HOLD-22, hosted per FR-PARTY-73): one row per
// stronghold the viewer receives, by name, rendered from the snapshot's `stronghold-index` at once;
// the state summary and Defenders fill in when this tab's `useLazyRecords("stronghold")` returns
// (the load is made when the tab mounts, never when the Party Manager opens, FR-PARTY-74). DM:
// New stronghold (inline name), row menu Rename, Show / Hide, Delete…. Players never see an empty
// tab (FR-PARTY-72 hides it).
import {
  HOLD_INTENTS,
  HOLD_NAME_MAX,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  type StrongholdIndexRecord,
  type StrongholdView,
} from "@shared/strongholds/schemas";
import { EllipsisIcon, EyeOffIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { Badge, Input, Skeleton } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tip } from "../../components/ui/tip";
import { useLazyRecords, useRecords, useSync } from "../../sync/store";
import { DeleteDialog, RenameDialog } from "./dialogs";
import { byName, stateSummary } from "./logic";
import { useOpenStronghold } from "./memory";
import { useHoldIntent, useLive } from "./send";

function NewStronghold() {
  const live = useLive();
  const intent = useHoldIntent();
  const [name, setName] = useState("");
  const clean = name.trim();
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await intent.send(HOLD_INTENTS.create, { name: clean })) setName("");
      }}
    >
      <div className="flex items-center gap-1.5">
        <Input
          data-testid="hold-new-name"
          aria-label="New stronghold name"
          placeholder="New stronghold"
          className="h-8"
          value={name}
          maxLength={HOLD_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            intent.setError(null);
          }}
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 shrink-0"
          data-testid="hold-new"
          disabled={!live || intent.busy || clean === ""}
        >
          <PlusIcon className="size-3.5" /> New stronghold
        </Button>
      </div>
      {intent.error && (
        <p role="alert" className="text-xs text-destructive" data-testid="hold-new-error">
          {intent.error}
        </p>
      )}
    </form>
  );
}

function RowMenu({ row }: { row: StrongholdIndexRecord }) {
  const live = useLive();
  const intent = useHoldIntent();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const shown = row.dmOnly !== true;
  return (
    <>
      <DropdownMenu>
        <Tip content={`${row.name} menu`} off={!live}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={`${row.name} menu`}
              data-testid="hold-row-menu"
              data-record-id={row.id}
              disabled={!live}
            >
              <EllipsisIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="hold-rename" onSelect={() => setRenaming(true)}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="hold-show"
            data-value={String(shown)}
            disabled={intent.busy}
            onSelect={() =>
              void intent.send(HOLD_INTENTS.update, { strongholdId: row.id, dmOnly: shown })
            }
          >
            {shown ? "Hide from players" : "Show to players"}
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
      <RenameDialog hold={row} open={renaming} onOpenChange={setRenaming} />
      <DeleteDialog hold={row} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}

function Row({
  row,
  full,
  loading,
  dm,
}: {
  row: StrongholdIndexRecord;
  full: StrongholdView | undefined;
  loading: boolean;
  dm: boolean;
}) {
  const open = useOpenStronghold();
  const summary = full ? stateSummary(full.facilities) : "";
  return (
    <li
      data-testid="hold-row"
      data-record-id={row.id}
      data-dm-only={String(row.dmOnly === true)}
      className="flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words font-medium" data-testid="hold-row-name">
            {row.name}
          </span>
          {dm && row.dmOnly && (
            <Badge variant="outline" className="text-muted-foreground" data-testid="hold-row-dm">
              <EyeOffIcon className="size-3" /> DM only
            </Badge>
          )}
        </div>
        {loading && !full ? (
          <Skeleton className="mt-1 h-3 w-40" />
        ) : (
          <div className="text-xs text-muted-foreground">
            {summary && <span data-testid="hold-row-summary">{summary}</span>}
            {full?.defenders !== undefined && (
              <span data-testid="hold-row-defenders" data-value={full.defenders}>
                {summary ? " · " : ""}Defenders {full.defenders}
              </span>
            )}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2"
        data-testid="hold-row-open"
        data-record-id={row.id}
        onClick={() => open(row.id)}
      >
        Open
      </Button>
      {dm && <RowMenu row={row} />}
    </li>
  );
}

export function StrongholdsTab() {
  const dm = useSync((s) => s.store.you?.role === "dm");
  const index = byName(useRecords<StrongholdIndexRecord>(STRONGHOLD_INDEX_TYPE));
  const { rows, state, retry } = useLazyRecords<StrongholdView>(STRONGHOLD_TYPE);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 pr-2" data-testid="hold-list">
        {dm && <NewStronghold />}
        {state === "error" && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            Couldn't load the strongholds.
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              data-testid="hold-retry"
              onClick={retry}
            >
              Retry
            </Button>
          </div>
        )}
        {index.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="hold-list-empty">
            No strongholds yet
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {index.map((r) => (
              <Row key={r.id} row={r} full={byId.get(r.id)} loading={state === "loading"} dm={dm} />
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  );
}
