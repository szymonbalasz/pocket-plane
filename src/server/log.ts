// Minimal leveled logger. Never pass the DM secret or a link token.
import type { LogLevel } from "./config";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export function createLogger(level: LogLevel = "info", sink = console): Logger {
  const at = ORDER[level];
  const out = (l: LogLevel, msg: string, extra?: unknown) => {
    if (ORDER[l] < at) return;
    const line = `${new Date().toISOString()} ${l.toUpperCase()} ${msg}`;
    const fn = l === "error" ? sink.error : l === "warn" ? sink.warn : sink.log;
    if (extra === undefined) fn(line);
    else fn(line, extra);
  };
  return {
    debug: (m, e) => out("debug", m, e),
    info: (m, e) => out("info", m, e),
    warn: (m, e) => out("warn", m, e),
    error: (m, e) => out("error", m, e),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
