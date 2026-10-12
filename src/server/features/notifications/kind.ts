// Server notification kind contract (FR-NOTE-03). Kinds are listed in `./kinds.ts`
// (append-only, AGENTS §9.9); kind owners define theirs with `defineNotificationKind`.
import { NOTIFICATION_KIND_RE } from "@shared/notifications/schemas";
import type { z } from "zod";

export interface NotificationKindDef {
  /** `^[a-z][a-z0-9-]{0,31}$` */
  kind: string;
  /** Spec that owns the kind (e.g. `combat-tracker`). */
  ownerSpec: string;
  /** Payload zod; the serialised payload must also be ≤ 1 KB. */
  payload: z.ZodType;
  /** Resolution zod; absent = the kind takes no resolution. Serialised ≤ 256 B. */
  resolution?: z.ZodType;
  /** `note.resolve` may resolve it (FR-NOTE-09). Default false. */
  genericResolve?: boolean;
}

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
    map.set(d.kind, d);
  }
  return map;
}
