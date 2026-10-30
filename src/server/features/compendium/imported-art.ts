// FR-CMPX-24, first placement (OQ-CMPX-01 A): a token of an imported monster placed with no image
// and no imported-art row yet. After commit the listener reads the token file from the DM's folder,
// ingests it into the campaign (`assets.ingest`), then `cmp.applyImportedArt` writes the row and
// gives the image to the definition's tokens that still have none, with their normal token events.
// One ingest per (campaign, monster) in flight; a token placed meanwhile is picked up by the apply.
// FR-CMPX-26: any failure → no row, glyph stays, one warning; the next placement tries again.
// Armed by a start hook, so never in the fixture loader (async work there would outlive the load).
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isValidArtPath } from "@shared/compendium/schemas";
import { TokenDuplicated, TokenPlaced, TokenUpdated } from "@shared/events/scenes-map";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { importedArt, token } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Services } from "../../services";
import { requireAsset } from "../assets-pipeline/commands";
import { ingestAsset } from "../assets-pipeline/ingest";
import { readToken, toTokenRecord } from "../scenes-map/rows";
import { runTokenChangedHooks } from "../scenes-map/token-hooks";
import { rederiveDependants } from "../scenes-map/visibility-hooks";
import { campaignOf } from "./homebrew";
import { type ArtSource, artSourceOf } from "./imported-art-hook";

export const APPLY_IMPORTED_ART = "cmp.applyImportedArt";
/** FR-CMPX-24: the tag on an ingested token image. */
export const IMPORTED_ART_TAG = "Tokens";

const Text = z.string().min(1).max(200);

/** Internal (no intent, no route): the listener's second half. */
export const applyImportedArt = defineCommand({
  name: APPLY_IMPORTED_ART,
  input: z.strictObject({ definitionId: Text, source: Text, sourceKey: Text, assetId: Text }),
  execute({ definitionId, source, sourceKey, assetId }, env): { tokens: number } {
    const { tx, ctx, emit } = env;
    const cid = campaignOf(env);
    requireAsset(env, assetId);
    const createdAt = ctx.clock.iso();
    tx.insert(importedArt)
      .values({ campaignId: cid, source, sourceKey, assetId, createdAt })
      .onConflictDoUpdate({
        target: [importedArt.campaignId, importedArt.source, importedArt.sourceKey],
        set: { assetId, createdAt },
      })
      .run();
    // FR-CMPX-25: only tokens that still have none.
    const bare = tx
      .select()
      .from(token)
      .where(
        and(
          eq(token.campaignId, cid),
          eq(token.definitionId, definitionId),
          isNull(token.imageAssetId),
        ),
      )
      .orderBy(asc(token.seq))
      .all()
      .map(toTokenRecord);
    for (const before of bare) {
      tx.update(token)
        .set({ imageAssetId: assetId, updatedAt: createdAt })
        .where(eq(token.id, before.id))
        .run();
      const after = readToken(tx, before.id);
      const change = { type: TOKEN_TYPE, id: before.id, before, after };
      const dependants = rederiveDependants(env, change);
      const hookChanges = runTokenChangedHooks(env, before, after);
      emit({
        type: TokenUpdated.type,
        campaignId: cid,
        payload: { tokenId: before.id, sceneId: before.sceneId },
        changes: [change, ...dependants, ...hookChanges],
      });
    }
    return { tokens: bare.length };
  },
});

/** The file to read, or null if the path isn't allowed: checked again before every read. */
export async function artFileOf(dir: string, artPath: string): Promise<string | null> {
  if (!isValidArtPath(artPath)) return null;
  // Real paths: a link inside the folder must not lead out of it.
  const [root, file] = await Promise.all([realpath(dir), realpath(path.resolve(dir, artPath))]);
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? file : null;
}

const system = (campaignId: string): Actor => ({ role: "system", playerId: null, campaignId });

export class ImportedArt {
  private armed = false;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly s: Services) {}

  arm(): void {
    this.armed = true;
  }

  /** Test support: every ingest in flight has finished. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all(this.inFlight.values());
  }

  readonly onEvent = ({ event }: DispatchedEvent): void => {
    const cid = event.campaignId;
    // FR-CMPX-25: a duplicate copies its source's image, as today.
    if (!this.armed || !cid || event.type === TokenDuplicated.type) return;
    for (const c of event.changes) {
      if (c.type !== TOKEN_TYPE || c.before !== null || c.after === null) continue;
      const placed = c.after as TokenRecord;
      if (placed.imageAssetId !== null) continue;
      const art = artSourceOf(this.s.db, placed.definitionId);
      if (!art) continue;
      const now = this.s.db
        .select({ imageAssetId: token.imageAssetId })
        .from(token)
        .where(eq(token.id, placed.id))
        .get();
      if (!now) continue;
      if (now.imageAssetId === null) this.start(cid, placed.definitionId, art);
      else if (event.type !== TokenPlaced.type)
        this.copyToCombatant(cid, placed.id, now.imageAssetId);
    }
  };

  /**
   * A `placeTokenIn` caller keeps the record it read before the reuse hook wrote the image, so a
   * bound combatant copied none. `map.updateToken` runs the token-changed hooks that copy it; on a
   * microtask because this listener may run before the broadcaster sees the placing event.
   */
  private copyToCombatant(cid: string, tokenId: string, imageAssetId: string): void {
    queueMicrotask(() => {
      try {
        this.s.commands.run(
          MAP_INTENTS.updateToken,
          { tokenId, imageAssetId },
          { actor: system(cid) },
        );
      } catch (err) {
        this.s.log.warn(`imported art: token ${tokenId} not updated: ${String(err)}`);
      }
    });
  }

  private start(cid: string, definitionId: string, art: ArtSource): void {
    const key = [cid, art.source, art.sourceKey].join("\0");
    if (this.inFlight.has(key)) return;
    const work = this.ingest(cid, definitionId, art)
      .catch((err) => {
        this.warn(art, err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, work);
  }

  private warn(art: ArtSource, why: string): void {
    this.s.log.warn(`imported art: ${art.source} ${art.sourceKey}: ${why}; token keeps its glyph`);
  }

  private async ingest(cid: string, definitionId: string, art: ArtSource): Promise<void> {
    const dir = this.s.config.fiveEtoolsDir;
    if (dir === null) {
      this.warn(art, "PP_5ETOOLS_DIR is not set");
      return;
    }
    const startedAt = performance.now();
    const file = await artFileOf(dir, art.artPath);
    if (file === null) {
      this.warn(art, `path not allowed (${art.artPath})`);
      return;
    }
    const actor = system(cid);
    const { asset } = await ingestAsset(
      this.s,
      {
        bytes: await readFile(file),
        filename: path.basename(file),
        name: art.name,
        tags: [IMPORTED_ART_TAG],
        kind: "image",
      },
      { actor },
    );
    this.s.commands.run(
      applyImportedArt,
      { definitionId, source: art.source, sourceKey: art.sourceKey, assetId: asset.id },
      { actor },
    );
    this.s.log.info(
      `imported art: ${art.source} ${art.sourceKey} ready in ${Math.round(performance.now() - startedAt)} ms`,
    );
  }
}

const instances = new WeakMap<Services, ImportedArt>();

/** The server's imported-art worker (tests: `arm()` and `settled()`). */
export function importedArtOf(s: Services): ImportedArt {
  let art = instances.get(s);
  if (!art) {
    art = new ImportedArt(s);
    instances.set(s, art);
  }
  return art;
}
