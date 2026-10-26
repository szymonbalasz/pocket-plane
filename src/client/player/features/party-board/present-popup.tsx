// Player present popup (FR-PARTY-36, -37): while the store holds the viewer's own
// `handout-present` row (live event or snapshot), a modal Dialog over every window and toast
// (under the dice layer) shows that handout: title, images one at a time (Prev / Next), the body
// through `DiceText`. Close, Esc, a click outside or "Open in Party Manager" hide it at once and send
// `party.closePresent`; a close that never reached the server shows again after the next snapshot.
// Mounted by one line in the player play page (seams S4); not a window. *(Sprint 8, TT4)* Under the
// pause card it waits: shown at resume (FR-SHELL-127, a deferred feature open).
import type { NotificationRecord } from "@shared/notifications/schemas";
import { HANDOUT_PRESENT_TYPE, type HandoutPresentRecord } from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@ui/components/ui/overlays";
import { Skeleton } from "@ui/components/ui/primitives";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { DiceText } from "@ui/features/dice-extras/DiceText";
import { NOTIFICATION_TYPE } from "@ui/features/notifications/logic";
import { hideToast } from "@ui/features/notifications/toasts";
import { useOpenHandout } from "@ui/features/party-board/HandoutList";
import { LOAD_FAILED } from "@ui/features/party-board/logic";
import { markSeen, useSeenRevs } from "@ui/features/party-board/player-seen";
import {
  contentState,
  hidePresent,
  PRESENT_POPUP_Z,
  pageText,
  presentHides,
  sharedNoteIds,
  shownPresent,
  stepPage,
} from "@ui/features/party-board/present-logic";
import { type LoadedHandout, useHandout } from "@ui/features/party-board/Viewer";
import { usePaused } from "@ui/features/pause/hooks";
import { useRecords, useSync } from "@ui/sync/store";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ElementType, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

/** Hides the row for this snapshot generation and sends the close (errors: shown again later). */
function useClosePresent() {
  const connection = useSync((s) => s.connection);
  const generation = useSync((s) => s.lazy.generation);
  return useCallback(
    (presentId: string) => {
      hidePresent(presentId, generation);
      connection.sendIntent("party.closePresent", { presentId }).catch(() => {});
    },
    [connection, generation],
  );
}

export function PlayerPresentPopup() {
  const you = useSync((s) => s.store.you);
  const rows = useRecords<HandoutPresentRecord>(HANDOUT_PRESENT_TYPE);
  const generation = useSync((s) => s.lazy.generation);
  const hides = useStore(presentHides, (s) => s.hides);
  // From the store, not the gate: a page loaded paused never paints it (the gate closes later).
  const paused = usePaused();
  const present = presentToShow(rows, you, hides, generation, paused);
  return present ? <Shown present={present} /> : null;
}

/** The viewer's present to show now: none for the DM, and none while paused (shown at resume). */
export function presentToShow(
  rows: readonly HandoutPresentRecord[],
  you: { role: string; playerId: string | null } | null,
  hides: Parameters<typeof shownPresent>[2],
  generation: number,
  paused: boolean,
): HandoutPresentRecord | null {
  if (you?.role !== "player" || paused) return null;
  return shownPresent(rows, you.playerId, hides, generation);
}

