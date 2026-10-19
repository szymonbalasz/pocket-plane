// FR-SCN-48 / -50 kept-template menu (both clients, right-click a template this client may edit,
// under any tool; FR-MAP-71): Delete, Edit… and (DM) Hide / Reveal, no confirm. A DOM island like
// `DoorMenu`: the templates layer lives in the Konva tree, so it mounts this menu in its own React
// root under `document.body` (with the canvas' sync store). Closes on Esc, a click outside, or when
// its template leaves what this client may edit on the shown scene (deleted, cleared, hidden for
// this player, scene switch, snapshot). Items are disabled while not live.
import {
  AOE_TEMPLATE_TYPE,
  SCN_INTENTS,
  type TemplateRecordView,
} from "@shared/scene-tools/schemas";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { IntentRejected } from "../../sync/connection";
import { SyncContext, type SyncStore, useSync } from "../../sync/store";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { useMapTool } from "../scenes-map/tool-store";
import { closeTemplateMenu, editFromMenu, useAoe, useTemplateMenu } from "./aoe-store";
import { templateMenuItems, templateMenuStays } from "./templates";

/** FR-SCN-50: `not_found` (already gone) → "Template already removed"; else the usual Toast. */
export function deleteReject(err: unknown): void {
  if (err instanceof IntentRejected && err.code === "not_found") {
    toast.error("Template already removed");
    return;
  }
  toastReject(err);
}

export function TemplateMenu() {
  const open = useTemplateMenu((s) => s.open);
  const id = open?.templateId ?? null;
  const record = useSync((s) =>
    id === null
      ? undefined
      : (s.store.records[AOE_TEMPLATE_TYPE]?.[id] as TemplateRecordView | undefined),
  );
  // What this client may edit on the shown scene (the templates layer keeps it fresh).
  const stays = useAoe((s) => templateMenuStays(open, s.editable, s.sceneId));
  const client = useMapTool((s) => s.client);
  const myPlayerId = useSync((s) => (s.store.you?.role === "player" ? s.store.you.playerId : null));
  const live = useLive();
  const send = useMapIntent();
  const gone = open !== null && (!stays || !record);
  useEffect(() => {
    if (gone) closeTemplateMenu();
  }, [gone]);
  const shown = open !== null && !gone && record !== undefined;
  const items = shown && client ? templateMenuItems(record, client, myPlayerId, live) : [];
  return (
    <DropdownMenu open={shown} onOpenChange={(o) => !o && closeTemplateMenu()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: open?.at.x ?? 0, top: open?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="scn-template-ctx"
        data-record-id={id ?? undefined}
        // Opened on the release: the browser's `contextmenu` that follows may land on it.
        onContextMenu={(e) => e.preventDefault()}
      >
        {record &&
          items.map(({ item, label, disabled }) => (
            <DropdownMenuItem
              key={item}
              data-testid={`scn-template-ctx-${item}`}
              data-hidden={item === "hide" ? String(record.hidden) : undefined}
              disabled={disabled}
              variant={item === "delete" ? "destructive" : undefined}
              onSelect={() => {
                if (item === "edit") {
                  editFromMenu(record.id);
                  return;
                }
                closeTemplateMenu();
                if (item === "delete") {
                  // FR-SCN-50: not optimistic; `TemplateDeleted` removes it everywhere.
                  if (useAoe.getState().selectedId === record.id)
                    useAoe.setState({ selectedId: null });
                  send(SCN_INTENTS.deleteTemplate, { templateId: record.id }).catch(deleteReject);
                } else {
                  send(SCN_INTENTS.updateTemplate, {
                    templateId: record.id,
                    hidden: !record.hidden,
                  }).catch(toastReject);
                }
              }}
            >
              {label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounts `TemplateMenu` in its own root for the canvas' lifetime (rendered from the Konva tree). */
export function useTemplateMenuIsland(sync: SyncStore | null): void {
  useEffect(() => {
    if (!sync || typeof document === "undefined") return;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(
      <SyncContext.Provider value={sync}>
        <TemplateMenu />
      </SyncContext.Provider>,
    );
    return () => {
      closeTemplateMenu();
      // Not during the commit that unmounts the canvas (React warns on a synchronous unmount).
      setTimeout(() => {
        root.unmount();
        el.remove();
      });
    };
  }, [sync]);
}
