// FR-OVW-20: the place actions' **Add hidden** switch, remembered per browser, never sent. Every
// place action's panel shows `AddHiddenSwitch` and reads `useAddHidden`.
import { create } from "zustand";
import { Switch } from "../../components/ui/menus";
import { Label } from "../../components/ui/primitives";

const KEY = "pp.overview.v1.add-hidden";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): FlagStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function loadAddHidden(storage: FlagStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Blocked storage: it still holds for this page. */
export function saveAddHidden(on: boolean, storage: FlagStorage | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, on ? "1" : "0");
  } catch {}
}

export const useAddHidden = create<{ on: boolean; set(on: boolean): void }>((set) => ({
  on: loadAddHidden(),
  set(on) {
    saveAddHidden(on);
    set({ on });
  },
}));

export function AddHiddenSwitch() {
  const on = useAddHidden((s) => s.on);
  const setOn = useAddHidden((s) => s.set);
  return (
    <div className="flex items-center gap-2">
      <Switch
        id="ovw-add-hidden"
        data-testid="ovw-add-hidden"
        checked={on}
        onCheckedChange={setOn}
      />
      <Label htmlFor="ovw-add-hidden" className="text-xs">
        Add hidden
      </Label>
    </div>
  );
}
