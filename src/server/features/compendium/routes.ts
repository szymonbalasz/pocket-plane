// Compendium REST reads (CMP §9, FR-CMP-10–14). Mounted at /api. Order per request: Cache-Control
// wrapper → auth (route-local, FR-CMP-13) → query validation → visibility → If-None-Match.
import { SearchQuery } from "@shared/compendium/rest";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { zodIssues } from "../../commands/errors";
import { errorBody, errorResponse } from "../../http";
import type { Services } from "../../services";
import { type CompendiumEnv, compendiumAuth, noCache } from "./auth";
import { etagMatches, readEntry } from "./read";
import { searchEntries } from "./search";

const searchQuery = validator("query", (value, c) => {
  const r = SearchQuery.safeParse(value);
  if (!r.success) return c.json(errorBody("invalid", "Invalid input", zodIssues(r.error)), 400);
  return r.data;
});

export function compendiumRoutes(s: Services) {
  return new Hono<CompendiumEnv>()
    .use("/compendium/*", noCache, compendiumAuth(s))
    .get("/compendium/search", searchQuery, (c) => {
      try {
        return c.json(searchEntries(s.db, c.get("viewer"), c.req.valid("query")), 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .get("/compendium/entries/:id", (c) => {
      try {
        const read = readEntry(s.db, c.req.param("id"), c.get("viewer"));
        if (!read) return c.json(errorBody("not_found", "Entry not found"), 404);
        c.header("ETag", read.etag);
        if (etagMatches(c.req.header("if-none-match"), read.etag)) return c.body(null, 304);
        return c.json(read.body, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    });
}
