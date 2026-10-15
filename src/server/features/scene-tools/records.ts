// Record types of scene-tools (SCN §9, protocol §36). The three scene types are windowed for the DM
// (`dmWindow: "active-scene"`, ADR-0041, FR-SCN-32): the DM snapshot holds only the active
// scene's rows, others load with `sync.loadScene`. Players: the scene gate (active scene only).
import {
  AOE_TEMPLATE_TYPE,
  AoeTemplateRecord,
  MAP_SETTINGS_TYPE,
  MapSettingsRecord,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  ScenePropRecord,
  SceneStructureRecord,
} from "@shared/scene-tools/schemas";
import { defineRecordType } from "../../ws/records";
import { campaignProps, campaignStructures, campaignTemplates, readSettings } from "./rows";
import {
  propVisibility,
  redactProp,
  redactStructure,
  settingsVisibility,
  structureVisibility,
  templateVisibility,
} from "./visibility";

export const scnRecordTypes = [
  defineRecordType<SceneStructureRecord>({
    type: SCENE_STRUCTURE_TYPE,
    scope: "scene",
    schema: SceneStructureRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.id,
    visibility: structureVisibility,
    redact: redactStructure,
    dmWindow: "active-scene",
    snapshot: ({ db }, v) => campaignStructures(db, v.campaignId),
  }),
  defineRecordType<ScenePropRecord>({
    type: SCENE_PROP_TYPE,
    scope: "scene",
    schema: ScenePropRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.sceneId,
    visibility: propVisibility,
    redact: redactProp,
    dmWindow: "active-scene",
    // ≤ 2,000 per campaign (FR-SCN-16).
    snapshot: ({ db }, v) => campaignProps(db, v.campaignId),
  }),
  defineRecordType<AoeTemplateRecord>({
    type: AOE_TEMPLATE_TYPE,
    scope: "scene",
    schema: AoeTemplateRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.sceneId,
    visibility: templateVisibility,
    dmWindow: "active-scene",
    snapshot: ({ db }, v) => campaignTemplates(db, v.campaignId),
  }),
  defineRecordType<MapSettingsRecord>({
    type: MAP_SETTINGS_TYPE,
    scope: "campaign",
    schema: MapSettingsRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.id,
    visibility: settingsVisibility,
    snapshot: ({ db }, v) => {
      const r = readSettings(db, v.campaignId);
      return r ? [r] : [];
    },
  }),
] as const;
