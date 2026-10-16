// View of kind `mod-trigger` (FR-MOD-44; protocol §23), both clients: a rule trigger's turn-start
// reminder ("Troll: Regeneration — regain 10 HP unless it took acid or fire damage"). Info: no
// action, no end rule; the text as sent (the server's `notify` text), a zap icon.
import { MOD_TRIGGER_KIND } from "@shared/effect-modifiers/reminders";
import { ZapIcon } from "lucide-react";
import { defineNotificationView } from "../notifications/views";

export const modTriggerView = defineNotificationView({
  kind: MOD_TRIGGER_KIND,
  icon: ZapIcon,
});
