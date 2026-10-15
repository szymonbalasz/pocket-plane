// DM base layer (viewed scene, FR-MAP-08), selection + box select + targeting (FR-MAP-31–33),
// token menu host (FR-MAP-18/29), definition drops (FR-MAP-13), Ctrl-D (FR-MAP-17) and the DM
// tool rail extras (grid, lock, show to players).
import {
  MAP_INTENTS,
  SCENE_FOLDER_TYPE,
  SCENE_TYPE,
  type SceneFolderRecord,
  type SceneRecord,
  TOKEN_TYPE,
  type TokenRecord,
} from "@shared/scenes-map/schemas";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@ui/components/ui/menus";
import { Badge } from "@ui/components/ui/primitives";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { useBaseKeyDown } from "@ui/features/play-shell/hooks";
import { BaseEmpty } from "@ui/features/play-shell/PlayFrame";
import { toastReject, useLive, useMapIntent } from "@ui/features/scenes-map/intents";
import { LazyMapCanvas as MapCanvas } from "@ui/features/scenes-map/LazyMapCanvas";
import { useSceneLoaded } from "@ui/features/scenes-map/scene-window";
import { ToolRail } from "@ui/features/scenes-map/ToolRail";
import { useRecords } from "@ui/sync/store";
import { EyeOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GridTool, LockTool, ShowToPlayers } from "./DmTools";
import {
  dispatchSelection,
  getMapSelection,
  setMapSelection,
  useMapSelection,
  useTargeting,
} from "./selection";
import { doubleClickFor, menuFor } from "./token-menu";
import { useDmMap, viewedScene } from "./view-state";

/** The DM's viewed scene, resolved against the store (FR-MAP-08). */
export function useViewedScene(): { viewed: SceneRecord | null; active: SceneRecord | null } {
  const scenes = useRecords<SceneRecord>(SCENE_TYPE);
  const folders = useRecords<SceneFolderRecord>(SCENE_FOLDER_TYPE);
  const requested = useDmMap((s) => s.viewedSceneId);
  return useMemo(
    () => ({
      viewed: viewedScene(scenes, folders, requested),
      active: scenes.find((s) => s.active) ?? null,
    }),
    [scenes, folders, requested],
  );
}

type Open = { tokenId: string; at: { x: number; y: number } } | null;

