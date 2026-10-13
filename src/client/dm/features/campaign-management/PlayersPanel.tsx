// Players panel: name, online dot, copy link, rename; add player (CAMP §7, FR-CAMP-12–15).
import {
  isLoopbackUrl,
  PlayerName,
  type PlayerRecord,
  type PlayerWithLink,
  playerLinkUrl,
} from "@shared/campaign-management/schemas";
import type { PresenceRecord } from "@shared/live-sync/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Alert, Input, Table, TableBody, TableCell, TableRow } from "@ui/components/ui/primitives";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NameDialog } from "./NameDialog";
import { api, dmCall } from "./session";

interface PlayersResponse {
  campaignId: string;
  publicBaseUrl: string | null;
  players: PlayerWithLink[];
}

function usePlayerLinks(players: PlayerRecord[]) {
  const [data, setData] = useState<PlayersResponse | null>(null);
  const key = players.map((p) => `${p.id}:${p.name}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the live player set changes
  useEffect(() => {
    let cancelled = false;
    void dmCall<PlayersResponse>(api.api.players.$get())
      .then((r) => {
        if (!cancelled && r) setData(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return data;
}

export function PlayersPanel() {
  const players = useRecords<PlayerRecord>("player");
  const presence = useRecords<PresenceRecord>("presence");
  const live = useSync((s) => s.state === "live");
  const links = usePlayerLinks(players);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const base = links?.publicBaseUrl ?? window.location.origin;
  const online = new Set(presence.filter((p) => p.online).map((p) => p.playerId));
  const tokenOf = (id: string) => links?.players.find((p) => p.id === id)?.linkToken;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = PlayerName.safeParse(newName);
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    try {
      await dmCall(api.api.players.$post({ json: { name: parsed.data } }));
      setNewName("");
      setAddError(null);
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(playerLinkUrl(base, token));
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    // The `camp.players` window body (its title says "Players"). Rows scroll; the add-player
    // row and the link base / loopback warning are a pinned footer, so all of it shows at the
    // window's default size with two players (CAMP §7).
    <section data-testid="camp-players-panel" className="flex h-full min-h-fit flex-col gap-2">
      <div className="min-h-9 flex-1 overflow-y-auto">
        {players.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="camp-players-empty">
            Add a player to get a link.
          </p>
        ) : (
          <Table data-testid="camp-players-table" aria-label="Players">
            <TableBody>
              {players.map((p) => {
                const token = tokenOf(p.id);
                const isOnline = online.has(p.id);
                return (
                  <TableRow key={p.id} data-testid="camp-player-row" data-record-id={p.id}>
                    {/* Name takes the free width, one line; long names truncate. */}
                    <TableCell
                      data-testid="camp-player-name"
                      title={p.name}
                      className="w-full max-w-0 truncate whitespace-nowrap px-1 py-1 font-medium"
                    >
                      {p.name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-1 py-1">
                      <span
                        data-testid="camp-player-online"
                        data-online={isOnline}
                        className="inline-flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            isOnline ? "bg-success" : "bg-muted-foreground/40",
                          )}
                        />
                        {isOnline ? "online" : "offline"}
                      </span>
                    </TableCell>
                    <TableCell className="flex justify-end gap-1 whitespace-nowrap px-1 py-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        data-testid="camp-player-copy-link"
                        data-link={token ? playerLinkUrl(base, token) : undefined}
                        disabled={!token}
                        onClick={() => token && void copy(token)}
                      >
                        <CopyIcon className="size-3.5" /> Copy link
                      </Button>
                      <NameDialog
                        title="Rename player"
                        label="Name"
                        schema={PlayerName}
                        initial={p.name}
                        testId="camp-player-rename"
                        submitLabel="Rename"
                        disabled={!live}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7">
                            Rename
                          </Button>
                        }
                        onSubmit={async (name) => {
                          await dmCall(
                            api.api.players[":id"].$patch({ param: { id: p.id }, json: { name } }),
                          );
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <form className="flex gap-2" onSubmit={add}>
          <Input
            data-testid="camp-player-add-name"
            placeholder="Player name"
            className="h-8"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setAddError(null);
            }}
            aria-invalid={addError !== null}
          />
          <Button data-testid="camp-player-add-submit" type="submit" size="sm" disabled={!live}>
            Add player
          </Button>
        </form>
        {addError && (
          <p className="text-sm text-destructive" data-testid="camp-player-add-error">
            {addError}
          </p>
        )}
        {isLoopbackUrl(base) ? (
          <Alert
            variant="warning"
            data-testid="camp-players-loopback-warning"
            className="px-2 py-1 text-xs"
          >
            Links use <span data-testid="camp-players-base-url">{base}</span>: this computer only.
            Set PP_PUBLIC_BASE_URL to your tunnel URL for players elsewhere.
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground">
            Links use <span data-testid="camp-players-base-url">{base}</span>
          </p>
        )}
      </div>
    </section>
  );
}
