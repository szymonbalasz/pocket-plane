// DM base layer (viewed scene, FR-MAP-08), selection + box select + targeting (FR-MAP-31–33),
// token menu host (FR-MAP-18/29), definition drops (FR-MAP-13), Ctrl-D (FR-MAP-17), the DM
// tool rail extras (grid, lock) and the "Not shown to players" button (FR-MAP-51).
import { OVERVIEW_ITEM_TYPE, type OverviewItemRecord } from "@shared/overview-scenes/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import { LazyOverviewCanvas } from "@ui/features/overview-scenes/LazyOverviewCanvas";
import { OverviewToolRail } from "@ui/features/overview-scenes/OverviewToolRail";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { useBaseKeyDown } from "@ui/features/play-shell/hooks";
import { BaseEmpty } from "@ui/features/play-shell/PlayFrame";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { toastReject, useLive, useMapIntent } from "@ui/features/scenes-map/intents";
import { LazyMapCanvas as MapCanvas } from "@ui/features/scenes-map/LazyMapCanvas";
import { useSceneLoaded } from "@ui/features/scenes-map/scene-window";
import { ToolRail } from "@ui/features/scenes-map/ToolRail";
import { useRecords } from "@ui/sync/store";
import { EyeOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiagonalRulePanel } from "../scene-tools/diagonal-rule-panel";
import { ScnLayersPopover } from "../scene-tools/layers-popover";
import { ScnPropsDmHost } from "../scene-tools/props-host";
import { GridTool, LockTool } from "./DmTools";
import { SCENES_KIND } from "./scenes-window";
import {
  dispatchSelection,
  getMapSelection,
  setMapSelection,
  useMapSelection,
  useTargeting,
} from "./selection";
import { doubleClickFor, menuFor, tokenDoubleClick } from "./token-menu";
import { useDmMap, useViewedScene } from "./view-state";

type Open = { tokenId: string; at: { x: number; y: number } } | null;

/**
 * FR-MAP-51: opens / fronts the Scenes window with the viewed scene's row scrolled into view and
 * focused. Works while not live: viewing is local (FR-MAP-28); Show itself is disabled there.
 */
function NotShownButton({ sceneId }: { sceneId: string }) {
  const openWindow = useOpenWindow();
  const focusRow = useDmMap((s) => s.focusRow);
  return (
    <Button
      size="sm"
      variant="secondary"
      data-testid="map-not-shown-badge"
      className="h-6 gap-1 rounded-full px-2.5 text-xs"
      onClick={() => {
        focusRow(sceneId);
        openWindow(SCENES_KIND);
      }}
    >
      <EyeOffIcon className="size-3.5" /> Not shown to players · Scenes…
    </Button>
  );
}

export function DmMapBase() {
  const { viewed, active, overview } = useViewedScene();
  // ADR-0041: viewing a scene other than the snapshot's active one loads its tokens first. An
  // overview's items too: after a Show the DM gets none by frame until they are loaded.
  const loaded = useSceneLoaded(overview?.id ?? viewed?.id ?? null);
  const tokens = useRecords<TokenRecord>(TOKEN_TYPE);
  const allItems = useRecords<OverviewItemRecord>(OVERVIEW_ITEM_TYPE);
  const items = useMemo(
    () => (overview ? allItems.filter((i) => i.overviewId === overview.id) : []),
    [allItems, overview],
  );
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

  if (overview) {
    return (
      <>
        <LazyOverviewCanvas
          client="dm"
          overviewId={overview.id}
          items={items}
          loading={!loaded}
          myPlayerId={null}
          signalsOn={overview.active}
        />
        {!overview.active && (
          <div className="absolute left-1/2 -translate-x-1/2" style={{ top: TOP_BAR_H + 8 }}>
            <NotShownButton sceneId={overview.id} />
          </div>
        )}
      </>
    );
  }
  if (!viewed) return <BaseEmpty client="dm" />;
  const notShown = active?.id !== viewed.id;
  const menuToken = byId(menu?.tokenId);
  const dialogToken = byId(dialog?.tokenId);
  const entries = menuToken ? menuFor(menuToken) : [];
  // A menu entry's dialog, or a double-click entry's (FR-MAP-29).
  const DialogC =
    dialog && dialogToken
      ? (menuFor(dialogToken).find((e) => e.id === dialog.entryId)?.Dialog ??
        tokenDoubleClick.find((e) => e.id === dialog.entryId)?.Dialog)
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
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: TOP_BAR_H + 8 }}>
          <NotShownButton sceneId={viewed.id} />
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
        {/* P3 E2: opens towards the roomier side, stays inside the viewport and scrolls when
            taller than the room there (a 517 px menu at y 453 on 900 px ran off-screen). */}
        <DropdownMenuContent
          align="start"
          side={menu && menu.at.y > window.innerHeight / 2 ? "top" : "bottom"}
          collisionPadding={8}
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto"
          data-testid="map-token-menu"
          data-record-id={menuToken?.id}
        >
          {/* BL-141 (K6c §3, the kit's menu): the token's name heads its menu (label type). */}
          {menuToken && (
            <DropdownMenuLabel data-testid="map-token-menu-label" className="max-w-56 truncate">
              {menuToken.name}
            </DropdownMenuLabel>
          )}
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
  const { viewed, active, overview } = useViewedScene();
  const targeting = useTargeting();
  if (overview) return <OverviewToolRail client="dm" signalsOff={!overview.active} />;
  return (
    <ToolRail
      pingHint="Click to ping, Shift+click to pull everyone's view, right-drag for the laser"
      selectHint="Click, Ctrl/Shift+click or Ctrl/Shift+drag to select; drag tokens, pan the map"
      signalsOff={viewed !== null && active?.id !== viewed.id}
      selectOnly={targeting}
      basePanels={{ ruler: DiagonalRulePanel }}
    >
      <ScnLayersPopover />
      {viewed && (
        <div className="flex flex-col gap-1 border-t pt-1">
          <GridTool scene={viewed} />
          <LockTool scene={viewed} />
        </div>
      )}
      <ScnPropsDmHost />
    </ToolRail>
  );
}
