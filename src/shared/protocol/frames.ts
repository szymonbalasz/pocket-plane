// WebSocket frames (docs/protocol §3). Discriminator field: `type` (CON-14). Shared file.
import { z } from "zod";
import { Issue, RejectCode } from "./codes";

/** Client → server frames are limited to 64 KB (FR-SYNC-12, CON-13). */
export const MAX_CLIENT_FRAME_BYTES = 64 * 1024;

export const Role = z.enum(["dm", "player"]);
export type Role = z.infer<typeof Role>;

/** `hello.credential`: which resolver applies is explicit, so a bad link never counts as a DM failure. */
export const Credential = z.discriminatedUnion("role", [
  z.object({ role: z.literal("dm"), secret: z.string().min(1).max(512) }),
  z.object({ role: z.literal("player"), token: z.string().min(1).max(256) }),
]);
export type Credential = z.infer<typeof Credential>;

export const IntentId = z.string().min(1).max(64);

// ---- client → server ----
export const HelloFrame = z.object({ type: z.literal("hello"), credential: Credential });
export const IntentFrame = z.object({
  type: z.literal("intent"),
  intentId: IntentId,
  name: z.string().min(1).max(128),
  payload: z.unknown(),
});
export const SignalFrame = z.object({
  type: z.literal("signal"),
  name: z.string().min(1).max(128),
  data: z.unknown(),
});
export const ResyncFrame = z.object({ type: z.literal("resync") });
export const PingFrame = z.object({ type: z.literal("ping") });

export const ClientFrame = z.discriminatedUnion("type", [
  HelloFrame,
  IntentFrame,
  SignalFrame,
  ResyncFrame,
  PingFrame,
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

// ---- server → client ----
export const WireChange = z.object({
  type: z.string(),
  id: z.string(),
  op: z.enum(["upsert", "delete"]),
  data: z.unknown().optional(),
});
export type WireChange = z.infer<typeof WireChange>;

export const You = z.object({
  campaignId: z.string(),
  role: Role,
  playerId: z.string().nullable(),
});
export type You = z.infer<typeof You>;

export const SnapshotFrame = z.object({
  type: z.literal("snapshot"),
  seq: z.literal(0),
  you: You,
  records: z.record(z.string(), z.array(z.unknown())),
});
export const EventFrame = z.object({
  type: z.literal("event"),
  seq: z.number().int().positive(),
  /** `name` = domain event type (CON-12), or `presence` (CON-07). */
  cause: z.object({ name: z.string(), intentId: IntentId.optional() }),
  /** May be empty: every change was an identical upsert for this connection (FR-SYNC-19). */
  changes: z.array(WireChange),
});
/** Signal sender, stamped by the server from the connection context, never the payload (ADR-0026). */
export const SignalFrom = z.discriminatedUnion("role", [
  z.object({ role: z.literal("dm") }),
  z.object({ role: z.literal("player"), playerId: z.string() }),
]);
export type SignalFrom = z.infer<typeof SignalFrom>;

export const ServerSignalFrame = z.object({
  type: z.literal("signal"),
  name: z.string(),
  data: z.unknown(),
  from: SignalFrom,
});
export const AckFrame = z.object({
  type: z.literal("ack"),
  intentId: IntentId,
  result: z.unknown().optional(),
});
export const RejectFrame = z.object({
  type: z.literal("reject"),
  /** Null when the frame was unparseable. */
  intentId: IntentId.nullable(),
  code: RejectCode,
  message: z.string(),
  issues: z.array(Issue).optional(),
});
export const PongFrame = z.object({ type: z.literal("pong") });

export const ServerFrame = z.discriminatedUnion("type", [
  SnapshotFrame,
  EventFrame,
  ServerSignalFrame,
  AckFrame,
  RejectFrame,
  PongFrame,
]);
export type ServerFrame = z.infer<typeof ServerFrame>;
export type SnapshotFrame = z.infer<typeof SnapshotFrame>;
export type EventFrame = z.infer<typeof EventFrame>;
export type RejectFrame = z.infer<typeof RejectFrame>;
export type ServerSignalFrame = z.infer<typeof ServerSignalFrame>;

/** WS endpoint path (OQ-SYNC-15, proposed). */
export const WS_PATH = "/ws";
/** Query param of the reconnect probe: non-upgrade `GET <WS_PATH>?probe=1` → 204 (protocol §3.1). */
export const WS_PROBE_PARAM = "probe";

/** Timing (FR-SYNC-01/04/05). */
export const HELLO_TIMEOUT_MS = 5_000;
export const PING_INTERVAL_MS = 10_000;
export const SERVER_SILENCE_MS = 30_000;
export const CLIENT_PONG_TIMEOUT_MS = 20_000;
/** Reconnect backoff: 0.5 s doubling to a 1.5 s cap (decision #131), ±20 % jitter → ≤ 1.8 s. */
export const BACKOFF_START_MS = 500;
export const BACKOFF_MAX_MS = 1_500;
export const BACKOFF_JITTER = 0.2;
