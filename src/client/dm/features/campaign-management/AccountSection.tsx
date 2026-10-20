// DM Preferences "Account" section (FR-CAMP-35, OQ-SHELL-47 A): Log out moved here from the top
// bar. Browser-only (forgets the DM secret); works while not `live`. The play page provides the
// logout action, so this file doesn't pull in the DM session at import.
import { Button } from "@ui/components/ui/button";
import { definePrefSection } from "@ui/features/play-shell/PreferencesWindow";
import { createContext, useContext } from "react";

export const LogoutContext = createContext<(() => void) | null>(null);

function AccountSection() {
  const logout = useContext(LogoutContext);
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">Signed in as the DM in this browser.</span>
      <Button
        size="sm"
        variant="outline"
        data-testid="camp-logout"
        disabled={!logout}
        onClick={() => logout?.()}
      >
        Log out
      </Button>
    </div>
  );
}

export const accountSection = definePrefSection({
  id: "camp.account",
  title: "Account",
  order: 90,
  Component: AccountSection,
});
