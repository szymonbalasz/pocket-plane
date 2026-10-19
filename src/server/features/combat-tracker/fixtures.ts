// Fixture helpers for combat setups (FR-CBT-94, sprint 5): `cbt.applyCard` carries the card's
// damage `rollId`, which no record change names (rolls aren't a record type), so the loader's
// `r.id(key, …)` never sees it.
import { seededContext } from "../../commands/context";

/**
 * The `draw`-th seeded ID fixture `fixtureKey` gets (0 = its first `ctx.ids.next()`), the loader's
 * per-fixture seeded context. Pure: draws from a fresh seeded context, writes nothing. A fixture
 * names the draw of the roll it applies; its fixture test asserts it equals the card's `rollId`.
 */
export function fixtureSeededId(fixtureKey: string, draw: number): string {
  const ids = seededContext({ disposable: true, key: fixtureKey }).ids;
  let id = ids.next();
  for (let i = 0; i < draw; i++) id = ids.next();
  return id;
}
