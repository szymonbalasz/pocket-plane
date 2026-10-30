// Creatures "Custom only" switch: hides imported (SRD / fixture) monsters so the list shows the
// campaign's own records (customs, pets, characters). Per browser, never sent; on by default.
// One browser-storage entry `pp.creatures.customOnly.v1` ("0" / "1"); anything else → default;
// storage blocked → memory only for this page.
import type { StorageBackend } from "@ui/features/play-shell/storage";
import { useState } from "react";

export const CUSTOM_ONLY_KEY = "pp.creatures.customOnly.v1";
export const DEFAULT_CUSTOM_ONLY = true;

export function readCustomOnly(getBackend: () => StorageBackend | undefined): boolean {
  try {
    const raw = getBackend()?.getItem(CUSTOM_ONLY_KEY);
    return raw === "0" ? false : raw === "1" ? true : DEFAULT_CUSTOM_ONLY;
  } catch {
    return DEFAULT_CUSTOM_ONLY;
  }
}

/** Never throws. */
export function writeCustomOnly(getBackend: () => StorageBackend | undefined, on: boolean) {
  try {
    getBackend()?.setItem(CUSTOM_ONLY_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: the switch keeps its state for this page only.
  }
}

const browser = () => (typeof localStorage === "undefined" ? undefined : localStorage);

export function useCustomOnly(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readCustomOnly(browser));
  return [
    on,
    (next) => {
      setOn(next);
      writeCustomOnly(browser, next);
    },
  ];
}
