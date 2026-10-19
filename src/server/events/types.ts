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
  /**
   * Transport hint (never logged): a connection whose surviving changes were all identical
   * upserts gets **no** frame, not an empty one (FR-SYNC-19's exception; e.g. a secret
   * `CombatantSideChanged`, FR-CBT-100). Acks are separate frames, so the sender loses nothing.
   */
  quietWhenUnchanged?: true;
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
