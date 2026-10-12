// Fixture unit registry. Append-only (AGENTS §9.9): add your own lines.
import type { Fixture } from "@server/features/fixtures-adapters/fixture-types";
import imageLarge from "./assets-pipeline/image-large";
import images from "./assets-pipeline/images";
import imagesSecond from "./assets-pipeline/images-second";
import campaign from "./campaign-management/campaign";
import campaignSecond from "./campaign-management/campaign-second";
import player1 from "./campaign-management/player-1";
import player2 from "./campaign-management/player-2";
import enemy1 from "./entities/enemy-1";
import enemy2 from "./entities/enemy-2";
import syncProbes from "./live-sync/sync-probes";

export const units: readonly Fixture[] = [
  campaign,
  player1,
  player2,
  campaignSecond,
  syncProbes,
  images,
  imageLarge,
  imagesSecond,
  enemy1,
  enemy2,
];
