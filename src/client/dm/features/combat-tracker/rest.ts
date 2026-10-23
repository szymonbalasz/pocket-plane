// DM REST calls: encounters (CBT §9) and the creature form's entities routes (FR-CBT-05). The
// session module is imported lazily (it reads localStorage at load; keeps registries testable).
import type { EncounterBody, EncounterRecord } from "@shared/combat-tracker/schemas";
import type { CreateEntityBody, EntityResponse, UpdateEntityBody } from "@shared/entities/schemas";
import { loadChunk } from "@ui/lib/lazy-chunk";

async function session() {
  // A stale chunk (BL-91): the caller's existing error + the stale notice.
  return loadChunk(() => import("../campaign-management/session"), { notice: true });
}

export const combatRest = {
  async createEncounter(body: EncounterBody) {
    const { api, dmCall } = await session();
    return dmCall<{ encounter: EncounterRecord }>(api.api.encounters.$post({ json: body }));
  },
  async updateEncounter(id: string, body: EncounterBody) {
    const { api, dmCall } = await session();
    return dmCall<{ encounter: EncounterRecord }>(
      api.api.encounters[":id"].$put({ param: { id }, json: body }),
    );
  },
  async deleteEncounter(id: string) {
    const { api, dmCall } = await session();
    return dmCall<null>(api.api.encounters[":id"].$delete({ param: { id } }));
  },
  async createEntity(body: CreateEntityBody) {
    const { api, dmCall } = await session();
    return dmCall<EntityResponse>(api.api.entities.$post({ json: body }));
  },
  async updateEntity(id: string, body: UpdateEntityBody) {
    const { api, dmCall } = await session();
    return dmCall<EntityResponse>(api.api.entities[":id"].$put({ param: { id }, json: body }));
  },
};
