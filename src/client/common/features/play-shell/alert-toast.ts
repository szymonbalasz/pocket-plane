// Alert Toasts go to their own sonner toaster, placed in the client's toast region (FR-SHELL-01).
import { toast } from "sonner";
import { alertText, type ShellAlert } from "./alerts";

export const ALERT_TOASTER_ID = "shell-alerts";

/** Toast "‹title› — ‹detail›" (FR-SHELL-22); a repeat of the same id replaces its toast. */
export function showAlertToast(a: ShellAlert): void {
  toast(alertText(a), {
    id: `alert:${a.id}`,
    toasterId: ALERT_TOASTER_ID,
    testId: "ui-alert-toast",
  });
}
