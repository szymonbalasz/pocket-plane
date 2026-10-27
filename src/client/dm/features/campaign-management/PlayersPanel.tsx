// Players panel: name, online dot, copy link, rename; add player (CAMP §7, FR-CAMP-12–15).
// Under each player, their characters at a glance; a line opens the sheet (FR-CAMP-21/22, N3).
// Colour swatches: the DM's own above the table, one per player row, each opening the colour
// picker in a Popover (FR-CAMP-35). Sprint 7: "Options" opens Campaign options (FR-CAMP-42);
// with gems on, each character line gains its gem counts (FR-CAMP-43).
import {
  isLoopbackUrl,
  PlayerName,
  type PlayerRecord,
  type PlayerWithLink,
  playerLinkUrl,
} from "@shared/campaign-management/schemas";
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import {
  Alert,
  Badge,
  Input,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@ui/components/ui/primitives";
import { ColorPickerPopover } from "@ui/features/campaign-management/ColorPicker";
import { PartyLineGems } from "@ui/features/gems/GemCounts";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { cn } from "@ui/lib/utils";
import { onlineDot } from "@ui/sync/presence";
import { usePresence, useRecords, useSync } from "@ui/sync/store";
import { CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CampaignOptions } from "./CampaignOptions";
import { NameDialog } from "./NameDialog";
import {
  hpText,
  openPartyLine,
  type PartyCharacter,
  type PartyLine,
  partyLines,
  passiveTitle,
  tempText,
} from "./party-lines";
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

/**
 * K10 (K6 §5): a stat on the party line, "AC 16": its label muted (label type in a theme), kept
 * whole when the line wraps.
 */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <span data-slot="party-line-label" className="text-muted-foreground">
        {label}
      </span>{" "}
      {children}
    </span>
  );
}

/**
 * FR-CAMP-21/22: one compact line; the whole line opens the DM's sheet on it. K10 (K6 §5): the
 * stats spaced apart, no "·" between them.
 */
function CharacterLine({ line }: { line: PartyLine }) {
  const openWindow = useOpenWindow();
  const temp = tempText(line.temp);
  return (
    <button
      type="button"
      data-testid="camp-player-char"
      data-record-id={line.id}
      className="flex w-full flex-wrap items-center gap-x-2.5 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => openPartyLine(line.id, openWindow)}
    >
      <span className="max-w-32 truncate font-medium" title={line.name}>
        {line.name}
      </span>
      {line.draft && (
        <Badge
          data-testid="camp-player-char-draft"
          variant="outline"
          className="-ml-1 h-4 px-1 text-[10px]"
        >
          Draft
        </Badge>
      )}
      <Stat label="Lvl">
        <span data-testid="camp-player-char-level" className="tabular-nums">
          {line.level ?? "—"}
        </span>
      </Stat>
      <Stat label="AC">
        <span data-testid="camp-player-char-ac" className="tabular-nums">
          {line.ac ?? "—"}
        </span>
      </Stat>
      <Stat label="HP">
        <span
          data-testid="camp-player-char-hp"
          data-down={line.down}
          className={cn("tabular-nums", line.down && "text-hp-down")}
        >
          {hpText(line)}
        </span>
        {line.down && <span className="text-hp-down"> Down</span>}
        {temp && (
          <span data-testid="camp-player-char-temp" className="tabular-nums">
            {" "}
            {temp}
          </span>
        )}
      </Stat>
      {line.passives.map((p) => (
        <Tooltip key={p.skill} content={passiveTitle(p)}>
          <span>
            <Stat label={p.short}>
              <span
                data-testid={`camp-player-char-${p.short.toLowerCase()}`}
                data-overridden={p.overridden}
                className="tabular-nums"
              >
                {p.value ?? "—"}
              </span>
            </Stat>
          </span>
        </Tooltip>
      ))}
      <PartyLineGems characterId={line.id} />
    </button>
  );
}

