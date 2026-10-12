// REST helpers: error body + status mapping (CON-09), zod validation, DM auth (CON-08, CON-15).
import { REST_STATUS, type RestError, type RestErrorCode } from "@shared/protocol/codes";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import type { z } from "zod";
import { CommandError, zodIssues } from "./commands/errors";
import type { Services } from "./services";

export function errorBody(code: RestErrorCode, message: string, issues?: RestError["issues"]) {
  const body: RestError = { code, message };
  if (issues) body.issues = issues;
  return body;
}

export function errorResponse(c: Context, err: unknown, s: Services) {
  if (err instanceof CommandError) {
    return c.json(errorBody(err.code, err.message, err.issues), REST_STATUS[err.code]);
  }
  s.log.error(`${c.req.method} ${c.req.path} failed`, err);
  return c.json(errorBody("internal", "Internal error"), 500);
}

export function jsonBody<S extends z.ZodType>(schema: S) {
  return validator("json", (value, c) => {
    const r = schema.safeParse(value);
    if (!r.success) {
      return c.json(errorBody("invalid", "Invalid input", zodIssues(r.error)), 400);
    }
    return r.data as z.output<S>;
  });
}

export function bearer(c: Context): string | null {
  const h = c.req.header("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

/** DM REST routes: `Authorization: Bearer <DM secret>`. Secret only; no active campaign needed. */
export function dmOnly(s: Services) {
  return createMiddleware(async (c, next) => {
    const secret = bearer(c);
    if (secret === null) return c.json(errorBody("unauthorized", "DM secret required"), 401);
    const r = s.auth.checkDmSecret(secret);
    if (r === "throttled") {
      return c.json(errorBody("throttled", "Too many attempts. Try again in a minute."), 429);
    }
    if (r === "invalid") return c.json(errorBody("unauthorized", "Wrong DM secret"), 401);
    await next();
  });
}
