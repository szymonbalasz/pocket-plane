import { SceneActivated } from "@shared/events/scenes-map";
import { DragData, LaserData, MAP_SIGNALS, PingData, PullData } from "@shared/scenes-map/schemas";
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { defineSignal } from "../../ws/signals";
import { ActiveSceneCache, sceneCampaignOf } from "./active-scene";
import { backfillCharacterIds } from "./character-copy";
import {
  activateScene,
  createFolder,
  createScene,
  deleteFolder,
  deleteSceneCommand,
  deleteTokenCommand,
  duplicateScene,
  duplicateToken,
  moveTokenCommand,
  patchScene,
  placeToken,
  renameFolder,
  setGrid,
  setLocked,
  setSceneMap,
  setTokenHiddenCommand,
  updateTokenCommand,
} from "./commands";
import { dragAudience } from "./drag";
import { sceneRecordTypes } from "./records";
import { bindTokenHooks, TokenHooks, tokenChangedHooks } from "./token-hooks";

export const scenesMap: Feature = {
  name: "scenes-map",
  register(r) {
    const s = r.services;
    const hooks = new TokenHooks(tokenChangedHooks);
    bindTokenHooks(s, hooks);

    // REST-only (MAP §9, ADR-0021 D) — also fixture steps.
    const rest: CommandDef[] = [
      createScene,
      patchScene,
      duplicateScene,
      deleteSceneCommand(hooks),
      createFolder,
      renameFolder,
      deleteFolder,
    ] as unknown as CommandDef[];
    for (const c of rest) r.command(c);
    // WS intents (protocol §13).
    const intents: CommandDef[] = [
      activateScene,
      setSceneMap,
      setGrid,
      setLocked,
      placeToken,
      moveTokenCommand(hooks),
      updateTokenCommand(hooks),
      setTokenHiddenCommand(hooks),
      duplicateToken,
      deleteTokenCommand(hooks),
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });

    for (const t of sceneRecordTypes) r.recordType(t);
    // FR-MAP-50: tokens placed before the `characterId` column get their copy.
    r.onStart("scenes-map.character-backfill", (sv) => {
      backfillCharacterIds(sv.db);
    });

    // Signals (FR-MAP-25, ADR-0026): pull is DM only.
    r.signal(defineSignal({ name: MAP_SIGNALS.ping, schema: PingData, roles: ["dm", "player"] }));
    r.signal(defineSignal({ name: MAP_SIGNALS.laser, schema: LaserData, roles: ["dm", "player"] }));
    r.signal(defineSignal({ name: MAP_SIGNALS.pull, schema: PullData, roles: ["dm"] }));
    // Drag preview (FR-MAP-39–41): routed per token by its audience hook (FR-SYNC-28, ADR-0033).
    r.signal(
      defineSignal({
        name: MAP_SIGNALS.drag,
        schema: DragData,
        roles: ["dm", "player"],
        audience: dragAudience,
      }),
    );

    // FR-MAP-06: cache first (commit hook, CON-23), then resync every player of the campaign.
    const cache = new ActiveSceneCache(s.db);
    r.activeScene((cid) => cache.get(cid));
    // ADR-0041: `sync.loadScene` loads only scenes of the DM's campaign.
    s.records.provideSceneCampaign((sceneId) => sceneCampaignOf(s.db, sceneId));
    r.afterCommit("scenes-map.active-scene", (e) => cache.onCommit(e));
    r.listener("scenes-map.activation-resync", (e) => {
      if (e.event.type !== SceneActivated.type) return;
      s.hub?.resync((c) => c.role === "player" && c.campaignId === e.event.campaignId);
    });
  },
};
