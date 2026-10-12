// Test-only `scene`-scoped record type ("scene probe") for the CON-22 scene gate and the
// CON-23 commit hook, until scenes-map ships the real scene/token tables. In-memory rows,
// registered by tests only and refused outside test mode (like the sync probe, FR-SYNC-27).
import { defineEvent } from "@shared/events";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Services } from "../../services";
import { defineRecordType } from "../records";

export const SceneProbeRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  sceneId: z.string(),
  text: z.string(),
  hidden: z.boolean(),
});
export type SceneProbeRecord = z.infer<typeof SceneProbeRecord>;

const SceneProbeSetInput = z.object({
  id: z.string().min(1).max(64).optional(),
  sceneId: z.string().min(1).max(64),
  text: z.string().max(500),
  hidden: z.boolean(),
});
const SceneProbeActivateInput = z.object({ sceneId: z.string().min(1).max(64) });

const SceneProbeSet = defineEvent({
  type: "SceneProbeSet",
  payload: z.object({ id: z.string(), sceneId: z.string() }),
  logged: false,
  undoable: false,
});
const SceneProbeActivated = defineEvent({
  type: "SceneProbeActivated",
  payload: z.object({ sceneId: z.string(), previousSceneId: z.string().nullable() }),
  logged: false,
  undoable: false,
});

export interface SceneProbeFixture {
  rows: Map<string, SceneProbeRecord>;
  /** Committed active scene per campaign (the "DB"). */
  activeInDb: Map<string, string>;
  /** Cache the scope gate reads; reloaded from `activeInDb` by the commit hook (CON-23). */
  activeCache: Map<string, string>;
  set: CommandDef;
  activate: CommandDef;
}

/** Registers the type, its commands + events, the active-scene resolver and the commit hook. */
export function registerSceneProbe(s: Services): SceneProbeFixture {
  if (!s.config.testMode) throw new Error("scene probe exists only in test mode");
  const rows = new Map<string, SceneProbeRecord>();
  const activeInDb = new Map<string, string>();
  const activeCache = new Map<string, string>();

  s.records.register(
    defineRecordType<SceneProbeRecord>({
      type: "scene-probe",
      scope: "scene",
      schema: SceneProbeRecord,
      idOf: (r) => r.id,
      campaignOf: (r) => r.campaignId,
      sceneOf: (r) => r.sceneId,
      visibility: (r) => (r.hidden ? "hidden" : "full"),
      // Every scene's rows of the campaign; the scene gate filters (CON-22).
      snapshot: (_src, v) => [...rows.values()].filter((r) => r.campaignId === v.campaignId),
    }),
  );
  s.records.provideActiveScene((cid) => activeCache.get(cid) ?? null, { replace: true });
  s.commands.registerEvent(SceneProbeSet);
  s.commands.registerEvent(SceneProbeActivated);

  const set = defineCommand({
    name: "sceneprobe.set",
    input: SceneProbeSetInput,
    execute(input, { ctx, actor, emit }) {
      const campaignId = actor.campaignId;
      if (!campaignId) throw conflict("No campaign context");
      const before = input.id === undefined ? null : (rows.get(input.id) ?? null);
      if (input.id !== undefined && (!before || before.campaignId !== campaignId)) {
        throw notFound("Scene probe not found");
      }
      const id = input.id ?? ctx.ids.next();
      const after: SceneProbeRecord = {
        id,
        campaignId,
        sceneId: input.sceneId,
        text: input.text,
        hidden: input.hidden,
      };
      emit({
        type: SceneProbeSet.type,
        campaignId,
        payload: { id, sceneId: input.sceneId },
        changes: [{ type: "scene-probe", id, before, after }],
      });
      rows.set(id, after);
      return { id };
    },
  });

  const activate = defineCommand({
    name: "sceneprobe.activate",
    input: SceneProbeActivateInput,
    execute({ sceneId }, { actor, emit }) {
      const campaignId = actor.campaignId;
      if (!campaignId) throw conflict("No campaign context");
      const previousSceneId = activeInDb.get(campaignId) ?? null;
      emit({
        type: SceneProbeActivated.type,
        campaignId,
        payload: { sceneId, previousSceneId },
        changes: [],
      });
      activeInDb.set(campaignId, sceneId);
    },
  });

  // CON-23: cache reloads from the committed state before any listener (incl. the broadcaster).
  s.commands.afterCommit("scene-probe-cache", (e) => {
    if (e.event.type !== SceneProbeActivated.type || !e.event.campaignId) return;
    const cid = e.event.campaignId;
    const committed = activeInDb.get(cid);
    if (committed === undefined) activeCache.delete(cid);
    else activeCache.set(cid, committed);
  });
  // FR-SYNC-11: activation resyncs every player connection of the campaign (a listener).
  s.bus.subscribe("scene-probe-resync", (e) => {
    if (e.event.type !== SceneProbeActivated.type) return;
    s.hub?.resync((c) => c.role === "player" && c.campaignId === e.event.campaignId);
  });

  s.commands.register(set as unknown as CommandDef);
  s.commands.register(activate as unknown as CommandDef);
  s.intents.add(set.name);
  s.intents.add(activate.name);
  return {
    rows,
    activeInDb,
    activeCache,
    set: set as unknown as CommandDef,
    activate: activate as unknown as CommandDef,
  };
}
