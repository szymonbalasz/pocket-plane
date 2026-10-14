// Server notification kind contract (FR-NOTE-03). Kinds are listed in `./kinds.ts`
// (append-only, AGENTS §9.9); kind owners define theirs with `defineNotificationKind`.
import { checkEndRule, type EncounterEndRule } from "@shared/notifications/end-rule";
import {
  NOTIFICATION_KIND_RE,
  PAYLOAD_MAX_BYTES,
  RESOLUTION_MAX_BYTES,
} from "@shared/notifications/schemas";
import type { z } from "zod";

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
}

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
    map.set(d.kind, d);
  }
  return map;
}
