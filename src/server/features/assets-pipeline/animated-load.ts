// FR-ANIM-06: fill the animated-ID set from the DB at server start.
import { like } from "drizzle-orm";
import type { Db } from "../../db/client";
import { asset } from "../../db/schema";
import { markAnimated } from "./animated";

export function loadAnimated(db: Pick<Db, "select">): number {
  const rows = db.select({ id: asset.id }).from(asset).where(like(asset.mime, "video/%")).all();
  for (const r of rows) markAnimated(r.id);
  return rows.length;
}
