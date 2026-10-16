// Compendium import REST (CMP §9, FR-CMP-20; C3). Mounted at /api, DM only (DM secret; a player
// credential → 401). `GET /compendium/sources`: bundled sources vs the stored rows (import panel,
// **Update** when the versions differ). `POST /compendium/import {source}`: `cmp.import`, a
// bundled source key only (never data); refused while an encounter is started ("End combat first").
import {
  ImportRequest,
  type ImportResponse,
  type SourcesResponse,
} from "@shared/compendium/import";
import { CompendiumSource } from "@shared/compendium/schemas";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { compendiumSource } from "../../db/schema";
import {
  type DmCampaignEnv,
  dmActor,
  dmCampaign,
  dmOnly,
  errorResponse,
  jsonBody,
} from "../../http";
import type { Services } from "../../services";
import { noCache } from "./auth";
import { IMPORT, type ImportResult } from "./import";
import { BUNDLED_SOURCE_KEYS, bundledSource } from "./sources";

export function sourceStatuses(s: Services): SourcesResponse {
  return {
    sources: BUNDLED_SOURCE_KEYS.map((key) => {
      const { bundled } = bundledSource(key);
      const row = s.db.select().from(compendiumSource).where(eq(compendiumSource.key, key)).get();
      const stored = row ? CompendiumSource.parse(row) : null;
      return {
        key,
        name: bundled.source.name,
        bundledVersion: bundled.version,
        imported: stored
          ? { version: stored.version, importedAt: stored.importedAt, counts: stored.counts }
          : null,
      };
    }),
  };
}

export function compendiumImportRoutes(s: Services) {
  return (
    new Hono<DmCampaignEnv>()
      // FR-CMP-12: Cache-Control on every compendium answer (also when mounted on its own).
      .use("/compendium/*", noCache)
      .get("/compendium/sources", dmOnly(s), (c) => {
        try {
          return c.json(sourceStatuses(s), 200);
        } catch (err) {
          return errorResponse(c, err, s);
        }
      })
      .post("/compendium/import", dmOnly(s), dmCampaign(s), jsonBody(ImportRequest), (c) => {
        try {
          const r = s.commands.run(IMPORT, c.req.valid("json"), {
            actor: dmActor(c.get("campaignId")),
          }) as ImportResult;
          const body: ImportResponse = {
            source: r.source,
            version: r.version,
            counts: r.counts,
            warnings: r.warnings,
          };
          return c.json(body, 200);
        } catch (err) {
          return errorResponse(c, err, s);
        }
      })
  );
}
