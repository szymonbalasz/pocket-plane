// FR-ASSET-49 (OQ-ASSET-26 A): the one-time tag backfill. Rows written before IM-1 hold null
// `tags` (the push adds the column as null); every ingest since writes an array. At start,
// **before the server listens**, every null row gets its tags guessed from current use, in one
// transaction with the marker `db_meta` `asset-tags-backfill` = `ctx.clock` time. A start that
// sees the marker or finds no null row writes nothing, so a restart never changes the DB
// (`state:digest`, #163). No event, no log row (a migration; runs before any connection). A
// crash mid-backfill commits nothing; the next start runs it again.
import { IMAGE_TAGS } from "@shared/assets-pipeline/tags";
import { eq, isNotNull, isNull } from "drizzle-orm";
import type { CommandContext } from "../../commands/context";
import type { Db, Tx } from "../../db/client";
import {
  asset,
  compendiumEntry,
  dbMeta,
  entity,
  handout,
  prop,
  scene,
  token,
} from "../../db/schema";

export const TAGS_BACKFILL_KEY = "asset-tags-backfill";

type BuiltIn = (typeof IMAGE_TAGS)[number];

/** Asset id → the built-in tags its current uses suggest (FR-ASSET-49). */
function guessedTags(tx: Pick<Tx, "select">): Map<string, Set<BuiltIn>> {
  const uses = new Map<string, Set<BuiltIn>>();
  const use = (id: string | null, tag: BuiltIn) => {
    if (!id) return;
    const s = uses.get(id) ?? new Set<BuiltIn>();
    s.add(tag);
    uses.set(id, s);
  };
  for (const r of tx
    .select({ id: scene.mapAssetId })
    .from(scene)
    .where(isNotNull(scene.mapAssetId))
    .all())
    use(r.id, "Maps");
  for (const r of tx
    .select({ id: token.imageAssetId })
    .from(token)
    .where(isNotNull(token.imageAssetId))
    .all())
    use(r.id, "Tokens");
  for (const r of tx
    .select({ id: entity.portraitAssetId })
    .from(entity)
    .where(isNotNull(entity.portraitAssetId))
    .all())
    use(r.id, "Portraits");
  for (const r of tx.select({ id: prop.assetId }).from(prop).all()) use(r.id, "Props");
  for (const r of tx.select({ ids: handout.imageAssetIds }).from(handout).all())
    for (const id of r.ids) use(id, "Handouts");
  for (const r of tx
    .select({ ids: compendiumEntry.imageAssetIds })
    .from(compendiumEntry)
    .where(eq(compendiumEntry.kind, "item"))
    .all())
    for (const id of r.ids ?? []) use(id, "Items");
  return uses;
}

export interface BackfillOptions {
  /** Test seam: runs after each row's update, inside the transaction (an injected throw). */
  afterRow?: (assetId: string) => void;
}

/** Backfills every null `tags` row; returns how many (0 = nothing written). */
export function backfillAssetTags(db: Db, ctx: CommandContext, opts: BackfillOptions = {}): number {
  if (db.select().from(dbMeta).where(eq(dbMeta.key, TAGS_BACKFILL_KEY)).get()) return 0;
  return db.transaction((tx) => {
    const rows = tx.select({ id: asset.id }).from(asset).where(isNull(asset.tags)).all();
    if (rows.length === 0) return 0;
    const uses = guessedTags(tx);
    for (const { id } of rows) {
      const guessed = uses.get(id);
      // Built-in order (FR-ASSET-40); no use → `[]` (Untagged).
      const tags = guessed ? IMAGE_TAGS.filter((t) => guessed.has(t)) : [];
      tx.update(asset).set({ tags }).where(eq(asset.id, id)).run();
      opts.afterRow?.(id);
    }
    tx.insert(dbMeta).values({ key: TAGS_BACKFILL_KEY, value: ctx.clock.iso() }).run();
    return rows.length;
  });
}
