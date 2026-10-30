// Player base layer + tool rail (MAP §7): the active scene only (the snapshot holds nothing else),
// visible tokens, own tokens draggable, ruler, ping, laser; no menus. Double-click on an own
// companion token opens its card (FR-MAP-77). The shown overview, when one is shown, instead of the
// map (FR-OVW-09).
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
import { useCompanionTokenOpen } from "@ui/features/combat-tracker/companion-token-open";
import { LazyOverviewCanvas } from "@ui/features/overview-scenes/LazyOverviewCanvas";
import { OverviewToolRail } from "@ui/features/overview-scenes/OverviewToolRail";
import { BaseEmpty } from "@ui/features/play-shell/PlayFrame";
import { LazyMapCanvas as MapCanvas } from "@ui/features/scenes-map/LazyMapCanvas";
import { ToolRail } from "@ui/features/scenes-map/ToolRail";
import { useRecords, useSync } from "@ui/sync/store";
import { useMemo } from "react";

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
    <MapCanvas
      client="player"
      scene={active}
      tokens={onScene}
      myPlayerId={playerId}
      signalsOn
      onTokenDoubleClick={openCompanion}
    />
  );
}

export function PlayerMapToolRail() {
  const overview = useShownOverview();
  if (overview) return <OverviewToolRail client="player" />;
  return <ToolRail />;
}
