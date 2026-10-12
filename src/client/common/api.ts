// Hono RPC client. Clients import only `type AppType` from the server (AGENTS §9.1).
import type { AppType } from "@server/app";
import type { RestError } from "@shared/protocol/codes";
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

/** Throws ApiError for non-2xx; returns parsed JSON (or null for 204). */
export async function call<T>(
  p: Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>,
): Promise<T> {
  const res = await p;
  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body as RestError | null);
  return body as T;
}
