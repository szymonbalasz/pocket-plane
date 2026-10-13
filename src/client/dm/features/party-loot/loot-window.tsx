// DM `loot.log` window: pot, wallets, add form, Move form (any ends), log with Edit (FR-LOOT-15–18).
import { LootLog } from "@ui/features/party-loot/LootLog";
import { lootLogWindowBase } from "@ui/features/party-loot/window";
import { defineWindow } from "@ui/features/play-shell/registry";

export const dmLootLogWindow = defineWindow({
  ...lootLogWindowBase,
  clients: ["dm"],
  component: LootLog,
});
