// "Map effect…" on effect menus (FR-VFX-10, -09): the Initiative effect chip (DM), the sheet's
// Active effects and the concentration chip menu (DM; the owner on their own character's effects,
// CBTX's `concMenuFor` rule). The item opens a small dialog with the FR-VFX-05 picker; Save sends
// `vfx.setEffectFx` (closes on ack, a reject toasts). The dialog lives with its menu's host (it
// stays mounted while the menu closes): `useEffectFxDialog()` gives both.

import { effectName } from "@shared/combat-extras/rules";
import type { EffectView } from "@shared/combat-extras/schemas";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { VFX_INTENTS } from "@shared/spell-fx/intents";
import { SparklesIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { DropdownMenuItem } from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { concMenuFor } from "../combat-extras/logic";
import { useCbtIntent } from "../combat-tracker/store";
import { type FxDraft, FxFields } from "./FxPicker";

/** FR-VFX-09: may this viewer set the effect's map effect (DM any; owner on own character's). */
export function mayEditFx(store: Parameters<typeof concMenuFor>[0], e: EffectView): boolean {
  return concMenuFor(store, e) !== null;
}

function EffectFxItem({ e, onOpen }: { e: EffectView; onOpen(): void }) {
  const may = useSync((s) => mayEditFx(s.store, e));
  const live = useSync((s) => s.state === "live");
  if (!may) return null;
  return (
    <DropdownMenuItem
      data-testid="vfx-effect-fx"
      data-record-id={e.id}
      disabled={!live}
      onSelect={onOpen}
    >
      <SparklesIcon /> Map effect…
    </DropdownMenuItem>
  );
}

function EffectFxDialog({ effectId, onClose }: { effectId: string | null; onClose(): void }) {
  const e = useSync((s) =>
    effectId === null
      ? undefined
      : (s.store.records[EFFECT_TYPE]?.[effectId] as EffectView | undefined),
  );
  const gone = effectId !== null && (!e || e.endedAt);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  const open = effectId !== null && !gone && e !== undefined;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="vfx-effect-fx-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Map effect</DialogTitle>
          <DialogDescription>{e ? effectName(e) : ""}</DialogDescription>
        </DialogHeader>
        {/* Keyed by the effect: the draft starts from its map effect when the dialog opens. */}
        {e && <EffectFxForm key={e.id} e={e} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EffectFxForm({ e, onClose }: { e: EffectView; onClose(): void }) {
  const { send, disabled } = useCbtIntent();
  const [draft, setDraft] = useState<FxDraft | null>(
    e.fx ? { preset: e.fx.preset, params: e.fx.params } : null,
  );
  return (
    <>
      <FxFields recordId={e.id} value={draft} onChange={setDraft} />
      <Button
        size="sm"
        className="w-fit"
        data-testid="vfx-effect-fx-save"
        disabled={disabled}
        onClick={async () => {
          const spellId = e.fx?.spellId;
          const fx = draft ? { ...draft, ...(spellId ? { spellId } : {}) } : null;
          const r = await send(VFX_INTENTS.setEffectFx, { effectId: e.id, fx });
          if (r !== undefined) onClose();
        }}
      >
        Save
      </Button>
    </>
  );
}

/** The "Map effect…" menu item per effect and the one dialog it opens, for one menu host. */
export function useEffectFxDialog(): { item(e: EffectView): ReactNode; dialog: ReactNode } {
  const [effectId, setEffectId] = useState<string | null>(null);
  const close = useCallback(() => setEffectId(null), []);
  return {
    item: (e) => <EffectFxItem key={`vfx-${e.id}`} e={e} onOpen={() => setEffectId(e.id)} />,
    dialog: <EffectFxDialog effectId={effectId} onClose={close} />,
  };
}
