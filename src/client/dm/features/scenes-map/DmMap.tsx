// DM base layer (viewed scene, FR-MAP-08), token menu host (FR-MAP-18/29), definition drops
// (FR-MAP-13), Ctrl-D (FR-MAP-17) and the DM tool rail extras (grid, lock, show to players).
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
import { ToolRail } from "@ui/features/scenes-map/ToolRail";
import { useRecords } from "@ui/sync/store";
import { EyeOffIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { GridTool, LockTool, ShowToPlayers } from "./DmTools";
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
  const tokens = useRecords<TokenRecord>(TOKEN_TYPE);
  const selected = useDmMap((s) => s.selectedTokenId);
  const select = useDmMap((s) => s.select);
  const draft = useDmMap((s) => s.gridDraft);
  const live = useLive();
  const send = useMapIntent();
  const [menu, setMenu] = useState<Open>(null);
  const [dialog, setDialog] = useState<{ entryId: string; tokenId: string } | null>(null);

  const onScene = useMemo(
    () => (viewed ? tokens.filter((t) => t.sceneId === viewed.id) : []),
    [tokens, viewed],
  );
  const byId = (id: string | null | undefined) => tokens.find((t) => t.id === id) ?? null;

  // FR-MAP-17: Ctrl-D with one token selected; keys inside windows never reach here.
  useBaseKeyDown((e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "d") return;
    e.preventDefault();
    const t = byId(selected);
    if (!t || !live || t.sceneId !== viewed?.id) return;
    send(MAP_INTENTS.duplicateToken, { tokenId: t.id }).then(
      (r) => select((r as { tokenId: string }).tokenId),
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
        myPlayerId={null}
        signalsOn={!notShown}
        gridOverride={draft?.sceneId === viewed.id ? draft.grid : null}
        selectedTokenId={selected}
        onSelectToken={select}
        onTokenMenu={(t, at) => {
          select(t.id);
          setMenu({ tokenId: t.id, at });
        }}
        onTokenDoubleClick={(t) => {
          const full = byId(t.id);
          const d = full && doubleClickFor(full);
          if (d && full) setDialog({ entryId: d.id, tokenId: full.id });
        }}
        onDropDefinition={(definitionId, cell) =>
          send(MAP_INTENTS.placeToken, { sceneId: viewed.id, definitionId, ...cell }).then(
            (r) => select((r as { tokenId: string }).tokenId),
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
  return (
    <ToolRail
      pingHint="Click to ping, Shift+click to pull everyone's view, right-drag for the laser"
      signalsOff={viewed !== null && active?.id !== viewed.id}
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
