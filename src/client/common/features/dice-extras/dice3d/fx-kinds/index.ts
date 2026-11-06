// FR-DICEX-106: every damage type's full 3D effect, one file per kind. A kind that is null keeps
// the subtle effect (die-fx.ts; physical types: none) until its file is built. Complete: nobody
// edits this list; a kind's builder edits only fx-kinds/<kind>.ts and <kind>.test.ts.
import type { RichKind } from "../../die-fx";
import { acid } from "./acid";
import { bludgeoning } from "./bludgeoning";
import { fire } from "./fire";
import { force } from "./force";
import { frost } from "./frost";
import type { RichKindDef } from "./kind";
import { lightning } from "./lightning";
import { necrotic } from "./necrotic";
import { piercing } from "./piercing";
import { poison } from "./poison";
import { psychic } from "./psychic";
import { radiant } from "./radiant";
import { slashing } from "./slashing";
import { thunder } from "./thunder";

export const RICH_DEFS: Readonly<Record<RichKind, RichKindDef | null>> = {
  fire,
  frost,
  acid,
  poison,
  necrotic,
  lightning,
  thunder,
  force,
  psychic,
  radiant,
  bludgeoning,
  piercing,
  slashing,
};
