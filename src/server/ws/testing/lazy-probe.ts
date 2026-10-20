// Test-only lazy record types ("lazy probes", ADR-0045) until party-board, compendium and
// effect-modifiers register real ones, plus `lazyLoadSizes` (FR-SYNC-38: a type's worst load
// for spec §12). In-memory rows, registered by tests only and refused outside test mode (like
// the sync probe, FR-SYNC-27).
import { defineEvent } from "@shared/events";
import { type LazyMode, MAX_LOAD_IDS } from "@shared/protocol/lazy";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Services } from "../../services";
import { defineRecordType, type SnapshotSource, type Viewer } from "../records";

/**
 * `campaignId` null on global-scope probes. Players: hidden if `hidden`; else `secret` is
 * redacted away unless they own the row (`ownerPlayerId`).
 */
export const LazyProbeRecord = z.object({
  id: z.string(),
  campaignId: z.string().nullable(),
  text: z.string(),
  secret: z.string(),
  hidden: z.boolean(),
  ownerPlayerId: z.string().nullable(),
});
export type LazyProbeRecord = z.infer<typeof LazyProbeRecord>;

const LazyProbeSetInput = z.object({
  id: z.string().min(1).max(64).optional(),
  text: z.string().max(10_000),
  secret: z.string().max(500).default(""),
  hidden: z.boolean().default(false),
  ownerPlayerId: z.string().min(1).max(64).nullable().default(null),
});
const LazyProbeDeleteInput = z.object({ id: z.string().min(1).max(64) });

export interface LazyProbeOptions {
  /** Record type name; default `lazy-probe`. */
  type?: string;
  lazy?: LazyMode;
  scope?: "campaign" | "global";
  audience?: "dm";
  /** Register a `byIds` provider (else the registry filters `snapshot` rows by id). */
  byIds?: boolean;
  /** ADR-0058: tag the type with a feature (hidden while the campaign's feature is off). */
  feature?: string;
}

export interface LazyProbeFixture {
  type: string;
  rows: Map<string, LazyProbeRecord>;
  set: CommandDef;
  remove: CommandDef;
  /** `byIds` calls seen (when registered). */
  byIdsCalls: string[][];
}

