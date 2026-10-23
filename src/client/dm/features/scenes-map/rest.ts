// DM REST calls for scenes and folders (MAP §9) via the Hono RPC client. The session module is
// imported lazily: it reads localStorage at load (keeps window registries importable in tests).
import type { SceneFolderResponse, SceneResponse } from "@shared/scenes-map/schemas";
import { loadChunk } from "@ui/lib/lazy-chunk";

async function session() {
  // A stale chunk (BL-91): the caller's existing error + the stale notice.
  return loadChunk(() => import("../campaign-management/session"), { notice: true });
}

export const scenesRest = {
  async createScene(body: { name: string; mapAssetId: string; folderId?: string | null }) {
    const { api, dmCall } = await session();
    return dmCall<SceneResponse>(api.api.scenes.$post({ json: body }));
  },
  async patchScene(id: string, body: { name?: string; folderId?: string | null }) {
    const { api, dmCall } = await session();
    return dmCall<SceneResponse>(api.api.scenes[":id"].$patch({ param: { id }, json: body }));
  },
  async duplicateScene(id: string) {
    const { api, dmCall } = await session();
    return dmCall<SceneResponse>(api.api.scenes[":id"].duplicate.$post({ param: { id } }));
  },
  async deleteScene(id: string) {
    const { api, dmCall } = await session();
    return dmCall<null>(api.api.scenes[":id"].$delete({ param: { id } }));
  },
  async createFolder(name: string) {
    const { api, dmCall } = await session();
    return dmCall<SceneFolderResponse>(api.api["scene-folders"].$post({ json: { name } }));
  },
  async renameFolder(id: string, name: string) {
    const { api, dmCall } = await session();
    return dmCall<SceneFolderResponse>(
      api.api["scene-folders"][":id"].$patch({ param: { id }, json: { name } }),
    );
  },
  async deleteFolder(id: string) {
    const { api, dmCall } = await session();
    return dmCall<null>(api.api["scene-folders"][":id"].$delete({ param: { id } }));
  },
};
