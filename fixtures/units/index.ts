// Fixture unit registry. Append-only (AGENTS §9.9): add your own lines.
import type { Fixture } from "@server/features/fixtures-adapters/fixture-types";
import imageLarge from "./assets-pipeline/image-large";
import images from "./assets-pipeline/images";
import imagesSecond from "./assets-pipeline/images-second";
import campaign from "./campaign-management/campaign";
import campaignSecond from "./campaign-management/campaign-second";
import player1 from "./campaign-management/player-1";
import player2 from "./campaign-management/player-2";
import charPip from "./character-sheet/char-pip";
import charWounds from "./character-sheet/char-wounds";
import visionSenses from "./character-sheet/vision-senses";
import charMiraFull from "./character-sheet-full/char-mira-full";
import charMiraLocked from "./character-sheet-full/char-mira-locked";
import charSela from "./character-sheet-full/char-sela";
import npcEliteSheet from "./character-sheet-full/npc-elite-sheet";
import cbtxEffects from "./combat-extras/cbtx-effects";
import cbtxReinforcement from "./combat-extras/cbtx-reinforcement";
import cbtxTemp from "./combat-extras/cbtx-temp";
import combat1 from "./combat-tracker/combat-1";
import combatHit from "./combat-tracker/combat-hit";
import combatPending from "./combat-tracker/combat-pending";
import encounter1 from "./combat-tracker/encounter-1";
import goblin2 from "./combat-tracker/goblin-2";
import thornBattlemap from "./combat-tracker/thorn-battlemap";
import cmpHomebrew from "./compendium/cmp-homebrew";
import cmpHomebrewSecond from "./compendium/cmp-homebrew-second";
import cmpImages from "./compendium/cmp-images";
import cmpSearchHomebrew from "./compendium/cmp-search-homebrew";
import cmpSrdFull from "./compendium/cmp-srd-full";
import cmpSrdMini from "./compendium/cmp-srd-mini";
import cmpSrdMiniS3 from "./compendium/cmp-srd-mini-s3";
import dicexLooks from "./dice-extras/dicex-looks";
import dicexNotationText from "./dice-extras/dicex-notation-text";
import diceSettings from "./dice-roll-log/dice-settings";
import rolls1 from "./dice-roll-log/rolls-1";
import charBrakka from "./effect-modifiers/char-brakka";
import modBane from "./effect-modifiers/mod-bane";
import modBless from "./effect-modifiers/mod-bless";
import modFireWard from "./effect-modifiers/mod-fire-ward";
import modPresets from "./effect-modifiers/mod-presets";
import modRage from "./effect-modifiers/mod-rage";
import modTier2 from "./effect-modifiers/mod-tier2";
import trgBrakka from "./effect-modifiers/trg-brakka";
import trgCombat from "./effect-modifiers/trg-combat";
import trgMiraUses from "./effect-modifiers/trg-mira-uses";
import trgMonsters from "./effect-modifiers/trg-monsters";
import trgThorn from "./effect-modifiers/trg-thorn";
import usesRageSpent from "./effect-modifiers/uses-rage-spent";
import weaponFlameTongue from "./effect-modifiers/weapon-flame-tongue";
import artUpdateTokens from "./entities/art-update-tokens";
import charMira from "./entities/char-mira";
import charThorn from "./entities/char-thorn";
import enemy1 from "./entities/enemy-1";
import enemy2 from "./entities/enemy-2";
import enemyCustom from "./entities/enemy-custom";
import enemyCustomSecond from "./entities/enemy-custom-second";
import entArtTokens from "./entities/ent-art-tokens";
import fogAmbush from "./fog-of-war/fog-ambush";
import fogAmbushPartial from "./fog-of-war/fog-ambush-partial";
import fogScn from "./fog-of-war/fog-scn";
import visionBrakka from "./fog-of-war/vision-brakka";
import visionCrypt from "./fog-of-war/vision-crypt";
import visionInvisible from "./fog-of-war/vision-invisible";
import visionLegacy from "./fog-of-war/vision-legacy";
import syncProbes from "./live-sync/sync-probes";
import notificationsTest from "./notifications/notifications-test";
import handoutAttachment from "./party-board/handout-attachment";
import handoutImages from "./party-board/handout-images";
import handoutPresent1 from "./party-board/handout-present-1";
import handouts1 from "./party-board/handouts-1";
import partyItems1 from "./party-board/party-items-1";
import partySecond from "./party-board/party-second";
import loot1 from "./party-loot/loot-1";
import lootSecond from "./party-loot/loot-second";
import lootWallets from "./party-loot/loot-wallets";
import mtTemplates from "./scene-tools/mt-templates";
import scnPropImages from "./scene-tools/scn-prop-images";
import scnProps from "./scene-tools/scn-props";
import scnTemplates from "./scene-tools/scn-templates";
import scnWalls from "./scene-tools/scn-walls";
import battlemap from "./scenes-map/battlemap";
import mtCrowd from "./scenes-map/mt-crowd";
import scenesExtras from "./scenes-map/scenes-extras";
import thornTown from "./scenes-map/thorn-town";
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
  diceSettings,
  rolls1,
  charPip,
  charWounds,
  encounter1,
  goblin2,
  thornBattlemap,
  combat1,
  combatHit,
  combatPending,
  loot1,
  lootWallets,
  lootSecond,
  thornTown,
  charMiraFull,
  charMiraLocked,
  charSela,
  npcEliteSheet,
  cbtxEffects,
  cbtxTemp,
  cbtxReinforcement,
  modPresets,
  modBless,
  modBane,
  modRage,
  modTier2,
  fogAmbush,
  fogAmbushPartial,
  scnWalls,
  scnPropImages,
  scnProps,
  scnTemplates,
  fogScn,
  dicexNotationText,
  visionSenses,
  charBrakka,
  trgBrakka,
  trgCombat,
  trgThorn,
  trgMonsters,
  handoutImages,
  handouts1,
  partyItems1,
  partySecond,
  cmpSrdMini,
  cmpHomebrew,
  cmpHomebrewSecond,
  visionCrypt,
  dicexLooks,
  cmpSrdFull,
  cmpSearchHomebrew,
  visionLegacy,
  visionInvisible,
  visionBrakka,
  weaponFlameTongue,
  modFireWard,
  usesRageSpent,
  trgMiraUses,
  mtTemplates,
  mtCrowd,
  entArtTokens,
  cmpSrdMiniS3,
  artUpdateTokens,
  handoutAttachment,
  handoutPresent1,
  cmpImages,
];
