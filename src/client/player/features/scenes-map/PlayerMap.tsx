// Player base layer + tool rail (MAP §7): the active scene only (the snapshot holds nothing else),
// visible tokens, own tokens draggable, ruler, ping, laser; no menus. Double-click on an own
// companion token opens its card (FR-MAP-77).
import {
  PlayerSceneRecord,
  type PlayerTokenRecord,
  SCENE_TYPE,
  TOKEN_TYPE,
} from "@shared/scenes-map/schemas";
import { useCompanionTokenOpen } from "@ui/features/combat-tracker/companion-token-open";
import { BaseEmpty } from "@ui/features/play-shell/PlayFrame";
import { LazyMapCanvas as MapCanvas } from "@ui/features/scenes-map/LazyMapCanvas";
import { ToolRail } from "@ui/features/scenes-map/ToolRail";
import { useRecords, useSync } from "@ui/sync/store";
import { useMemo } from "react";

export function PlayerMapBase() {
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
  return <ToolRail />;
}
