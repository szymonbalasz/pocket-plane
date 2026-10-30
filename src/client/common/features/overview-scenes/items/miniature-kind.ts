// A miniature when edited (FR-OVW-34): square, so its corner handles keep the shape too.
import { MINIATURE_SIDE } from "@shared/overview-scenes/schemas";
import type { ItemKindDef } from "./item-kind";

export const miniatureKind: ItemKindDef = { resize: MINIATURE_SIDE, menu: [] };
