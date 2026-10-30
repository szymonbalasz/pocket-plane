// FR-CMP-20 DM import panel (top of `cmp.compendium`): nothing imported → empty state with
// **Import SRD 5.1**; imported → "SRD 5.1 · N entries · imported ‹date›" and **Update** when the
// bundled version differs. Click → confirm "Players will pause for ~2 s" → `POST
// /api/compendium/import` → Toast with counts, or the error ("End combat first"). Disabled while
// running or not live (writes follow the shell's offline rule). Below it, the 5etools books.
import {
  entryTotal,
  ImportResponse,
  importSummary,
  type SourceStatus,
  SourcesResponse,
  sourcePanelState,
} from "@shared/compendium/import";
import { type Api, ApiError, call } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Skeleton } from "@ui/components/ui/primitives";
import { refetch } from "@ui/features/compendium/nav";
import { refetchRules } from "@ui/features/compendium/rules/nav";
import { useSync } from "@ui/sync/store";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FiveEtoolsPanel } from "./FiveEtoolsPanel";
import { ConfirmImport, importedDay } from "./ImportConfirm";

/** Status line of an imported source (FR-CMP-20). */
export const statusLine = (s: SourceStatus) =>
  s.imported
    ? `${s.name} · ${entryTotal(s.imported.counts).toLocaleString("en-US")} entries · imported ${importedDay(s.imported.importedAt)}`
    : `${s.name} · not imported`;

export const IMPORT_CONFIRM = "Players will pause for ~2 s";

async function fetchSources(api: Api): Promise<SourcesResponse> {
  const body = await call<unknown>(api.api.compendium.sources.$get());
  return SourcesResponse.parse(body);
}

async function runImport(api: Api, source: string): Promise<ImportResponse> {
  const body = await call<unknown>(api.api.compendium.import.$post({ json: { source } }));
  return ImportResponse.parse(body);
}

function SourceRow({ api, s, reload }: { api: Api; s: SourceStatus; reload(): void }) {
  const live = useSync((st) => st.state === "live");
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const state = sourcePanelState(s);
  const start = () => {
    setRunning(true);
    runImport(api, s.key)
      .then((r) => {
        toast.success(`${s.name} imported: ${importSummary(r.counts)}`);
        reload();
        refetch(); // FR-CMP-23: the DM's own writes refetch at once.
        refetchRules(); // …the Rules window too (an Update brings the rule cards).
      })
      .catch((err: unknown) => {
        toast.error(err instanceof ApiError ? err.message : "Import failed");
      })
      .finally(() => setRunning(false));
  };
  const disabled = running || !live;
  return (
    <div className="flex items-center gap-2" data-testid="cmp-import-panel" data-state={state}>
      {state === "empty" ? (
        <>
          <span className="flex-1 text-xs text-muted-foreground" data-testid="cmp-import-status">
            No compendium imported yet
          </span>
          <Button
            size="sm"
            className="h-7 px-2"
            data-testid="cmp-import"
            disabled={disabled}
            onClick={() => setConfirm(true)}
          >
            <DownloadIcon className="size-3.5" /> Import {s.name}
          </Button>
        </>
      ) : (
        <>
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            data-testid="cmp-import-status"
          >
            {running ? `Importing ${s.name}…` : statusLine(s)}
          </span>
          {state === "update" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              data-testid="cmp-update"
              disabled={disabled}
              onClick={() => setConfirm(true)}
            >
              <RefreshCwIcon className="size-3.5" /> Update
            </Button>
          )}
        </>
      )}
      <ConfirmImport
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={start}
        title={`${s.imported !== null ? "Update" : "Import"} ${s.name}?`}
        description={IMPORT_CONFIRM}
        action={s.imported !== null ? "Update" : "Import"}
      />
    </div>
  );
}

export function ImportPanel({ api }: { api: Api }) {
  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchSources(api).then(
      (s) => {
        setSources(s);
        setError(null);
      },
      (err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't load sources"),
    );
  }, [api]);
  useEffect(() => load(), [load]);
  return (
    <div className="space-y-1 border-b px-2 py-1.5">
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {sources === null && !error && <Skeleton className="h-6 w-full" />}
      {sources?.sources.map((s) => (
        <SourceRow key={s.key} api={api} s={s} reload={load} />
      ))}
      {sources && <FiveEtoolsPanel api={api} status={sources.fiveEtools} reload={load} />}
    </div>
  );
}
