// Stronghold window **Stores** tab, both clients (FR-HOLD-28, FR-LOOT-34): this stronghold's Stores
// coin strip (`stores-coin`), LOOT's Move form preset From = this Stores, To = Party pot ("Move to
// party"; the DM's Outside the party ↔ Stores among its options), and the item list (PARTY's
// Inventory rows of this Stores: Take / Move…, Give…, the DM's Add to Stores, DM-only rows with
// eye-off). Same locks, rejects and lost-intent rules as FR-LOOT-16 / FR-PARTY-24. Players only
// reach a shown stronghold's Stores (the window is "isn't available" otherwise) and never receive a
// DM-only item (FR-LOOT-36). Every change is an intent (`loot.move`, `party.*Item`).
import { storesLabel } from "@shared/party-board/format";
import {
  coinsOf,
  STORES_COIN_TYPE,
  type StoresCoinRecord,
  ZERO_COINS,
} from "@shared/party-loot/schemas";
import { useRecords, useSync } from "../../sync/store";
import { InventoryTab } from "../party-board/Inventory";
import { MoveForm, Purse, SectionTitle, useCharacters, useStores } from "../party-loot/LootLog";
import { storesKey } from "../party-loot/logic";
import type { HoldParts } from "./StrongholdWindow";
import { useLive } from "./send";

export function StoresTab({ parts }: { parts: HoldParts }) {
  const id = parts.hold.id;
  const you = useSync((s) => s.store.you);
  const live = useLive();
  const chars = useCharacters();
  const stores = useStores();
  const coin = useRecords<StoresCoinRecord>(STORES_COIN_TYPE).find((r) => r.strongholdId === id);
  if (!you) return null;
  return (
    <div data-testid="hold-stores" data-record-id={id} className="flex flex-col gap-3 pb-2">
      <section className="flex flex-col gap-1">
        <SectionTitle>Coin</SectionTitle>
        <div className="flex flex-wrap gap-1">
          <Purse
            coins={coin ? coinsOf(coin) : ZERO_COINS}
            testId="loot-stores-coin"
            emptyTestId="loot-stores-coin-empty"
          />
        </div>
      </section>
      <MoveForm
        chars={chars}
        viewer={{ role: you.role, playerId: you.playerId }}
        live={live}
        scope={{ stores, preset: storesKey(id) }}
      />
      <section className="flex flex-col gap-1">
        <SectionTitle>Items</SectionTitle>
        <InventoryTab
          holder={{ kind: "stores", strongholdId: id }}
          storesName={storesLabel(parts.hold.name)}
        />
      </section>
    </div>
  );
}
