// FR-MIR-16: the DM's mirror menu: the four display modes and Delete. A DOM island like scene-tools'
// `TemplateMenu`: the layer lives in the Konva tree, so it mounts this in its own React root under
// `document.body` (with the canvas' sync store). Closes on Esc, a click outside, or when the mirror
// goes. Items are disabled while not live.
import {
  MIR_INTENTS,
  TOKEN_MIRROR_TYPE,
  type TokenMirrorRecord,
} from "@shared/token-mirrors/schemas";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { SyncContext, type SyncStore, useSync } from "../../sync/store";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { closeMirrorMenu, MODE_LABELS, useMirrorMenu } from "./mirror-store";

export function MirrorMenu() {
  const open = useMirrorMenu((s) => s.open);
  const id = open?.mirrorId ?? null;
  const record = useSync((s) =>
    id === null
      ? undefined
      : (s.store.records[TOKEN_MIRROR_TYPE]?.[id] as TokenMirrorRecord | undefined),
  );
  const live = useLive();
  const send = useMapIntent();
  const gone = open !== null && !record;
  useEffect(() => {
    if (gone) closeMirrorMenu();
  }, [gone]);
  return (
    <DropdownMenu
      open={open !== null && record !== undefined}
      onOpenChange={(o) => !o && closeMirrorMenu()}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: open?.at.x ?? 0, top: open?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="mir-menu"
        data-record-id={id ?? undefined}
        // Opened on the release: the browser's `contextmenu` that follows may land on it.
        onContextMenu={(e) => e.preventDefault()}
      >
        {record &&
          MODE_LABELS.map(([mode, label]) => (
            <DropdownMenuItem
              key={mode}
              data-testid={`mir-menu-mode-${mode}`}
              data-current={record.mode === mode ? "true" : undefined}
              disabled={!live || record.mode === mode}
              onSelect={() => {
                closeMirrorMenu();
                send(MIR_INTENTS.setMode, { mirrorId: record.id, mode }).catch(toastReject);
              }}
            >
              {label}
            </DropdownMenuItem>
          ))}
        {record && (
          <DropdownMenuItem
            data-testid="mir-menu-delete"
            variant="destructive"
            disabled={!live}
            onSelect={() => {
              closeMirrorMenu();
              send(MIR_INTENTS.delete, { mirrorId: record.id }).catch(toastReject);
            }}
          >
            Delete mirror
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounts `MirrorMenu` in its own root for the canvas' lifetime (rendered from the Konva tree). */
export function useMirrorMenuIsland(sync: SyncStore | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !sync || typeof document === "undefined") return;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(
      <SyncContext.Provider value={sync}>
        <MirrorMenu />
      </SyncContext.Provider>,
    );
    return () => {
      closeMirrorMenu();
      // Not during the commit that unmounts the canvas (React warns on a synchronous unmount).
      setTimeout(() => {
        root.unmount();
        el.remove();
      });
    };
  }, [sync, enabled]);
}
