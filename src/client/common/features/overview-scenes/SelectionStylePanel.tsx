// The Select tool's panel: each selected kind's own (`ItemKindDef.stylePanel`), for just those items.
// Nothing selected that has one → no panel, so nothing makes room (FR-MAP-60).
import type { ItemKind } from "@shared/overview-scenes/schemas";
import { ITEM_KINDS } from "@shared/overview-scenes/schemas";
import { useMemo } from "react";
import { ITEM_KIND_DEFS } from "./items/kinds";
import { type OverviewEditorState, useOverviewEditor } from "./overview-editor";

const hasPanel = (kind: ItemKind) => ITEM_KIND_DEFS[kind].stylePanel !== undefined;

export function selectionHasStylePanel(s: OverviewEditorState): boolean {
  return s.selection.tokenIds.some((id) => {
    const item = s.items.find((i) => i.id === id);
    return item !== undefined && hasPanel(item.kind);
  });
}

export function SelectionStylePanel() {
  const ids = useOverviewEditor((s) => s.selection.tokenIds);
  const items = useOverviewEditor((s) => s.items);
  const selected = useMemo(() => items.filter((i) => ids.includes(i.id)), [items, ids]);
  return (
    <>
      {ITEM_KINDS.map((kind) => {
        const Panel = ITEM_KIND_DEFS[kind].stylePanel;
        const ofKind = selected.filter((i) => i.kind === kind);
        return Panel && ofKind.length > 0 ? <Panel key={kind} items={ofKind} /> : null;
      })}
    </>
  );
}
