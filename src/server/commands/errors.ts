import type { Issue, RejectCode } from "@shared/protocol/codes";
import type { z } from "zod";

/** A command outcome other than success; maps to WS `reject` and REST errors (CON-09). */
export class CommandError extends Error {
  override name = "CommandError";
  constructor(
    readonly code: RejectCode,
    message: string,
    readonly issues?: Issue[],
  ) {
    super(message);
  }
}

export function zodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
    message: i.message,
  }));
}

export const forbidden = (msg = "Not allowed") => new CommandError("forbidden", msg);
export const notFound = (msg = "Not found") => new CommandError("not_found", msg);
export const conflict = (msg: string) => new CommandError("conflict", msg);
export const invalid = (msg: string, issues?: Issue[]) => new CommandError("invalid", msg, issues);
