// `GET /api/notes/search?q=` (NOTES §9, FR-NOTES-22, slice N4), mounted at /api. Auth as compendium
// search (FR-CMP-13): `Bearer <DM secret>` → the active campaign, `Player <link token>` → the
// link's campaign (inactive → 409), checked on every call. Searches that campaign only.
import { NoteSearchQuery } from "@shared/linked-notes/search";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { zodIssues } from "../../commands/errors";
import { errorBody, errorResponse } from "../../http";
import type { Services } from "../../services";
import { type CompendiumEnv, compendiumAuth, noCache } from "../compendium/auth";
import { runNoteSearch } from "./search";

const searchQuery = validator("query", (value, c) => {
  const r = NoteSearchQuery.safeParse(value);
  if (!r.success) return c.json(errorBody("invalid", "Invalid input", zodIssues(r.error)), 400);
  return r.data;
});

export function noteRoutes(s: Services) {
  return new Hono<CompendiumEnv>()
    .use("/notes/*", noCache, compendiumAuth(s))
    .get("/notes/search", searchQuery, (c) => {
      try {
        const { q } = c.req.valid("query");
        return c.json(runNoteSearch(s, c.get("viewer").campaignId, q).response, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    });
}
