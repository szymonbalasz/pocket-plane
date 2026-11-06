// Player entry popup (FR-CMP-80, -83; DM #458): while the store holds the viewer's own
// `entry-present` row (live event or snapshot), a modal Dialog over every window and toast (the
// handout popup's layer, PRESENT_POPUP_Z) shows that compendium entry: its images large (Prev /
// Next), then the entry's view (no actions row). Close, Esc, a click outside or "Open in
// Compendium" hide it at once and send `cmp.closeEntryPresent`; a close that never reached the
// server shows again after the next snapshot. A presented handout goes first: this popup waits
// until it is closed. Under the pause card it waits too (shown at resume, as FR-PARTY-36).
import {
  ENTRY_PRESENT_INTENTS,
  ENTRY_PRESENT_TYPE,
  type EntryPresentRecord,
} from "@shared/compendium/present";
import { HANDOUT_PRESENT_TYPE, type HandoutPresentRecord } from "@shared/party-board/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@ui/components/ui/overlays";
import { Skeleton } from "@ui/components/ui/primitives";
import { readError, useEntry } from "@ui/features/compendium/fetch";
import { EntryGalleryOff } from "@ui/features/compendium/gallery";
import { CMP_ENTRY_KIND } from "@ui/features/compendium/logic";
import { popoutInstance } from "@ui/features/compendium/popout";
import { EntryView } from "@ui/features/compendium/views";
import { LOAD_FAILED } from "@ui/features/party-board/logic";
import {
  hidePresent,
  PRESENT_POPUP_Z,
  presentHides,
  shownPresent,
} from "@ui/features/party-board/present-logic";
import { usePaused } from "@ui/features/pause/hooks";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useRecords, useSync } from "@ui/sync/store";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Images } from "../party-board/present-popup";
import { playerApi } from "./compendium-window";

/** `readError`'s copy for a 404: the entry is no longer readable by this player. */
const GONE = readError(new ApiError(404, null));

/** The popup's title bar: an award for items, else the plain word. */
export const entryPresentTitle = (kind: string) =>
  kind === "item" ? "The party receives" : "From the DM";

export function PlayerEntryPresentPopup() {
  const you = useSync((s) => s.store.you);
  const rows = useRecords<EntryPresentRecord>(ENTRY_PRESENT_TYPE);
  const handouts = useRecords<HandoutPresentRecord>(HANDOUT_PRESENT_TYPE);
  const generation = useSync((s) => s.lazy.generation);
  const hides = useStore(presentHides, (s) => s.hides);
  const paused = usePaused();
  const present = entryPresentToShow(rows, handouts, you, hides, generation, paused);
  return present ? <Shown key={present.id} present={present} /> : null;
}

/**
 * The viewer's entry present to show now: none for the DM, none while paused (shown at resume),
 * none while a presented handout shows (one popup at a time; the handout goes first).
 */
export function entryPresentToShow(
  rows: readonly EntryPresentRecord[],
  handouts: readonly HandoutPresentRecord[],
  you: { role: string; playerId: string | null } | null,
  hides: Parameters<typeof shownPresent>[2],
  generation: number,
  paused: boolean,
): EntryPresentRecord | null {
  if (you?.role !== "player" || paused) return null;
  if (shownPresent(handouts, you.playerId, hides, generation)) return null;
  return shownPresent(rows, you.playerId, hides, generation);
}

function Shown({ present }: { present: EntryPresentRecord }) {
  const connection = useSync((s) => s.connection);
  const generation = useSync((s) => s.lazy.generation);
  const openWindow = useOpenWindow();
  const [nonce, setNonce] = useState(0);
  const read = useEntry(playerApi(), present.entryId, nonce);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    hidePresent(present.id, generation);
    connection.sendIntent(ENTRY_PRESENT_INTENTS.close, { presentId: present.id }).catch(() => {});
  };
  const gone = read.state === "error" && read.error === GONE;
  // The entry is gone for this player (unshared, deleted): close silently.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes once when it turns gone
  useEffect(() => {
    if (gone) close();
  }, [gone]);
  if (gone) return null;
  const data = read.state === "ready" ? read.data : null;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        data-testid="cmp-present-popup"
        data-record-id={present.entryId}
        data-present-id={present.id}
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-[min(90vw,48rem)] max-w-none flex-col gap-3"
        zIndex={PRESENT_POPUP_Z}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          closeRef.current?.focus();
        }}
      >
        <DialogTitle data-testid="cmp-present-title" className="pr-2 text-lg font-semibold">
          {data ? entryPresentTitle(data.entry.kind) : "Compendium"}
        </DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {read.state === "loading" && (
            <div data-testid="cmp-present-loading" className="flex flex-col gap-2">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {read.state === "error" && (
            <div>
              <Button
                size="sm"
                variant="outline"
                data-testid="cmp-present-retry"
                onClick={() => setNonce((n) => n + 1)}
              >
                {LOAD_FAILED}
              </Button>
            </div>
          )}
          {data && (
            <>
              <Images ids={data.entry.imageAssetIds} title={data.entry.name} prefix="cmp-present" />
              <EntryGalleryOff.Provider value={true}>
                <EntryView data={data} viewer="player" bare />
              </EntryGalleryOff.Provider>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            data-testid="cmp-present-open"
            disabled={!data}
            onClick={() => {
              openWindow(
                CMP_ENTRY_KIND,
                popoutInstance({ mode: "entry", entryId: present.entryId }),
                { by: "user" },
              );
              close();
            }}
          >
            Open in Compendium
          </Button>
          <Button ref={closeRef} size="sm" data-testid="cmp-present-close" onClick={close}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
