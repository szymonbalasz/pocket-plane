// The per-kind edit definitions, one file per kind.
import type { ItemKind } from "@shared/overview-scenes/schemas";
import { imageKind } from "./image-kind";
import type { ItemKindDef } from "./item-kind";
import { labelKind } from "./label-kind";
import { miniatureKind } from "./miniature-kind";

export const ITEM_KIND_DEFS: Readonly<Record<ItemKind, ItemKindDef>> = {
  image: imageKind,
  label: labelKind,
  miniature: miniatureKind,
};
