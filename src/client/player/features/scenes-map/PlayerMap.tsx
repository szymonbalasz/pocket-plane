// Player base layer + tool rail (MAP §7): the active scene only (the snapshot holds nothing else),
// visible tokens, own tokens draggable, ruler, ping, laser. Double-click on an own companion token
// opens its card (FR-MAP-77). Right-click (long-press on touch) on a token opens the player token
// menu (FR-NOTES-29), the DM menu's look. The shown overview, when one is shown, instead of the map
// (FR-OVW-09).
import {
  OVERVIEW_ITEM_TYPE,
  OVERVIEW_TYPE,
  type PlayerOverviewItemRecord,
  type PlayerOverviewRecord,
} from "@shared/overview-scenes/schemas";
import {
  PlayerSceneRecord,
  type PlayerTokenRecord,
  SCENE_TYPE,
  TOKEN_TYPE,
} from "@shared/scenes-map/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import { useCompanionTokenOpen } from "@ui/features/combat-tracker/companion-token-open";
import { LazyOverviewCanvas } from "@ui/features/overview-scenes/LazyOverviewCanvas";
import { OverviewToolRail } from "@ui/features/overview-scenes/OverviewToolRail";
import { BaseEmpty } from "@ui/features/play-shell/PlayFrame";
import { useLive } from "@ui/features/scenes-map/intents";
import { LazyMapCanvas as MapCanvas } from "@ui/features/scenes-map/LazyMapCanvas";
import { ToolRail } from "@ui/features/scenes-map/ToolRail";
import { useRecords, useSync } from "@ui/sync/store";
import { useMemo, useState } from "react";
import { playerMenuFor } from "./token-menu";

type Open = { tokenId: string; at: { x: number; y: number } } | null;

/** FR-NOTES-29: the player token menu; same look and test IDs as the DM's (DmMap). */
function PlayerTokenMenu({
  tokens,
  menu,
  setMenu,
}: {
  tokens: readonly PlayerTokenRecord[];
  menu: Open;
  setMenu(m: Open): void;
}) {
  const live = useLive();
  const [dialog, setDialog] = useState<{ entryId: string; tokenId: string } | null>(null);
  const menuToken = tokens.find((t) => t.id === menu?.tokenId) ?? null;
  const entries = menuToken ? playerMenuFor(menuToken) : [];
  const dialogToken = tokens.find((t) => t.id === dialog?.tokenId) ?? null;
  const DialogC =
    dialog && dialogToken
      ? playerMenuFor(dialogToken).find((e) => e.id === dialog.entryId)?.Dialog
      : undefined;
  return (
    <>
      <DropdownMenu
        open={menuToken !== null && entries.length > 0 && live}
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
          side={menu && menu.at.y > window.innerHeight / 2 ? "top" : "bottom"}
          collisionPadding={8}
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto"
          data-testid="map-token-menu"
          data-record-id={menuToken?.id}
        >
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

/** FR-OVW-09: the scene gate gives a player the shown overview only. */
const useShownOverview = () =>
  useRecords<PlayerOverviewRecord>(OVERVIEW_TYPE).find((o) => o.active) ?? null;

export function PlayerMapBase() {
  const overview = useShownOverview();
  const allItems = useRecords<PlayerOverviewItemRecord>(OVERVIEW_ITEM_TYPE);
  const items = useMemo(
    () => (overview ? allItems.filter((i) => i.overviewId === overview.id) : []),
    [allItems, overview],
  );
  const scenes = useRecords<PlayerSceneRecord>(SCENE_TYPE);
  const tokens = useRecords<PlayerTokenRecord>(TOKEN_TYPE);
  const playerId = useSync((s) => s.store.you?.playerId ?? null);
  const openCompanion = useCompanionTokenOpen("player");
  const [menu, setMenu] = useState<Open>(null);
  const active = useMemo(
    () => scenes.find((s) => s.active && PlayerSceneRecord.safeParse(s).success) ?? null,
    [scenes],
  );
  const onScene = useMemo(
    () => (active ? tokens.filter((t) => t.sceneId === active.id) : []),
    [tokens, active],
  );
  if (overview) {
    return (
      <LazyOverviewCanvas
        client="player"
        overviewId={overview.id}
        items={items}
        myPlayerId={playerId}
        signalsOn
      />
    );
  }
  if (!active) return <BaseEmpty client="player" />;
  return (
    <>
      <MapCanvas
        client="player"
        scene={active}
        tokens={onScene}
        myPlayerId={playerId}
        signalsOn
        onTokenDoubleClick={openCompanion}
        hasTokenMenu={(t) => {
          const full = onScene.find((x) => x.id === t.id);
          return full !== undefined && playerMenuFor(full).length > 0;
        }}
        onTokenMenu={(t, at) => setMenu({ tokenId: t.id, at })}
      />
      <PlayerTokenMenu tokens={onScene} menu={menu} setMenu={setMenu} />
    </>
  );
}

export function PlayerMapToolRail() {
  const overview = useShownOverview();
  if (overview) return <OverviewToolRail client="player" />;
  return <ToolRail />;
}
