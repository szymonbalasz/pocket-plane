// A place label when edited. No handles: its size is its style (FR-OVW-27). Edit text and a
// double-click open its field (FR-OVW-26); selected, it has the style panel (FR-OVW-28).
import { PencilIcon } from "lucide-react";
import { SelectedLabelsPanel } from "../LabelStylePanel";
import { openLabelEdit } from "../label-tool";
import type { ItemKindDef } from "./item-kind";

export const labelKind: ItemKindDef = {
  resize: null,
  menu: [{ id: "edit-text", label: "Edit text", icon: PencilIcon, run: openLabelEdit }],
  doubleClick: openLabelEdit,
  stylePanel: SelectedLabelsPanel,
};
