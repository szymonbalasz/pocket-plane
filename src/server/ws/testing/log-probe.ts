// Test-only windowed record type ("log probe") for ADR-0029 / CON-38, until dice-roll-log and
// notifications ship real windowed logs. In-memory rows, registered by tests only and refused
// outside test mode (like the scene probe and the sync probe, FR-SYNC-27).
import { defineEvent } from "@shared/events";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Services } from "../../services";
import { defineRecordType } from "../records";

export const LogProbeRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  /** Per-campaign counter: the window's `orderBy`. */
  n: z.number().int(),
  text: z.string(),
  hidden: z.boolean(),
  pinned: z.boolean(),
});
export type LogProbeRecord = z.infer<typeof LogProbeRecord>;

const LogProbeSetInput = z.object({
  id: z.string().min(1).max(64).optional(),
  text: z.string().max(500),
  hidden: z.boolean(),
  pinned: z.boolean().default(false),
});

const LogProbeSet = defineEvent({
  type: "LogProbeSet",
  payload: z.object({ id: z.string() }),
  logged: false,
  undoable: false,
});

/** Small on purpose, so tests cross the floor quickly. */
export const LOG_PROBE_WINDOW = 3;

export interface LogProbeFixture {
  rows: Map<string, LogProbeRecord>;
  set: CommandDef;
}

export function registerLogProbe(s: Services): LogProbeFixture {
  if (!s.config.testMode) throw new Error("log probe exists only in test mode");
  const rows = new Map<string, LogProbeRecord>();

  s.records.register(
    defineRecordType<LogProbeRecord>({
      type: "log-probe",
      scope: "campaign",
      schema: LogProbeRecord,
      idOf: (r) => r.id,
      campaignOf: (r) => r.campaignId,
      visibility: (r) => (r.hidden ? "hidden" : "full"),
      // The whole log of the campaign; the registry cuts the window (ADR-0029).
      snapshot: (_src, v) => [...rows.values()].filter((r) => r.campaignId === v.campaignId),
      window: { orderBy: "n", size: LOG_PROBE_WINDOW, pin: (r) => r.pinned },
    }),
  );
  s.commands.registerEvent(LogProbeSet);

  const set = defineCommand({
    name: "logprobe.set",
    input: LogProbeSetInput,
    execute(input, { ctx, actor, emit }) {
      const campaignId = actor.campaignId;
      if (!campaignId) throw conflict("No campaign context");
      const before = input.id === undefined ? null : (rows.get(input.id) ?? null);
      if (input.id !== undefined && (!before || before.campaignId !== campaignId)) {
        throw notFound("Log probe not found");
      }
      const id = input.id ?? ctx.ids.next();
      let n = before?.n ?? 0;
      if (!before) {
        for (const r of rows.values()) if (r.campaignId === campaignId) n = Math.max(n, r.n);
        n += 1;
      }
      const after: LogProbeRecord = {
        id,
        campaignId,
        n,
        text: input.text,
        hidden: input.hidden,
        pinned: input.pinned,
      };
      emit({
        type: LogProbeSet.type,
        campaignId,
        payload: { id },
        changes: [{ type: "log-probe", id, before, after }],
      });
      rows.set(id, after);
      return { id };
    },
  });

  s.commands.register(set as unknown as CommandDef);
  s.intents.add(set.name);
  return { rows, set: set as unknown as CommandDef };
}
