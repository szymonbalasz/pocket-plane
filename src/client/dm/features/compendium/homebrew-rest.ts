// DM compendium writes over REST (FR-CMP-24/25/27): homebrew put / delete, derive a monster.
// Responses parsed with the shared zod; errors surface as `ApiError` (server message). FR-CMP-23:
// the DM's own writes refetch at once from any window: a put or delete also refetches the Rules
// window (house rules, FR-CMP-67), wherever it was made.
import {
  type DeriveMonsterBody,
  DeriveMonsterResponse,
  type PutEntryBody,
  PutEntryResponse,
} from "@shared/compendium/homebrew";
import { type Api, call } from "@ui/api";
import { refetchRules } from "@ui/features/compendium/rules/nav";

export async function putEntry(
  api: Api,
  id: string | null,
  json: PutEntryBody,
): Promise<PutEntryResponse> {
  const req =
    id === null
      ? api.api.compendium.entries.$post({ json })
      : api.api.compendium.entries[":id"].$put({ param: { id }, json });
  const out = PutEntryResponse.parse(await call<unknown>(req));
  refetchRules();
  return out;
}

export async function deleteEntry(api: Api, id: string): Promise<void> {
  await call<unknown>(api.api.compendium.entries[":id"].$delete({ param: { id } }));
  refetchRules();
}

export async function deriveMonster(
  api: Api,
  json: DeriveMonsterBody,
): Promise<DeriveMonsterResponse> {
  const body = await call<unknown>(api.api.compendium["derive-monster"].$post({ json }));
  return DeriveMonsterResponse.parse(body);
}