export function PlayersPanel() {
  const players = useRecords<PlayerRecord>("player");
  const presence = usePresence();
  const live = useSync((s) => s.state === "live");
  const links = usePlayerLinks(players);
  const entities = useRecords<PartyCharacter>(ENTITY_TYPE);
  const sheets = useRecords<CreatureSheetRecord>(CREATURE_SHEET_TYPE);
  const lines = useMemo(() => {
    const drafts = new Set(sheets.filter((s) => s.status === "draft").map((s) => s.entityId));
    return partyLines(entities, drafts);
  }, [entities, sheets]);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const base = links?.publicBaseUrl ?? window.location.origin;
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
    <section data-testid="camp-players-panel" className="flex h-full min-h-fit flex-col gap-1">
      <div className="min-h-9 flex-1 overflow-y-auto">
        {/* One 16 px line: two players' rows still fit the default window unscrolled. */}
        <div className="flex h-4 items-center gap-1.5 px-1 text-xs">
          Your colour (DM)
          <ColorPickerPopover target={null} testId="camp-color-dm" tip="Your colour (DM)" />
          <span className="ml-auto">
            <CampaignOptions />
          </span>
        </div>
        {players.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="camp-players-empty">
            Add a player to get a link.
          </p>
        ) : (
          <Table data-testid="camp-players-table" aria-label="Players">
            <TableBody>
              {players.map((p) => {
                const token = tokenOf(p.id);
                const dot = onlineDot(presence, p.id);
                const own = lines.get(p.id) ?? [];
                return (
                  <Fragment key={p.id}>
                    <TableRow data-testid="camp-player-row" data-record-id={p.id}>
                      <TableCell className="w-0 py-1 pr-0 pl-1">
                        <ColorPickerPopover
                          target={p.id}
                          testId="camp-player-color"
                          recordId={p.id}
                          tip={`${p.name}'s colour`}
                        />
                      </TableCell>
                      {/* Name takes the free width, one line; long names truncate. */}
                      <TableCell
                        data-testid="camp-player-name"
                        title={p.name}
                        className="w-full max-w-0 truncate whitespace-nowrap px-1 py-1 font-medium"
                      >
                        {p.name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-1 py-1">
                        {/* Presence unknown while not live: no dot, muted "–" (FR-SYNC-29). */}
                        <span
                          data-testid="camp-player-online"
                          data-online={dot === "unknown" ? undefined : dot === "online"}
                          data-state={dot === "unknown" ? "unknown" : "known"}
                          className="inline-flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          {dot === "unknown" ? (
                            <>
                              <span aria-hidden>–</span>
                              <span className="sr-only">Unknown while reconnecting</span>
                            </>
                          ) : (
                            <>
                              <span
                                className={cn(
                                  "size-2 rounded-full",
                                  dot === "online" ? "bg-success" : "bg-muted-foreground/40",
                                )}
                              />
                              {dot}
                            </>
                          )}
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
                              api.api.players[":id"].$patch({
                                param: { id: p.id },
                                json: { name },
                              }),
                            );
                          }}
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4} className="px-1 pt-0 pb-1 pl-3">
                        {own.length === 0 ? (
                          <span
                            data-testid="camp-player-nochar"
                            className="text-xs text-muted-foreground"
                          >
                            No character yet
                          </span>
                        ) : (
                          own.map((l) => <CharacterLine key={l.id} line={l} />)
                        )}
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
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
          // K10 (K6 §5): the kit's alert (a ruled box, body text), the warning colour on its icon
          // only.
          <Alert
            data-testid="camp-players-loopback-warning"
            className="flex items-start gap-1.5 px-2 py-1 text-xs"
          >
            <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
            <span>
              Links use <span data-testid="camp-players-base-url">{base}</span>: this computer only.
              Set PP_PUBLIC_BASE_URL to your tunnel URL for players elsewhere.
            </span>
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
