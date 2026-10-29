// Tool errors (AGENT §11, FR-AGENT-11): every failure leaves the MCP server as one tool error
// `{code, message, issues?}`; the server's message and issues pass through.
import { Issue, RestError } from "@shared/protocol/codes";
import type { RejectFrame } from "@shared/protocol/frames";
import { z } from "zod";

export const AgentErrorCode = z.enum([
  "server_not_running",
  "server_busy",
  "server_stopped",
  "invalid",
  "forbidden",
  "not_found",
  "conflict",
  "auth",
  "throttled",
  "internal",
]);
export type AgentErrorCode = z.infer<typeof AgentErrorCode>;

export const ToolError = z.object({
  code: AgentErrorCode,
  message: z.string(),
  issues: z.array(Issue).optional(),
});
export type ToolError = z.infer<typeof ToolError>;

export class AgentError extends Error {
  override name = "AgentError";
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly issues?: Issue[],
  ) {
    super(message);
  }
}

// ---- messages: one sentence + the next step (AGENT §7) ----

export const notRunning = (profile: string) =>
  new AgentError(
    "server_not_running",
    `Pocket Plane isn't running (profile ${profile}). Start the server (\`bun run start\` or \`bun run dev\`).`,
  );

export const busy = (why: "fixture load running" | "server starting") =>
  new AgentError(
    "server_busy",
    `Pocket Plane is busy: ${why}. Try again ${why === "server starting" ? "in a moment" : "when it finishes"}.`,
  );

/** FR-AGENT-06: a read is safe to retry; a write may or may not have landed (never retried). */
export const stopped = (write: boolean) =>
  new AgentError(
    "server_stopped",
    write
      ? "Pocket Plane stopped during the call. The change may or may not be saved; start the server and read it back."
      : "Pocket Plane stopped during the call. Safe to retry once it is running.",
  );

export const authRejected = () =>
  new AgentError(
    "auth",
    "The server rejected PP_DM_SECRET. Fix it in .env, then restart the MCP server.",
  );

/** Never blames `.env` (FR-AGENT-08). */
export const throttled = (serverMessage?: string) =>
  new AgentError(
    "throttled",
    serverMessage ?? "Too many DM sign-in attempts on the server. Try again in a minute.",
  );

export const NO_ACTIVE_CAMPAIGN = "No active campaign: open one in the DM client.";
export const noActiveCampaign = () => new AgentError("conflict", NO_ACTIVE_CAMPAIGN);

export const tooOld = (what: string) =>
  new AgentError("internal", `Server too old for this tool (${what}). Update Pocket Plane.`);

// ---- server answers → tool errors (§11) ----

const PASS_THROUGH = ["invalid", "forbidden", "not_found", "conflict"] as const;
type PassThrough = (typeof PASS_THROUGH)[number];
const STATUS_CODE: Record<number, PassThrough> = {
  400: "invalid",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

/** A REST error answer (not 401: the caller latches that, FR-AGENT-08). `what` = the route. */
export function restError(status: number, body: unknown, what: string): AgentError {
  const parsed = RestError.safeParse(body);
  const b = parsed.success ? parsed.data : null;
  if (status === 401) return authRejected();
  if (status === 429) return throttled(b?.message);
  if (b?.code === "unknown_intent") return tooOld(what);
  const code = STATUS_CODE[status];
  if (code === "conflict" && b && /^No active campaign/.test(b.message)) return noActiveCampaign();
  if (code) return new AgentError(code, b?.message ?? `Server answered ${status}`, b?.issues);
  return new AgentError("internal", b?.message ?? `Server error (${status}).`, b?.issues);
}

/** A WS `reject` of `intent` (§11; `unknown_intent` = an older server). */
export function rejectError(frame: RejectFrame, intent: string): AgentError {
  if (frame.code === "unknown_intent") return tooOld(intent);
  if ((PASS_THROUGH as readonly string[]).includes(frame.code)) {
    return new AgentError(frame.code as PassThrough, frame.message, frame.issues);
  }
  return new AgentError("internal", frame.message, frame.issues);
}

/** Any thrown value → the tool error the client sees; unexpected ones become `internal`. */
export function toToolError(err: unknown): ToolError {
  if (err instanceof AgentError) {
    return err.issues
      ? { code: err.code, message: err.message, issues: err.issues }
      : {
          code: err.code,
          message: err.message,
        };
  }
  return { code: "internal", message: "Internal error in the MCP server (see its stderr)." };
}

/** FR-AGENT-03: the secret never leaves the process, whatever a message quotes. */
export function scrub(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("‹secret›");
}
