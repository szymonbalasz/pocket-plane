// Player turn alert runtime (FR-CBT-41): companion of the player's `cbt.initiative` (mounted while
// an encounter is started). Each applied live event frame goes through `turnAlertFor`; a match
// calls the shell's `alert()` (flash + Toast "Your turn — Mira" + ping, FR-SHELL-22).
import { useEventFrame } from "../../sync/store";
import { useShellAlert } from "../play-shell/ShellContext";
import { turnAlertFor } from "./turn-alert";

export function TurnAlertRuntime() {
  const alert = useShellAlert();
  useEventFrame((frame, store) => {
    const a = turnAlertFor(frame, store);
    if (a) alert(a);
  });
  return null;
}
