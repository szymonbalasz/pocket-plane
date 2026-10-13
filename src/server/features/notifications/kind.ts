// Server notification kind contract (FR-NOTE-03). Kinds are listed in `./kinds.ts`
// (append-only, AGENTS §9.9); kind owners define theirs with `defineNotificationKind`.
import { NOTIFICATION_KIND_RE, RESOLUTION_MAX_BYTES } from "@shared/notifications/schemas";
import type { z } from "zod";

export interface NotificationKindDef {
  /** `^[a-z][a-z0-9-]{0,31}$` */
  kind: string;
  /** Spec that owns the kind (e.g. `combat-tracker`). */
  ownerSpec: string;
  /** Payload zod; the serialised payload must also be ≤ 1 KB. */
  payload: z.ZodType;
  /** Resolution zod; absent = the kind takes no resolution. Serialised ≤ `resolutionMaxBytes`. */
  resolution?: z.ZodType;
  /** Per-kind resolution cap in bytes, serialised (FR-NOTE-03, #155). Default 256. */
  resolutionMaxBytes?: number;
  /** `note.resolve` may resolve it (FR-NOTE-09). Default false. */
  genericResolve?: boolean;
}

/** The kind's resolution cap (FR-NOTE-03): its own, else 256 B. */
export const resolutionCapOf = (d: NotificationKindDef): number =>
  d.resolutionMaxBytes ?? RESOLUTION_MAX_BYTES;

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
    const cap = d.resolutionMaxBytes;
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
      throw new Error(
        `Notification kind "${d.kind}": resolutionMaxBytes must be a positive integer`,
      );
    }
    map.set(d.kind, d);
  }
  return map;
}
