// The viewer's own dice look (FR-DICEX-24): their `dice-look` row, else the derived default.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  DICE_LOOK_TYPE,
  type DiceLook,
  type DiceLookRecord,
  lookOf,
} from "@shared/dice-extras/looks";
import { useMemo } from "react";
import { useRecords, useSync } from "../../sync/store";

export function useOwnLook(): DiceLook {
  const you = useSync((s) => s.store.you);
  const rows = useRecords<DiceLookRecord>(DICE_LOOK_TYPE);
  const players = useRecords<PlayerRecord>("player");
  const ownId = you?.role === "player" ? you.playerId : null;
  return useMemo(
    () =>
      lookOf(
        ownId,
        rows,
        players.map((p) => p.id),
      ),
    [ownId, rows, players],
  );
}
