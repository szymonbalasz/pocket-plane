// DM `party.handout` (FR-PARTY-14–16): the viewer with the DM extras (share Badge, Edit, Share…,
// Share with everyone, Unshare), or the editor (Edit / New handout).
import {
  type HandoutBodyRecord,
  type HandoutRecord,
  NOT_SHARED,
  type SharedWith,
} from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { ShareBadge } from "@ui/features/party-board/HandoutList";
import { LOST_SHARE } from "@ui/features/party-board/logic";
import { handoutSelection, selectHandout } from "@ui/features/party-board/selection";
import { HandoutArticle, HandoutBody, type LoadedHandout } from "@ui/features/party-board/Viewer";
import { partyHandoutWindowBase } from "@ui/features/party-board/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useState } from "react";
import { useStore } from "zustand";
import { useShareLabel } from "./board-window";
import { HandoutEditor } from "./Editor";
import { ShareDialog } from "./ShareDialog";
import { useIntent, useLive } from "./send";

const EVERYONE: SharedWith = { mode: "all", playerIds: [] };

function DmExtras({ h }: { h: HandoutRecord }) {
  const live = useLive();
  const label = useShareLabel();
  const [sharing, setSharing] = useState(false);
  const share = useIntent(LOST_SHARE);
  const shared = h.sharedWith.mode !== "none";
  const send = (sharedWith: SharedWith) =>
    share.send("party.shareHandout", { handoutId: h.id, sharedWith });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <ShareBadge label={label(h)} muted={!shared} />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          data-testid="party-handout-edit"
          onClick={() => selectHandout(h.id, "edit")}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          data-testid="party-share-open"
          disabled={!live}
          onClick={() => setSharing(true)}
        >
          Share…
        </Button>
        {h.sharedWith.mode !== "all" && (
          <Button
            size="sm"
            className="h-7 px-2"
            data-testid="party-share-everyone"
            disabled={!live || share.busy}
            onClick={() => send(EVERYONE)}
          >
            Share with everyone
          </Button>
        )}
        {shared && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            data-testid="party-handout-unshare"
            disabled={!live || share.busy}
            onClick={() => send(NOT_SHARED)}
          >
            Unshare
          </Button>
        )}
      </div>
      {share.error && (
        <p data-testid="party-share-error" role="alert" className="text-xs text-destructive">
          {share.error}
        </p>
      )}
      <ShareDialog handout={h} open={sharing} onOpenChange={setSharing} />
    </div>
  );
}

const dmLoaded = (l: LoadedHandout) =>
  ({ header: l.header as HandoutRecord, body: l.body as HandoutBodyRecord }) as const;

function DmHandout() {
  const { handoutId, mode } = useStore(handoutSelection);
  if (mode === "new") {
    return (
      <HandoutEditor
        key="new"
        stored={null}
        onSaved={(id) => selectHandout(id)}
        onCancel={() => handoutSelection.setState({ mode: "view" })}
      />
    );
  }
  return (
    <HandoutBody
      handoutId={handoutId}
      render={(l) =>
        mode === "edit" ? (
          <HandoutEditor
            key={`edit:${l.header.id}`}
            stored={dmLoaded(l)}
            onSaved={(id) => selectHandout(id)}
            onCancel={() => selectHandout(l.header.id)}
          />
        ) : (
          <HandoutArticle loaded={l} extras={<DmExtras h={dmLoaded(l).header} />} />
        )
      }
    />
  );
}

export const dmHandoutWindow = defineWindow({
  ...partyHandoutWindowBase,
  clients: ["dm"],
  component: DmHandout,
});
