// FR-PARTY-39: an image from the attach control joins the end of the editor's strip; dedupe is the
// caller's (seams S5): an id already in the strip (same bytes → same id) isn't added again.
import { addImage } from "@ui/features/party-board/logic";

export const ALREADY_IN_HANDOUT = "Already in this handout";

export function attachImage(ids: readonly string[], id: string) {
  const duplicate = ids.includes(id);
  return { ids: duplicate ? [...ids] : addImage(ids, id), duplicate };
}
