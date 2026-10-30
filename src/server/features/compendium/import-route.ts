// Compendium import REST (CMP §9, FR-CMP-20; C3). Mounted at /api, DM only (DM secret; a player
// credential → 401). `GET /compendium/sources`: bundled sources and the 5etools folder's books vs
// the stored rows (import panel, **Update** when the versions differ). `POST /compendium/import
// {source, run?}`: `cmp.import`, a source key only (never data or a path); refused while an
// encounter is started ("End combat first").
import {
  type FiveEtoolsStatus,
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
import { ImportLog } from "./import-log";
import { BUNDLED_SOURCE_KEYS, bundledSource } from "./sources";
import { endFolderRun, fiveEtoolsFolder } from "./sources/five-etools";

/**FR-CMPX-17, spec §9: the folder's books against the stored source rows. */
function fiveEtoolsStatus(s: Services): FiveEtoolsStatus {
  const folder = fiveEtoolsFolder(s.config.fiveEtoolsDir);
  if (folder.state === "not-configured") return { state: folder.state, books: [] };
  if (folder.state === "not-found") {
    return {
      state: folder.state,
      path: folder.path,
      ...(folder.issues ? { issues: folder.issues } : {}),
      books: [],
    };
  }
  const stored = new Map(
    s.db
      .select()
      .from(compendiumSource)
      .all()
      .map((r) => [r.key, r]),
  );
  return {
    state: folder.state,
    release: folder.release,
    version: folder.version,
    books: folder.books.map((b) => {
      const row = stored.get(b.key);
      return {
        ...b,
        ...(row ? { importedVersion: row.version, importedAt: row.importedAt } : {}),
      };
    }),
  };
}

export function sourceStatuses(s: Services): SourcesResponse {
  return {
    fiveEtools: fiveEtoolsStatus(s),
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
  const log = new ImportLog(() => s.log);
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
        const { last, ...input } = c.req.valid("json");
        const started = performance.now();
        const ms = () => performance.now() - started;
        try {
          const r = s.commands.run(IMPORT, input, {
            actor: dmActor(c.get("campaignId")),
          }) as ImportResult;
          log.book(r, input.run, ms());
          const body: ImportResponse = {
            source: r.source,
            version: r.version,
            counts: r.counts,
            warnings: r.warnings,
          };
          return c.json(body, 200);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Import failed";
          log.failed(input.source, input.run, message, ms());
          return errorResponse(c, err, s);
        } finally {
          if (last && input.run !== undefined) {
            log.end(input.run);
            endFolderRun(input.run);
          }
        }
      })
  );
}
