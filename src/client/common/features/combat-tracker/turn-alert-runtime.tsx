// Turn alert runtime (FR-CBT-41): companion of `cbt.initiative` (the player's while an encounter
// is started; the DM's always). Each applied live event frame goes through `turnAlertFor`; a match
// calls the shell's `alert()` (flash + Toast "Your turn — Mira" + ping, FR-SHELL-22), drawn as the
// turn card (FR-KIT-59). The DM's frames go through `dmTurnCardFor`: the turn card "Mira's turn"
// first in the DM stack for 4 s (OQ-KIT-03 A; no flash, sound or Toast).
import { useEventFrame } from "../../sync/store";
import { showTurnCard } from "../notifications/toasts";
import { useShellAlert } from "../play-shell/ShellContext";
import { dmTurnCardFor, turnAlertFor } from "./turn-alert";

export function TurnAlertRuntime() {
  const alert = useShellAlert();
  useEventFrame((frame, store) => {
    const a = turnAlertFor(frame, store);
    if (a) alert(a);
    const card = dmTurnCardFor(frame, store);
    if (card) showTurnCard(card);
  });
  return null;
}
