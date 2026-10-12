// Close, reject and REST error codes (docs/protocol §3.5, §3.6, §6). Shared file.
import { z } from "zod";

export const RejectCode = z.enum([
  "invalid",
  "unknown_intent",
  "forbidden",
  "not_found",
  "conflict",
  "internal",
]);
export type RejectCode = z.infer<typeof RejectCode>;

/** REST adds auth outcomes to the reject codes (CON-09). */
export const RestErrorCode = z.enum([...RejectCode.options, "unauthorized", "throttled"]);
export type RestErrorCode = z.infer<typeof RestErrorCode>;

export const REST_STATUS: Record<RestErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500> = {
  invalid: 400,
  unknown_intent: 404,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  throttled: 429,
  internal: 500,
};

export const Issue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type Issue = z.infer<typeof Issue>;

/** REST error body (CON-09). */
export const RestError = z.object({
  code: RestErrorCode,
  message: z.string(),
  issues: z.array(Issue).optional(),
});
export type RestError = z.infer<typeof RestError>;

export const CloseCode = {
  shutdown: 1001,
  frameTooLarge: 1009,
  resyncRequired: 4000,
  credentialInvalid: 4401,
  noHello: 4408,
  campaignInactive: 4409,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

export const CloseReason: Record<CloseCode, string> = {
  1001: "shutdown",
  1009: "frame-too-large",
  4000: "resync-required",
  4401: "credential-invalid",
  4408: "no-hello",
  4409: "campaign-inactive",
};
