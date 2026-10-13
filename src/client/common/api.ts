// Hono RPC client. Clients import only `type AppType` from the server (AGENTS §9.1).
import type { AppType } from "@server/app";
import { RestError } from "@shared/protocol/codes";
import { hc } from "hono/client";

export function createApi(getSecret: () => string | null = () => null) {
  return hc<AppType>(window.location.origin, {
    headers: (): Record<string, string> => {
      const s = getSecret();
      return s ? { Authorization: `Bearer ${s}` } : {};
    },
  });
}

export type Api = ReturnType<typeof createApi>;

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly body: RestError | null,
  ) {
    super(body?.message ?? `HTTP ${status}`);
  }
}

/**
 * CAMP / SYNC wording when a REST call never got an answer from the server (as for intents,
 * `Connection lost — check … before trying again`): the change may or may not have committed.
 */
export const CONNECTION_LOST = "Connection lost — check the result before trying again";

/** Status of an `ApiError` whose request never reached the server. */
export const NETWORK_STATUS = 0;

/**
 * Network failure (fetch rejects: server down, tunnel gone) or a gateway answering for a dead
 * server (dev proxy, cloudflared: 502/503/504 without a REST error body).
 */
function isLost(status: number, body: unknown): boolean {
  return [502, 503, 504].includes(status) && !RestError.safeParse(body).success;
}

/**
 * Throws ApiError for non-2xx; returns parsed JSON (or null for 204). A lost connection throws
 * ApiError(`NETWORK_STATUS`) with the `CONNECTION_LOST` message, never the raw "Failed to fetch".
 */
export async function call<T>(
  p: Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>,
): Promise<T> {
  const lost = () => new ApiError(NETWORK_STATUS, { code: "internal", message: CONNECTION_LOST });
  let res: Awaited<typeof p>;
  try {
    res = await p;
  } catch (err) {
    if (err instanceof TypeError) throw lost(); // fetch's network error
    throw err;
  }
  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => null);
  if (isLost(res.status, body)) throw lost();
  if (!res.ok) throw new ApiError(res.status, body as RestError | null);
  return body as T;
}
