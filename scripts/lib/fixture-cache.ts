// Bundle snapshot cache helpers for parent runners (check, e2e, CI): hash the code once and
// hand it to child processes as PP_FIXTURE_CACHE_KEY, so each `bun test` shard skips its own
// ~0.1 s hash and every child names the same cache dir (src/server/features/fixtures-adapters/cache.ts).
//
// `bun scripts/lib/fixture-cache.ts` prints the key (e.g. for an actions/cache key in CI).
import { WORKTREE_ROOT } from "../../src/server/config";
import { codeHash, parseCacheEnv } from "../../src/server/features/fixtures-adapters/cache";

/** Env to add to a child's env: the code key, unless the cache is off or a key is already set. */
export function fixtureCacheEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const s = parseCacheEnv(env);
  if (!s.enabled || s.codeKey) return {};
  return { PP_FIXTURE_CACHE_KEY: codeHash(WORKTREE_ROOT) };
}

if (import.meta.main) console.log(codeHash(WORKTREE_ROOT));
