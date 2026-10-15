// FR-SCN-09 door menu (DM, right-click a door): Open, Close, Lock, Unlock, Delete, as fits the
// door's state. A DOM island: the structure layer lives in the Konva tree, so it mounts this
// menu in its own React root under `document.body` (with the canvas' sync store).
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { SyncContext, type SyncStore } from "../../sync/store";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { removeEdit, setDoorEdit } from "./structure-edits";
import { doorMenu, shownStructure } from "./structure-store";
import { type DoorMenuItem, doorMenuItems } from "./structure-view";

const LABELS: Record<DoorMenuItem, string> = {
  open: "Open",
  close: "Close",
  lock: "Lock",
  unlock: "Unlock",
  delete: "Delete",
};

const close = () => doorMenu.setState({ open: null });

export function DoorMenu() {
  const open = useStore(doorMenu, (s) => s.open);
  const sceneId = useStore(shownStructure, (s) => s.sceneId);
  const live = useLive();
  const send = useMapIntent();
  const shown = open !== null && live && open.sceneId === sceneId;
  return (
    <DropdownMenu open={shown} onOpenChange={(o) => !o && close()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: open?.at.x ?? 0, top: open?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="scn-door-menu"
        data-record-id={open ? `door-${open.n}` : undefined}
      >
        {open &&
          doorMenuItems(open.state).map(({ item, state }) => (
            <DropdownMenuItem
              key={item}
              data-testid={`scn-door-menu-${item}`}
              variant={item === "delete" ? "destructive" : undefined}
              onSelect={() => {
                close();
                const edit =
                  state === null
                    ? removeEdit(send, open.sceneId, shownStructure.getState().view, [open.n])
                    : setDoorEdit(send, open.sceneId, open.n, open.state, state);
                edit.catch(toastReject);
              }}
            >
              {LABELS[item]}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounts `DoorMenu` in its own root for the canvas' lifetime (rendered from the Konva tree). */
export function useDoorMenuIsland(sync: SyncStore | null, on: boolean): void {
  useEffect(() => {
    if (!sync || !on || typeof document === "undefined") return;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(
      <SyncContext.Provider value={sync}>
        <DoorMenu />
      </SyncContext.Provider>,
    );
    return () => {
      close();
      // Not during the commit that unmounts the canvas (React warns on a synchronous unmount).
      setTimeout(() => {
        root.unmount();
        el.remove();
      });
    };
  }, [sync, on]);
}