export function DmMapBase() {
  const { viewed, active } = useViewedScene();
  // ADR-0041: viewing a scene other than the snapshot's active one loads its tokens first.
  const loaded = useSceneLoaded(viewed?.id ?? null);
  const tokens = useRecords<TokenRecord>(TOKEN_TYPE);
  const selection = useMapSelection();
  const targeting = useTargeting();
  const draft = useDmMap((s) => s.gridDraft);
  const live = useLive();
  const send = useMapIntent();
  const [menu, setMenu] = useState<Open>(null);
  const [dialog, setDialog] = useState<{ entryId: string; tokenId: string } | null>(null);
  // A right-click on an unselected token selects it for its menu only: once the menu and any
  // dialog it opened close, the previous selection comes back (unless the DM changed it since),
  // so a token-menu action never leaves a stale selection for combat's attack popup (FR-CBT-33).
  const borrowed = useRef<{ prev: readonly string[]; tokenId: string } | null>(null);
  useEffect(() => {
    const b = borrowed.current;
    if (menu || dialog || !b) return;
    borrowed.current = null;
    const now = getMapSelection().tokenIds;
    if (now.length === 1 && now[0] === b.tokenId) setMapSelection(b.prev);
  }, [menu, dialog]);

  const onScene = useMemo(
    () => (viewed ? tokens.filter((t) => t.sceneId === viewed.id) : []),
    [tokens, viewed],
  );
  const byId = (id: string | null | undefined) => tokens.find((t) => t.id === id) ?? null;

  // FR-MAP-31: the selection belongs to the viewed scene; changing it clears; ids that leave
  // the store or the scene drop out (also after a reconnect snapshot).
  const viewedId = viewed?.id ?? null;
  useEffect(() => dispatchSelection({ type: "scene", sceneId: viewedId }), [viewedId]);
  useEffect(() => {
    dispatchSelection({ type: "prune", present: new Set(onScene.map((t) => t.id)) });
  }, [onScene]);

  // Keys inside windows never reach here (FR-SHELL-13).
  useBaseKeyDown((e) => {
    // FR-MAP-31: Esc clears (a box in progress takes Esc first, FR-MAP-32).
    if (e.key === "Escape") {
      dispatchSelection({ type: "clear" });
      return;
    }
    // FR-MAP-17: Ctrl-D with exactly one token selected.
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "d") return;
    e.preventDefault();
    const ids = getMapSelection().tokenIds;
    const t = ids.length === 1 ? byId(ids[0]) : null;
    if (!t || !live || t.sceneId !== viewed?.id) return;
    send(MAP_INTENTS.duplicateToken, { tokenId: t.id }).then(
      (r) => setMapSelection([(r as { tokenId: string }).tokenId]),
      toastReject,
    );
  });

  if (!viewed) return <BaseEmpty client="dm" />;
  const notShown = active?.id !== viewed.id;
  const menuToken = byId(menu?.tokenId);
  const dialogToken = byId(dialog?.tokenId);
  const entries = menuToken ? menuFor(menuToken) : [];
  const DialogC =
    dialog && dialogToken
      ? menuFor(dialogToken).find((e) => e.id === dialog.entryId)?.Dialog
      : undefined;

  return (
    <>
      <MapCanvas
        client="dm"
        scene={viewed}
        tokens={onScene}
        loading={!loaded}
        myPlayerId={null}
        signalsOn={!notShown}
        gridOverride={draft?.sceneId === viewed.id ? draft.grid : null}
        selectedTokenIds={selection.sceneId === viewed.id ? selection.tokenIds : []}
        targeting={targeting}
        onTokenClick={(t, toggle) =>
          dispatchSelection(toggle ? { type: "toggle", id: t.id } : { type: "click", id: t.id })
        }
        onEmptyClick={() => dispatchSelection({ type: "clear" })}
        onBoxSelect={(ids) => dispatchSelection({ type: "add", ids })}
        onTokenMenu={(t, at) => {
          const prev = getMapSelection().tokenIds;
          if (!prev.includes(t.id)) {
            borrowed.current = { prev: borrowed.current?.prev ?? prev, tokenId: t.id };
            setMapSelection([t.id]);
          }
          setMenu({ tokenId: t.id, at });
        }}
        onTokenDoubleClick={(t) => {
          const full = byId(t.id);
          const d = full && doubleClickFor(full);
          if (d && full) setDialog({ entryId: d.id, tokenId: full.id });
        }}
        onDropDefinition={(definitionId, cell) =>
          send(MAP_INTENTS.placeToken, { sceneId: viewed.id, definitionId, ...cell }).then(
            (r) => setMapSelection([(r as { tokenId: string }).tokenId]),
            toastReject,
          )
        }
      />
      {notShown && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{ top: TOP_BAR_H + 8 }}
        >
          <Badge variant="secondary" data-testid="map-not-shown-badge" className="gap-1">
            <EyeOffIcon className="size-3.5" /> Not shown to players
          </Badge>
        </div>
      )}
      <DropdownMenu
        open={menuToken !== null && live}
        onOpenChange={(o) => {
          if (!o) setMenu(null);
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-px"
            style={{ left: menu?.at.x ?? 0, top: menu?.at.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          data-testid="map-token-menu"
          data-record-id={menuToken?.id}
        >
          {menuToken &&
            entries.map((e) => (
              <e.Item
                key={e.id}
                token={menuToken}
                openDialog={() => {
                  setMenu(null);
                  setDialog({ entryId: e.id, tokenId: menuToken.id });
                }}
              />
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {DialogC && dialogToken && <DialogC token={dialogToken} close={() => setDialog(null)} />}
    </>
  );
}

export function DmMapToolRail() {
  const { viewed, active } = useViewedScene();
  const targeting = useTargeting();
  return (
    <ToolRail
      pingHint="Click to ping, Shift+click to pull everyone's view, right-drag for the laser"
      selectHint="Click, Ctrl/Shift+click or Ctrl/Shift+drag to select; drag tokens, pan the map"
      signalsOff={viewed !== null && active?.id !== viewed.id}
      selectOnly={targeting}
    >
      {viewed && (
        <div className="flex flex-col gap-1 border-t pt-1">
          <GridTool scene={viewed} />
          <LockTool scene={viewed} />
          {active?.id !== viewed.id && <ShowToPlayers scene={viewed} />}
        </div>
      )}
    </ToolRail>
  );
}
