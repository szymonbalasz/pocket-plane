// Server notification kind contract (FR-NOTE-03). Kinds are listed in `./kinds.ts`
// (append-only, AGENTS §9.9); kind owners define theirs with `defineNotificationKind`.
import { checkEndRule, type EncounterEndRule } from "@shared/notifications/end-rule";
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  NOTIFICATION_KIND_RE,
  PAYLOAD_MAX_BYTES,
  RESOLUTION_MAX_BYTES,
} from "@shared/notifications/schemas";
import { checkToastClass, type NotificationToastClass } from "@shared/notifications/toast-class";
import type { z } from "zod";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import type { FeatureTrace } from "../../ws/records";

export interface NotificationKindDef {
  /** `^[a-z][a-z0-9-]{0,31}$` */
  kind: string;
  /** Spec that owns the kind (e.g. `combat-tracker`). */
  ownerSpec: string;
  /** Payload zod; the serialised payload must also be ≤ `payloadMaxBytes`. */
  payload: z.ZodType;
  /** Per-kind payload cap in bytes, serialised (FR-NOTE-03, #163). Default 1 KB. */
  payloadMaxBytes?: number;
  /** Resolution zod; absent = the kind takes no resolution. Serialised ≤ `resolutionMaxBytes`. */
  resolution?: z.ZodType;
  /** Per-kind resolution cap in bytes, serialised (FR-NOTE-03, #155). Default 256. */
  resolutionMaxBytes?: number;
  /** `note.resolve` may resolve it (FR-NOTE-09). Default false. */
  genericResolve?: boolean;
  /**
   * FR-NOTE-23: pending rows close when their encounter ends (`dismissForEncounter`). The kind
   * owner's shared constant, also on its client views. Absent = pending until resolved / dismissed.
   */
  endRule?: EncounterEndRule;
  /**
   * Sprint 5 (FR-CBT-91): runs when a row of this kind is dismissed (`note.dismiss`,
   * `dismissForEncounter`), in that transaction, with the dismissed row; the record changes it
   * returns ride on that `NotificationDismissed` (e.g. the card's DM-only hit-ruling delete).
   * Writes through `env.tx` only, never emits; a throw rolls the dismissal back. Resolution is the
   * kind owner's own command, so it runs no hook. Absent = nothing.
   */
  onClose?: (env: CommandEnv, row: NotificationRecord) => RecordChange[];
  /**
   * Sprint 7 (ADR-0058, FR-GEM-05): other features' traces on this kind's rows (e.g. gems' maxed
   * dice on a damage card), hidden / stripped by the hub while that feature is off. Absent = none.
   */
  traces?: readonly FeatureTrace<NotificationRecord>[];
  /**
   * Sprint 8 (FR-NOTE-50, -52): the kind's toast class in the client's one stack: pending → card,
   * else info (or alert). The registry (`kinds.ts`) names it on every entry; the client views
   * name the same class. A pending row always toasts as a card (`toastClassOf`).
   */
  toastClass?: NotificationToastClass;
}

/** A `kinds.ts` entry: the kind def with its toast class named (FR-NOTE-52). */
export type RegisteredKindDef = NotificationKindDef & { toastClass: NotificationToastClass };

/** The kind's resolution cap (FR-NOTE-03): its own, else 256 B. */
export const resolutionCapOf = (d: NotificationKindDef): number =>
  d.resolutionMaxBytes ?? RESOLUTION_MAX_BYTES;

/** The kind's payload cap (FR-NOTE-03): its own, else 1 KB. */
export const payloadCapOf = (d: NotificationKindDef): number =>
  d.payloadMaxBytes ?? PAYLOAD_MAX_BYTES;

export function defineNotificationKind(def: NotificationKindDef): NotificationKindDef {
  return def;
}

/** Map by kind; throws on a bad or duplicate kind, so a broken registration fails at load. */
export function buildKindMap(
  defs: readonly NotificationKindDef[],
): ReadonlyMap<string, NotificationKindDef> {
  const map = new Map<string, NotificationKindDef>();
  for (const d of defs) {
    if (!NOTIFICATION_KIND_RE.test(d.kind)) {
      throw new Error(`Notification kind "${d.kind}" must match ${NOTIFICATION_KIND_RE}`);
    }
    if (map.has(d.kind)) throw new Error(`Notification kind "${d.kind}" registered twice`);
    for (const field of ["payloadMaxBytes", "resolutionMaxBytes"] as const) {
      const cap = d[field];
      if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
        throw new Error(`Notification kind "${d.kind}": ${field} must be a positive integer`);
      }
    }
    checkEndRule(d.kind, d.endRule);
    checkToastClass(d.kind, d.toastClass);
    map.set(d.kind, d);
  }
  return map;
}
