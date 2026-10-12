// Fixture unit registry. Append-only (AGENTS §9.9): add your own lines.
import type { Fixture } from "@server/features/fixtures-adapters/fixture-types";
import campaign from "./campaign-management/campaign";
import campaignSecond from "./campaign-management/campaign-second";
import player1 from "./campaign-management/player-1";
import player2 from "./campaign-management/player-2";
import syncProbes from "./live-sync/sync-probes";

export const units: readonly Fixture[] = [campaign, player1, player2, campaignSecond, syncProbes];
