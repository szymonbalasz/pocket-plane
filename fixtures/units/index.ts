// Fixture unit registry. Append-only (AGENTS §9.9): add your own lines.
import type { Fixture } from "@server/features/fixtures-adapters/fixture-types";
import imageLarge from "./assets-pipeline/image-large";
import images from "./assets-pipeline/images";
import imagesSecond from "./assets-pipeline/images-second";
import campaign from "./campaign-management/campaign";
import campaignSecond from "./campaign-management/campaign-second";
import player1 from "./campaign-management/player-1";
import player2 from "./campaign-management/player-2";
import charMira from "./entities/char-mira";
import charThorn from "./entities/char-thorn";
import enemy1 from "./entities/enemy-1";
import enemy2 from "./entities/enemy-2";
import enemyCustom from "./entities/enemy-custom";
import enemyCustomSecond from "./entities/enemy-custom-second";
import syncProbes from "./live-sync/sync-probes";
import notificationsTest from "./notifications/notifications-test";
import battlemap from "./scenes-map/battlemap";
import scenesExtras from "./scenes-map/scenes-extras";
import town from "./scenes-map/town";

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
  enemyCustom,
  charMira,
  charThorn,
  enemyCustomSecond,
  town,
  battlemap,
  scenesExtras,
  notificationsTest,
];
