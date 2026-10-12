/** Who caused a command. `system` = server-internal (none in Foundation). */
export type Role = "dm" | "player";

export interface Actor {
  role: Role | "system";
  playerId: string | null;
  /** Connection campaign (WS) or null (REST DM: commands resolve the active campaign). */
  campaignId: string | null;
}

/** Before/after per record; create: before null, delete: after null (SYNC §8). */
export interface RecordChange {
  type: string;
  id: string;
  before: unknown | null;
  after: unknown | null;
}

export interface DomainEvent<P = unknown> {
  type: string;
  /** Null for global events (imported definitions, ADR-0018). */
  campaignId: string | null;
  payload: P;
  changes: RecordChange[];
}

export interface DispatchMeta {
  actor: Actor;
  intentId: string | null;
  /** Connection that sent the intent; only its copy carries `intentId`. */
  originConnId: string | null;
}

export interface DispatchedEvent {
  event: DomainEvent;
  meta: DispatchMeta;
}