function Shown({ present }: { present: HandoutPresentRecord }) {
  const { state, loaded, retry } = useHandout(present.handoutId);
  const view = contentState({ state, loaded: loaded !== null });
  const close = useClosePresent();
  const openHandout = useOpenHandout();
  const notes = useRecords<NotificationRecord>(NOTIFICATION_TYPE);
  const closeRef = useRef<HTMLButtonElement>(null);
  useSeenRevs(); // binds this viewer's seen map
  // A load without the id: the handout is gone for this player → close silently.
  useEffect(() => {
    if (view === "gone") close(present.id);
  }, [view, close, present.id]);
  // Opening marks it seen (FR-PARTY-13).
  const rev = loaded?.header.rev;
  useEffect(() => {
    if (rev !== undefined) markSeen(present.handoutId, rev);
  }, [present.handoutId, rev]);
  // FR-NOTE-26: no "New handout" toast for the handout the popup shows.
  useEffect(() => {
    for (const id of sharedNoteIds(notes, present.handoutId)) hideToast(id);
  }, [notes, present.handoutId]);
  if (view === "gone") return null;
  return (
    // The shared Dialog parts (FR-KIT-70): the title is the title bar, its × closes as Close / Esc.
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close(present.id);
      }}
    >
      <DialogContent
        data-testid="party-present-popup"
        data-record-id={present.handoutId}
        data-present-id={present.id}
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-[min(90vw,64rem)] max-w-none flex-col gap-3"
        zIndex={PRESENT_POPUP_Z}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          closeRef.current?.focus();
        }}
      >
        <PresentContent
          key={present.id}
          state={view}
          loaded={loaded}
          onRetry={retry}
          onClose={() => close(present.id)}
          onOpenBoard={() => {
            openHandout(present.handoutId);
            close(present.id);
          }}
          closeRef={closeRef}
          TitleAs={DialogTitle}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The popup's inside (header, images + body, buttons); rendered without the Dialog in tests. */
export function PresentContent({
  state,
  loaded,
  onRetry,
  onClose,
  onOpenBoard,
  closeRef,
  TitleAs = "h2",
}: {
  state: "loading" | "error" | "show";
  loaded: LoadedHandout | null;
  onRetry(): void;
  onClose(): void;
  onOpenBoard(): void;
  closeRef?: Ref<HTMLButtonElement>;
  TitleAs?: ElementType;
}) {
  const shown = state === "show" ? loaded : null;
  return (
    <>
      <TitleAs data-testid="party-present-title" className="pr-2 text-lg font-semibold break-words">
        {shown ? shown.header.title : "Handout"}
      </TitleAs>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {state === "loading" && (
          <div data-testid="party-present-loading" className="flex flex-col gap-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {state === "error" && (
          <div>
            <Button size="sm" variant="outline" data-testid="party-present-retry" onClick={onRetry}>
              {LOAD_FAILED}
            </Button>
          </div>
        )}
        {shown && <Images ids={shown.header.imageAssetIds} title={shown.header.title} />}
        {shown && shown.body.body !== "" && (
          <p data-testid="party-present-body" className="text-sm leading-relaxed break-words">
            <DiceText
              text={shown.body.body}
              context={{ label: shown.header.title, category: "other" }}
            />
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          data-testid="party-present-open-board"
          disabled={!shown}
          onClick={onOpenBoard}
        >
          Open in Party Manager
        </Button>
        <Button ref={closeRef} size="sm" data-testid="party-present-close" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

/** Images one at a time, fit inside 90 vw × 75 vh; > 1 → Prev / Next + "‹n› / ‹N›". */
function Images({ ids, title }: { ids: readonly string[]; title: string }) {
  const [i, setI] = useState(0);
  const n = ids.length;
  const at = Math.min(i, n - 1);
  const id = ids[at];
  if (!id) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div data-testid="party-present-image" data-record-id={id} className="flex justify-center">
        <AssetImg
          id={id}
          file="display"
          alt={`${title} — image ${at + 1}`}
          className="h-auto max-h-[75vh] min-h-24 w-auto max-w-full"
        />
      </div>
      {n > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label="Previous image"
            data-testid="party-present-prev"
            disabled={at === 0}
            onClick={() => setI(stepPage(at, -1, n))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span data-testid="party-present-page" className="tabular-nums text-muted-foreground">
            {pageText(at, n)}
          </span>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label="Next image"
            data-testid="party-present-next"
            disabled={at === n - 1}
            onClick={() => setI(stepPage(at, 1, n))}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
