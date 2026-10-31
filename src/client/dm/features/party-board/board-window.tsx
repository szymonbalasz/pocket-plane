// DM `party.board` (FR-PARTY-11, -12): "New handout", every handout incl. unshared prep, newest
// first; row: thumb, title, share Badge ("Not shared" / "Everyone" / player names), Updated time;
// row menu Edit, Share…, Unshare (while shared), Delete (inline confirm). *(S5)* "Open on
// screens…" (shared only) and the "On screen: ‹n›" Badge (FR-PARTY-38). *(S6, S9)* Party status:
// New pet… and the pet row menu (FR-PARTY-43, -62, `companion-menu.tsx`).
import { dmShareLabel } from "@shared/party-board/format";
import { type HandoutRecord, NOT_SHARED } from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import { Tip } from "@ui/components/ui/tip";
import { timeOf } from "@ui/features/notifications/parts";
import { PartyBoard } from "@ui/features/party-board/Board";
import {
  HandoutListBody,
  HandoutRow,
  ShareBadge,
  useHandoutHeaders,
} from "@ui/features/party-board/HandoutList";
import {
  dmOrder,
  LOST_DELETE,
  LOST_SHARE,
  PARTY_HANDOUT_KIND,
} from "@ui/features/party-board/logic";
import { RowError } from "@ui/features/party-board/RowError";
import { selectHandout, startNewHandout } from "@ui/features/party-board/selection";
import { partyBoardWindowBase } from "@ui/features/party-board/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { EllipsisVerticalIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { dmCompanionParts } from "./companion-menu";
import { OnScreenBadge, PresentDialog } from "./present";
import { ShareDialog, usePlayers } from "./ShareDialog";
import { useIntent, useLive } from "./send";

/** Player names for the share Badge; unknown ids skipped. */
export function useShareLabel() {
  const players = usePlayers();
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  return (h: HandoutRecord) => dmShareLabel(h.sharedWith, (id) => names.get(id));
}

function RowMenu({ h }: { h: HandoutRecord }) {
  const live = useLive();
  const openWindow = useOpenWindow();
  const [sharing, setSharing] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const unshare = useIntent(LOST_SHARE);
  const del = useIntent(LOST_DELETE);
  const shared = h.sharedWith.mode !== "none";
  const error = unshare.error ?? del.error;
  if (confirm) {
    return (
      <span className="flex items-center gap-1">
        <Button
          size="sm"
          variant="destructive"
          className="h-7 px-2"
          data-testid="party-handout-delete-confirm"
          disabled={!live || del.busy}
          onClick={async () => {
            if (await del.send("party.deleteHandout", { handoutId: h.id })) setConfirm(false);
          }}
        >
          Delete
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirm(false)}>
          Keep
        </Button>
      </span>
    );
  }
  return (
    <>
      {error && <RowError>{error}</RowError>}
      <DropdownMenu>
        <Tip content={`Actions for ${h.title}`}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={`Actions for ${h.title}`}
              data-testid="party-handout-menu"
            >
              <EllipsisVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            data-testid="party-handout-edit"
            onSelect={() => {
              selectHandout(h.id, "edit");
              openWindow(PARTY_HANDOUT_KIND);
            }}
          >
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="party-share-open"
            disabled={!live}
            onSelect={() => setSharing(true)}
          >
            Share…
          </DropdownMenuItem>
          {shared && (
            <DropdownMenuItem
              data-testid="party-present-open"
              data-record-id={h.id}
              disabled={!live}
              onSelect={() => setPresenting(true)}
            >
              Open on screens…
            </DropdownMenuItem>
          )}
          {shared && (
            <DropdownMenuItem
              data-testid="party-handout-unshare"
              disabled={!live || unshare.busy}
              onSelect={() =>
                unshare.send("party.shareHandout", { handoutId: h.id, sharedWith: NOT_SHARED })
              }
            >
              Unshare
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            data-testid="party-handout-delete"
            disabled={!live}
            onSelect={() => setConfirm(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog handout={h} open={sharing} onOpenChange={setSharing} />
      <PresentDialog handout={h} open={presenting} onOpenChange={setPresenting} />
    </>
  );
}

function DmHandouts() {
  const headers = useHandoutHeaders();
  const live = useLive();
  const openWindow = useOpenWindow();
  const label = useShareLabel();
  const rows = useMemo(() => dmOrder(headers.rows as HandoutRecord[]), [headers.rows]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div>
        <Button
          size="sm"
          data-testid="party-handout-create"
          disabled={!live}
          onClick={() => {
            startNewHandout();
            openWindow(PARTY_HANDOUT_KIND);
          }}
        >
          <PlusIcon className="size-4" />
          New handout
        </Button>
      </div>
      <HandoutListBody headers={headers}>
        {rows.map((h) => (
          <HandoutRow
            key={h.id}
            h={h}
            badge={<ShareBadge label={label(h)} muted={h.sharedWith.mode === "none"} />}
            sub={
              <>
                <span>Updated {timeOf(h.updatedAt).short}</span>
                <OnScreenBadge handoutId={h.id} />
              </>
            }
            menu={<RowMenu h={h} />}
          />
        ))}
      </HandoutListBody>
    </div>
  );
}

function DmPartyBoard() {
  return <PartyBoard parts={{ handouts: <DmHandouts />, companions: dmCompanionParts }} />;
}

export const dmPartyBoardWindow = defineWindow({
  ...partyBoardWindowBase,
  clients: ["dm"],
  component: DmPartyBoard,
});
