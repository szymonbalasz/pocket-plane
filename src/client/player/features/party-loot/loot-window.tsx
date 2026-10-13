// Player `loot.log` window: no add form and no Edit (FR-LOOT-19); Move form limited per FR-LOOT-18.
import { LootLog } from "@ui/features/party-loot/LootLog";
import { lootLogWindowBase } from "@ui/features/party-loot/window";
import { defineWindow } from "@ui/features/play-shell/registry";

export const playerLootLogWindow = defineWindow({
  ...lootLogWindowBase,
  clients: ["player"],
  component: LootLog,
});