/** Registers one lazy probe type with `<type>.set` / `<type>.delete` commands (DM only). */
export function registerLazyProbe(s: Services, opts: LazyProbeOptions = {}): LazyProbeFixture {
  if (!s.config.testMode) throw new Error("lazy probe exists only in test mode");
  const type = opts.type ?? "lazy-probe";
  const scope = opts.scope ?? "campaign";
  const rows = new Map<string, LazyProbeRecord>();
  const byIdsCalls: string[][] = [];
  const inCampaign = (r: LazyProbeRecord, v: Viewer) =>
    scope === "global" || r.campaignId === v.campaignId;

  s.records.register(
    defineRecordType<LazyProbeRecord>({
      type,
      scope,
      ...(opts.audience ? { audience: opts.audience } : {}),
      ...(opts.feature ? { feature: opts.feature } : {}),
      lazy: opts.lazy ?? "all",
      schema: LazyProbeRecord,
      idOf: (r) => r.id,
      ...(scope === "campaign" ? { campaignOf: (r: LazyProbeRecord) => r.campaignId ?? "" } : {}),
      visibility: (r, v) => {
        if (r.hidden) return "hidden";
        return r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId ? "full" : "redacted";
      },
      redact: ({ secret: _secret, ...rest }) => rest,
      snapshot: (_src, v) => [...rows.values()].filter((r) => inCampaign(r, v)),
      ...(opts.byIds
        ? {
            byIds: (_src: SnapshotSource, _v: Viewer, ids: readonly string[]) => {
              byIdsCalls.push([...ids]);
              return ids.flatMap((id) => rows.get(id) ?? []);
            },
          }
        : {}),
    }),
  );

  const SetEvent = defineEvent({
    type: `LazyProbeSet:${type}`,
    payload: z.object({ id: z.string() }),
    logged: false,
    undoable: false,
  });
  const Deleted = defineEvent({
    type: `LazyProbeDeleted:${type}`,
    payload: z.object({ id: z.string() }),
    logged: false,
    undoable: false,
  });
  s.commands.registerEvent(SetEvent);
  s.commands.registerEvent(Deleted);

  const set = defineCommand({
    name: `${type}.set`,
    input: LazyProbeSetInput,
    execute(input, { ctx, actor, emit }) {
      const campaignId = scope === "global" ? null : actor.campaignId;
      if (scope === "campaign" && !campaignId) throw conflict("No campaign context");
      const before = input.id === undefined ? null : (rows.get(input.id) ?? null);
      if (before && before.campaignId !== campaignId) throw notFound("Lazy probe not found");
      const id = input.id ?? ctx.ids.next();
      const after: LazyProbeRecord = {
        id,
        campaignId,
        text: input.text,
        secret: input.secret,
        hidden: input.hidden,
        ownerPlayerId: input.ownerPlayerId,
      };
      emit({
        type: SetEvent.type,
        campaignId,
        payload: { id },
        changes: [{ type, id, before, after }],
      });
      rows.set(id, after);
      return { id };
    },
  });
  const remove = defineCommand({
    name: `${type}.delete`,
    input: LazyProbeDeleteInput,
    execute({ id }, { actor, emit }) {
      const before = rows.get(id);
      const campaignId = scope === "global" ? null : actor.campaignId;
      if (!before || before.campaignId !== campaignId) throw notFound("Lazy probe not found");
      emit({
        type: Deleted.type,
        campaignId,
        payload: { id },
        changes: [{ type, id, before, after: null }],
      });
      rows.delete(id);
    },
  });
  for (const c of [set, remove]) {
    s.commands.register(c as unknown as CommandDef);
    s.intents.add(c.name);
  }
  return {
    type,
    rows,
    set: set as unknown as CommandDef,
    remove: remove as unknown as CommandDef,
    byIdsCalls,
  };
}

export interface LazyLoadSize {
  label: string;
  /** UTF-8 bytes of the whole `ack` frame (36-char intentId). */
  bytes: number;
  rows: number;
}

/**
 * A lazy type's worst load per viewer (FR-SYNC-38, for its spec §12): `all` types the
 * whole-type load; `ids` types the worst chunk of ≤ 50 ids (the viewer's largest visible rows).
 * Largest first.
 */
export function lazyLoadSizes(
  s: Services,
  type: string,
  viewers: { label: string; viewer: Viewer }[],
): LazyLoadSize[] {
  const def = s.records.get(type);
  if (!def || def.lazy === undefined) throw new Error(`Record type "${type}" is not lazy`);
  const src: SnapshotSource = { db: s.db, presence: { list: () => [] } };
  const bytesOf = (records: Record<string, unknown[]>) =>
    Buffer.byteLength(
      JSON.stringify({ type: "ack", intentId: "0".repeat(36), result: { records } }),
      "utf8",
    );
  return viewers
    .map(({ label, viewer }) => {
      const all = s.records.load(src, viewer, type, undefined);
      if (def.lazy === "all") return { label, bytes: bytesOf(all), rows: all[type]?.length ?? 0 };
      const worst = (all[type] ?? [])
        .map((r) => ({
          id: String((r as { id?: unknown }).id),
          n: Buffer.byteLength(JSON.stringify(r), "utf8"),
        }))
        .sort((a, b) => b.n - a.n)
        .slice(0, MAX_LOAD_IDS)
        .map((r) => r.id);
      if (worst.length === 0) return { label, bytes: bytesOf({ [type]: [] }), rows: 0 };
      const chunk = s.records.load(src, viewer, type, worst);
      return { label, bytes: bytesOf(chunk), rows: chunk[type]?.length ?? 0 };
    })
    .sort((a, b) => b.bytes - a.bytes);
}
